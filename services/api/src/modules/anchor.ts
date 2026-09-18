/**
 * Anchor orkestratörü: maaş girişi (SEP-38 + SEP-6 deposit-exchange) ve nakde çevirme talimatı.
 * Kullanıcının SEP-10 JWT'si istemcide üretilir (passkey ile açılan anahtar imzalar) ve
 * POST /anchor/token ile buraya verilir; anchor işlemleri bu JWT ile sürdürülür.
 */
import { AnchorClient, splitTry, toStroops, type HazeConfig } from "@haze/stellar";
import type { Db } from "../db.ts";
import type { RulesService } from "./rules.ts";

export interface AnchorDeps {
  cfg: HazeConfig;
  db: Db;
  rules: RulesService;
  log?: (msg: string) => void;
}

export class AnchorService {
  constructor(private readonly d: AnchorDeps) {}

  private client(userId: string): { client: AnchorClient; g: string } {
    const u = this.d.db.user(userId);
    if (!u) throw new Error("user not found");
    if (!u.anchor_jwt) throw new Error("anchor token missing; client must run SEP-10 first");
    const client = new AnchorClient(this.d.cfg.anchorHomeDomain, this.d.cfg.networkPassphrase);
    client.useToken(u.anchor_jwt, u.g_address);
    return { client, g: u.g_address };
  }

  /**
   * İşveren paneli: TRY maaşı yatır. Parçalar (≤3000 TRY) sırayla: quote → deposit-exchange →
   * simulate-bank-transfer → completed. Sonunda kural motoru settle_salary çağırır.
   */
  async startSalary(userId: string, amountTry: number, onProgress?: (s: string) => void): Promise<{ parts: { id: string; try: number; usdc: string; status: string }[]; settle: unknown }> {
    const { client, g } = this.client(userId);
    await client.discover();
    const parts: { id: string; try: number; usdc: string; status: string }[] = [];
    let totalUsdc = 0n;
    for (const p of splitTry(amountTry)) {
      onProgress?.(`quote ${p} TRY`);
      const quote = await client.quote({ sell_asset: "iso4217:TRY", buy_asset: client.usdcAssetId, sell_amount: p.toFixed(2) });
      onProgress?.(`deposit-exchange ${quote.buy_amount} USDC`);
      const dep = await client.deposit({ account: g, amountTry: p.toFixed(2), quoteId: quote.id });
      this.d.db.insertAnchorTx({ id: dep.id, user_id: userId, kind: "deposit", quote_id: quote.id, amount_try: p.toFixed(2), amount_usdc: quote.buy_amount, status: "pending_user_transfer_start", stellar_tx: null });
      await client.simulateBankTransfer(dep.id, p.toFixed(2));
      const tx = await client.waitForCompletion(dep.id, {
        onStatus: (s) => {
          this.d.db.updateAnchorTx(dep.id, s);
          onProgress?.(`${dep.id}: ${s}`);
        },
      });
      this.d.db.updateAnchorTx(dep.id, tx.status, tx.stellar_transaction_id);
      const usdc = tx.amount_out ?? quote.buy_amount;
      totalUsdc += toStroops(usdc);
      parts.push({ id: dep.id, try: p, usdc, status: tx.status });
    }
    this.d.db.notify(userId, "salary_received", "Maaş hesabına geçti", `${amountTry.toFixed(2)} TL → ${(Number(totalUsdc) / 1e7).toFixed(2)} USDC`, { parts });
    onProgress?.("settle_salary");
    const settle = await this.d.rules.settleSalary(userId, totalUsdc);
    return { parts, settle };
  }

  /** Nakde çevirme: teklif + withdraw talimatı (hazine adresi, memo). Zincir işlemini istemci imzalar. */
  async cashoutInstructions(userId: string, amountTry: number): Promise<{
    id: string;
    quoteId: string;
    usdcAmount: string;
    tryAmount: string;
    price: string;
    treasury: string;
    memo: string;
    memoType: string;
    expiresAt: string;
  }> {
    const { client } = this.client(userId);
    await client.discover();
    const quote = await client.quote({ sell_asset: client.usdcAssetId, buy_asset: "iso4217:TRY", buy_amount: amountTry.toFixed(2) });
    const w = await client.withdraw({ amountUsdc: quote.sell_amount, quoteId: quote.id });
    this.d.db.insertAnchorTx({ id: w.id, user_id: userId, kind: "withdraw", quote_id: quote.id, amount_try: quote.buy_amount, amount_usdc: quote.sell_amount, status: "pending_user_transfer_start", stellar_tx: null });
    return {
      id: w.id,
      quoteId: quote.id,
      usdcAmount: quote.sell_amount,
      tryAmount: quote.buy_amount,
      price: quote.price,
      treasury: w.account_id,
      memo: w.memo,
      memoType: w.memo_type,
      expiresAt: quote.expires_at,
    };
  }

  async status(userId: string, id: string) {
    const { client } = this.client(userId);
    const tx = await client.transaction(id);
    this.d.db.updateAnchorTx(id, tx.status, tx.stellar_transaction_id);
    return tx;
  }

  /** Gösterge kur: 1 USD kaç TRY */
  async indicativeUsdTry(userId: string): Promise<number> {
    const { client } = this.client(userId);
    await client.discover();
    const r = await client.prices("iso4217:TRY", "1000", client.usdcAssetId);
    return Number(r.buy_assets[0]?.price ?? 0);
  }
}
