/**
 * Kart akışı: ASA kararı (off-chain, <500 ms), hold durum makinesi, operatör borç kuyruğu,
 * Lithic clearing/void webhook'ları.
 *
 *   PENDING  --card_borrow event / borç tx başarılı-->  BORROWED
 *   PENDING  --3 deneme başarısız-->                     FAILED (panelde alarm)
 *   BORROWED --clearing webhook-->                       CLEARED
 *   BORROWED --void webhook-->                           REFUNDED (hazine USDC'yi vault'a iade eder, operatör refund_for_card)
 */
import { FIAT_BY_CURRENCY, authIdFromToken, currencyOf, toFloat, toHex, usdCentsToUsdc } from "@haze/stellar";
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
  /** fiat token kodu → SAC adresi (havuzda rezerv ve ihraç edilmişse), yoksa undefined */
  fiatSac?: (code: string) => string | undefined;
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
  /**
   * Terminal ipucu: Lithic sandbox'ı işlem para birimini bozuyor (TRY → GBP, ülke hep USA); haze-terminal Lithic'i
   * çağırmadan önce "bu kartın sıradaki yetkilendirmesi TRY, tutar X kuruş" der. Gerçek ASA'da Lithic'in kendi
   * amounts.merchant alanı geçerlidir; ipucu 60 sn içinde tüketilmezse düşer.
   */
  private hints = new Map<string, { currency: string; amountMinor: number; at: number }>();
  constructor(private readonly d: CardDeps) {}

  setHint(cardToken: string, currency: string, amountMinor: number) {
    this.hints.set(cardToken, { currency: currency.toUpperCase(), amountMinor, at: Date.now() });
  }
  private takeHint(cardToken: string) {
    const h = this.hints.get(cardToken);
    if (!h) return undefined;
    this.hints.delete(cardToken);
    return Date.now() - h.at < 60_000 ? h : undefined;
  }

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
    // İşlem para biriminde borçlan: TRY → hTRY, EUR → hEUR … (rezerv yoksa USDC). Miktar işlem tutarı, USD karşılığı limit için.
    const hint = this.takeHint(req.card_token);
    const cur = (hint?.currency ?? req.merchant_currency ?? "USD").toUpperCase();
    const minor = hint?.amountMinor ?? (req.merchant_amount && req.merchant_amount > 0 ? req.merchant_amount : undefined);
    const fiatCode = FIAT_BY_CURRENCY[cur];
    const fiatSac = fiatCode ? this.d.fiatSac?.(fiatCode) : undefined;
    const debtAsset = fiatSac && minor ? fiatCode! : "USDC";
    const debtAmount = debtAsset === "USDC" ? amountUsdc : BigInt(Math.round(minor!)) * 100_000n; // en küçük birim (kuruş) → 7 ondalık

    if (!decision.approved) {
      this.d.db.insertHold({
        auth_id: authId,
        lithic_token: req.token,
        user_id: user.id,
        usd_cents: req.amount,
        usdc_amount: amountUsdc.toString(),
        debt_asset: debtAsset,
        debt_amount: debtAmount.toString(),
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
      debt_asset: debtAsset,
      debt_amount: debtAmount.toString(),
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
      debtAsset === "USDC"
        ? `${toFloat(amountUsdc).toFixed(2)} USDC borç · kalan limit ${toFloat(decision.remainingLimit).toFixed(2)} USDC`
        : `${toFloat(debtAmount).toFixed(2)} ${currencyOf(debtAsset)} borç (${debtAsset}, ≈ ${toFloat(amountUsdc).toFixed(2)} USDC) · kalan limit ${toFloat(decision.remainingLimit).toFixed(2)} USDC`,
      { authId, merchant, merchantTry, usdc: amountUsdc.toString(), remainingLimit: decision.remainingLimit.toString(), debtAsset, debtAmount: debtAmount.toString() },
    );
    this.d.log?.(`ASA APPROVED ${merchant} ${toFloat(amountUsdc)} USDC${debtAsset !== "USDC" ? ` (borç ${toFloat(debtAmount)} ${debtAsset})` : ""} in ${Date.now() - t0}ms`);
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
    // Gövde bir sonraki microtask'ta başlar: kuyruk boşken senkron bitip `finally`nin null yazdığı değeri
    // aşağıdaki atamanın çözülmüş bir promise ile ezmesini önler (aksi halde kuyruk ilk boş turda kalıcı olarak kilitlenirdi).
    const run = Promise.resolve()
      .then(async () => {
        for (const h of this.d.db.holdsByStatus("PENDING")) await this.processHold(h);
      })
      .finally(() => {
        if (this.queueRun === run) this.queueRun = null;
      });
    this.queueRun = run;
    return run;
  }

  async processHold(h: HoldRow): Promise<void> {
    const user = this.d.db.user(h.user_id);
    if (!user?.vault_address) return;
    const current = this.d.db.hold(h.auth_id);
    if (!current || current.status !== "PENDING") return; // indexer önce yazmış olabilir
    const t0 = Date.now();
    this.d.log?.(`hold ${h.auth_id.slice(0, 8)} borrow_for_card → ${user.vault_address.slice(0, 8)}… (deneme ${h.attempts + 1})`);
    try {
      const asset = h.debt_asset && h.debt_asset !== "USDC" ? this.d.fiatSac?.(h.debt_asset) : undefined;
      const ref = asset
        ? await this.d.chain.borrowForCardAsset(user.vault_address, asset, BigInt(h.debt_amount), BigInt(h.usdc_amount), Buffer.from(h.auth_id, "hex"))
        : await this.d.chain.borrowForCard(user.vault_address, BigInt(h.usdc_amount), Buffer.from(h.auth_id, "hex"));
      this.markBorrowed(h.auth_id, ref.hash);
      this.d.log?.(`hold ${h.auth_id.slice(0, 8)} BORROWED ${ref.hash.slice(0, 8)} in ${Date.now() - t0}ms`);
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
    const fiatSac = h.debt_asset && h.debt_asset !== "USDC" ? this.d.fiatSac?.(h.debt_asset) : undefined;
    try {
      let ref;
      if (fiatSac) {
        const fiatAmount = BigInt(h.debt_amount);
        await this.d.chain.settlementRefundAsset(user.vault_address, fiatSac, fiatAmount);
        ref = await this.d.chain.refundForCardAsset(user.vault_address, fiatAmount, Buffer.from(h.auth_id, "hex"));
      } else {
        await this.d.chain.settlementRefund(user.vault_address, amount);
        ref = await this.d.chain.refundForCard(user.vault_address, amount, Buffer.from(h.auth_id, "hex"));
      }
      this.d.db.updateHold(h.auth_id, { status: "REFUNDED", error: null });
      const label = fiatSac ? `${toFloat(BigInt(h.debt_amount)).toFixed(2)} ${h.debt_asset}` : `${toFloat(amount).toFixed(2)} USDC`;
      this.d.db.notify(h.user_id, "card_refunded", `${h.merchant} — iade`, `${label} borç kapatıldı`, { authId: h.auth_id, tx: ref.hash, debtAsset: h.debt_asset, debtAmount: h.debt_amount });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.d.db.updateHold(h.auth_id, { error: `refund: ${msg}` });
      this.d.log?.(`refund ${h.auth_id} failed: ${msg}`);
    } finally {
      this.d.credit.invalidate(h.user_id);
    }
  }
}
