/**
 * Kart akışı: ASA kararı (off-chain, <500 ms), hold durum makinesi, operatör borç kuyruğu,
 * Lithic clearing/void webhook'ları.
 *
 *   PENDING  --card_borrow event / borç tx başarılı-->  BORROWED
 *   PENDING  --3 deneme başarısız-->                     FAILED (panelde alarm)
 *   BORROWED --clearing webhook-->                       CLEARED
 *   BORROWED --void webhook-->                           REFUNDED (hazine USDC'yi vault'a iade eder, operatör refund_for_card)
 */
import { authIdFromToken, toFloat, toHex, usdCentsToUsdc } from "@haze/stellar";
import type { ChainOps } from "../chain.ts";
import type { Db, HoldRow } from "../db.ts";
import type { CreditService } from "./credit.ts";
import type { AsaRequest, AsaResponse } from "./lithic.ts";

export interface CardDeps {
  db: Db;
  chain: ChainOps;
  credit: CreditService;
  log?: (msg: string, extra?: unknown) => void;
  /** TL karşılığı için USD→TRY kuru (7 ondalık, 1 USD = x TRY) */
  usdTry?: () => bigint | undefined;
}

export const DECLINE_TEXT: Record<string, string> = {
  frozen: "CARD_FROZEN",
  daily_limit: "DAILY_LIMIT_EXCEEDED",
  health: "INSUFFICIENT_COLLATERAL",
  no_collateral: "NO_COLLATERAL",
  unknown_card: "UNKNOWN_CARD",
  duplicate: "DUPLICATE_AUTHORIZATION",
};

export class CardService {
  private queueRun: Promise<void> | null = null;
  constructor(private readonly d: CardDeps) {}

  /** ASA: Lithic (ya da haze-terminal) isteğini yanıtlar. Zincire dokunmaz. */
  async authorize(req: AsaRequest): Promise<AsaResponse> {
    const t0 = Date.now();
    const user = this.d.db.userByCard(req.card_token);
    if (!user?.vault_address) return { result: "DECLINED", decline_reason: DECLINE_TEXT.unknown_card };

    const authId = toHex(await authIdFromToken(req.token));
    if (this.d.db.hold(authId)) return { result: "DECLINED", decline_reason: DECLINE_TEXT.duplicate };

    const amountUsdc = usdCentsToUsdc(req.amount);
    const { decision, credit } = await this.d.credit.decide(user.id, amountUsdc);

    const merchant = req.merchant?.descriptor ?? "Unknown merchant";
    const merchantTry = req.haze_try_amount ?? this.tryOf(amountUsdc);

    if (!decision.approved) {
      this.d.db.insertHold({
        auth_id: authId,
        lithic_token: req.token,
        user_id: user.id,
        usd_cents: req.amount,
        usdc_amount: amountUsdc.toString(),
        merchant,
        merchant_try: merchantTry,
        mcc: req.merchant?.mcc ?? null,
        status: "DECLINED",
      });
      this.d.db.notify(user.id, "card_declined", `${merchant} — reddedildi`, `${DECLINE_TEXT[decision.reason ?? "health"]}`, {
        authId,
        reason: decision.reason,
      });
      this.d.log?.(`ASA DECLINED ${decision.reason} ${merchant} ${toFloat(amountUsdc)} USDC in ${Date.now() - t0}ms`);
      return {
        result: "DECLINED",
        decline_reason: DECLINE_TEXT[decision.reason ?? "health"],
        balance: { amount: 0, available: Number(decision.remainingLimit / 100_000n) },
      };
    }

    this.d.db.insertHold({
      auth_id: authId,
      lithic_token: req.token,
      user_id: user.id,
      usd_cents: req.amount,
      usdc_amount: amountUsdc.toString(),
      merchant,
      merchant_try: merchantTry,
      mcc: req.merchant?.mcc ?? null,
      status: "PENDING",
    });
    this.d.credit.invalidate(user.id);
    this.d.db.notify(
      user.id,
      "card_approved",
      `${merchant}${merchantTry ? ` · ${merchantTry} TL` : ""}`,
      `${toFloat(amountUsdc).toFixed(2)} USDC borç · kalan limit ${toFloat(decision.remainingLimit).toFixed(2)} USDC`,
      { authId, merchant, merchantTry, usdc: amountUsdc.toString(), remainingLimit: decision.remainingLimit.toString() },
    );
    this.d.log?.(`ASA APPROVED ${merchant} ${toFloat(amountUsdc)} USDC in ${Date.now() - t0}ms`);
    // cevaptan sonra borç kuyruğu (await edilmez)
    queueMicrotask(() => void this.drainQueue());
    return {
      result: "APPROVED",
      balance: { amount: Number(credit.snapshot.debtValue / 100_000n), available: Number(decision.remainingLimit / 100_000n) },
      haze: { authId, usdc: amountUsdc.toString(), remainingLimit: decision.remainingLimit.toString() },
    };
  }

  private tryOf(usdc: bigint): string | null {
    const rate = this.d.usdTry?.();
    if (!rate) return null;
    return (toFloat(usdc) * toFloat(rate)).toFixed(2);
  }

  /** PENDING hold'ları zincire yazar. En fazla 3 deneme. */
  async drainQueue(): Promise<void> {
    if (this.queueRun) return this.queueRun; // çalışan turu bekle, ikinci tur açma
    this.queueRun = (async () => {
      try {
        for (const h of this.d.db.holdsByStatus("PENDING")) await this.processHold(h);
      } finally {
        this.queueRun = null;
      }
    })();
    return this.queueRun;
  }

  async processHold(h: HoldRow): Promise<void> {
    const user = this.d.db.user(h.user_id);
    if (!user?.vault_address) return;
    const current = this.d.db.hold(h.auth_id);
    if (!current || current.status !== "PENDING") return; // indexer önce yazmış olabilir
    try {
      const ref = await this.d.chain.borrowForCard(user.vault_address, BigInt(h.usdc_amount), Buffer.from(h.auth_id, "hex"));
      this.markBorrowed(h.auth_id, ref.hash);
    } catch (e) {
      const attempts = h.attempts + 1;
      const msg = e instanceof Error ? e.message : String(e);
      // Kontrat idempotency: "auth already processed" → aslında zincirde; BORROWED say
      if (msg.includes("auth already processed")) {
        this.markBorrowed(h.auth_id, current.borrow_tx ?? "unknown");
        return;
      }
      if (attempts >= 3) {
        this.d.db.updateHold(h.auth_id, { status: "FAILED", attempts, error: msg });
        this.d.db.notify(h.user_id, "hold_failed", "Borç işlemi başarısız", `${h.merchant}: ${msg.slice(0, 200)}`, { authId: h.auth_id });
        this.d.log?.(`hold ${h.auth_id} FAILED: ${msg}`);
      } else {
        this.d.db.updateHold(h.auth_id, { attempts, error: msg });
        this.d.log?.(`hold ${h.auth_id} attempt ${attempts} failed: ${msg}`);
      }
      this.d.credit.invalidate(h.user_id);
    }
  }

  markBorrowed(authId: string, txHash: string) {
    const h = this.d.db.hold(authId);
    if (!h || h.status !== "PENDING") return;
    this.d.db.updateHold(authId, { status: "BORROWED", borrow_tx: txHash });
    this.d.credit.invalidate(h.user_id);
  }

  /** Lithic transaction webhook'u. status: SETTLED (clearing) | VOIDED | DECLINED | PENDING */
  async onTransactionEvent(ev: { token: string; status: string; amount?: number }): Promise<void> {
    const h = this.d.db.holdByLithic(ev.token);
    if (!h) return;
    if (ev.status === "SETTLED" || ev.status === "CLEARED") {
      if (h.status === "BORROWED") this.d.db.updateHold(h.auth_id, { status: "CLEARED" });
      return;
    }
    if (ev.status === "VOIDED" || ev.status === "REVERSED" || ev.status === "EXPIRED") {
      await this.refund(h);
    }
  }

  /** İade: hazine USDC'yi vault'a gönderir, operatör refund_for_card çağırır. */
  async refund(h: HoldRow): Promise<void> {
    if (h.status !== "BORROWED" && h.status !== "CLEARED") {
      if (h.status === "PENDING") this.d.db.updateHold(h.auth_id, { status: "DECLINED", error: "voided before borrow" });
      return;
    }
    const user = this.d.db.user(h.user_id);
    if (!user?.vault_address) return;
    const amount = BigInt(h.usdc_amount);
    try {
      await this.d.chain.settlementRefund(user.vault_address, amount);
      const ref = await this.d.chain.refundForCard(user.vault_address, amount, Buffer.from(h.auth_id, "hex"));
      this.d.db.updateHold(h.auth_id, { status: "REFUNDED", error: null });
      this.d.db.notify(h.user_id, "card_refunded", `${h.merchant} — iade`, `${toFloat(amount).toFixed(2)} USDC borç kapatıldı`, { authId: h.auth_id, tx: ref.hash });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.d.db.updateHold(h.auth_id, { error: `refund: ${msg}` });
      this.d.log?.(`refund ${h.auth_id} failed: ${msg}`);
    } finally {
      this.d.credit.invalidate(h.user_id);
    }
  }
}
