/**
 * Fiyat servisi: tek döngüde (1) oracle'ı günceller, (2) market maker'ın teklif defteri fiyatını
 * aynı değere çeker, (3) SEP-38 TRY/USD kurunu önbelleğe alır.
 *
 * hUSDY: bakiye sabit, fiyat zamanla artar. Demo modunda 1 dakika = YIELD_DAYS_PER_MINUTE gün.
 * hXAU: getiri yok; taban fiyat + küçük rastgele yürüyüş (gerçek XAU/USD beslemesi yoksa).
 */
import { Asset, Keypair, Operation, TransactionBuilder, BASE_FEE, Horizon } from "@stellar/stellar-sdk";
import { AnchorClient, fromStroops, toStroops, type HazeConfig } from "@haze/stellar";
import type { ChainOps } from "../chain.ts";
import type { Db } from "../db.ts";

export interface PriceDeps {
  cfg: HazeConfig;
  db: Db;
  chain: ChainOps;
  /** market maker hesabı (hUSDY/hXAU/hTRY envanteri) */
  marketMaker: Keypair;
  /** SEP-38 için SEP-10 kimliği */
  fxSigner: Keypair;
  husdyApy: number;
  daysPerMinute: number;
  xauBase?: bigint;
  log?: (msg: string) => void;
}

export class PriceService {
  private startedAt = Date.now();
  private husdyStart = toStroops("1");
  private xau: bigint;
  private anchor: AnchorClient;
  private fxAt = 0;
  private timer?: NodeJS.Timeout;
  usdTry?: bigint;

  constructor(private readonly d: PriceDeps) {
    this.xau = d.xauBase ?? toStroops("2400");
    this.anchor = new AnchorClient(d.cfg.anchorHomeDomain, d.cfg.networkPassphrase);
    const saved = d.db.get("prices.startedAt");
    if (saved) this.startedAt = Number(saved);
    else d.db.set("prices.startedAt", String(this.startedAt));
    const savedXau = d.db.price(d.cfg.assets.hXAU.sac);
    if (savedXau) this.xau = savedXau;
  }

  /** hızlandırılmış zaman: geçen dakika × daysPerMinute gün */
  acceleratedYears(now = Date.now()): number {
    const minutes = (now - this.startedAt) / 60_000;
    return (minutes * this.d.daysPerMinute) / 365;
  }

  husdyPrice(now = Date.now()): bigint {
    const growth = Math.pow(1 + this.d.husdyApy, this.acceleratedYears(now));
    return BigInt(Math.round(Number(this.husdyStart) * growth));
  }

  /** hUSDY için gösterilecek yıllık getiri (gerçek zaman ölçeğinde değil, ürün ölçeğinde) */
  husdyApy(): number {
    return this.d.husdyApy;
  }

  current(): Record<string, bigint> {
    return {
      [this.d.cfg.assets.USDC.sac]: toStroops("1"),
      [this.d.cfg.assets.hUSDY.sac]: this.husdyPrice(),
      [this.d.cfg.assets.hXAU.sac]: this.xau,
    };
  }

  async tick(): Promise<void> {
    // hXAU küçük rastgele yürüyüş (±0,05%)
    const drift = 1 + (Math.random() - 0.5) * 0.001;
    this.xau = BigInt(Math.round(Number(this.xau) * drift));
    const prices = this.current();
    for (const [asset, p] of Object.entries(prices)) this.d.db.setPrice(asset, p, "bot");

    try {
      const assets = Object.keys(prices);
      await this.d.chain.setOraclePrices(assets, assets.map((a) => prices[a]));
    } catch (e) {
      this.d.log?.(`oracle update failed: ${e instanceof Error ? e.message : e}`);
    }
    try {
      await this.marketMake(prices);
    } catch (e) {
      const codes = (e as { response?: { data?: { extras?: { result_codes?: unknown } } } })?.response?.data?.extras?.result_codes;
      this.d.log?.(`market maker failed: ${e instanceof Error ? e.message : e}${codes ? " " + JSON.stringify(codes) : ""}`);
    }
    if (Date.now() - this.fxAt > 5 * 60_000) await this.refreshFx();
  }

  /**
   * Teklif defteri: USDC/hUSDY, USDC/hXAU, USDC/hTRY çiftlerinde ±0,3% spread ile iki yönlü emir.
   * Aynı offer id'leri güncellenerek (manageSellOffer) fiyat oracle'a çekilir.
   */
  private async marketMake(prices: Record<string, bigint>) {
    const cfg = this.d.cfg;
    const usdc = new Asset(cfg.assets.USDC.code, cfg.assets.USDC.issuer);
    const server = new Horizon.Server(cfg.horizonUrl);
    const mm = this.d.marketMaker;
    const account = await server.loadAccount(mm.publicKey());
    const existing = await server.offers().forAccount(mm.publicKey()).limit(50).call();
    const b = new TransactionBuilder(account, { fee: (Number(BASE_FEE) * 20).toString(), networkPassphrase: cfg.networkPassphrase });

    const pairs: { code: "hUSDY" | "hXAU" | "hTRY"; priceUsd: number; size: string }[] = [
      { code: "hUSDY", priceUsd: Number(prices[cfg.assets.hUSDY.sac]) / 1e7, size: "5000" },
      { code: "hXAU", priceUsd: Number(prices[cfg.assets.hXAU.sac]) / 1e7, size: "2" },
      { code: "hTRY", priceUsd: this.usdTry ? 1 / (Number(this.usdTry) / 1e7) : 0, size: "100000" },
    ];
    // Alış (USDC satan) emirleri hazinenin USDC bakiyesine sığdırılır: bakiyenin MM_USDC_SHARE kadarı
    // (varsayılan %25) teklif defterine ayrılır, kalanı demo kullanıcı / havuz likiditesi için serbest kalır.
    // Aksi halde toplam emir bakiyeyi aşar ve Horizon işlemi op_underfunded ile reddeder.
    const usdcBalance = Number(
      account.balances.find((bal) => "asset_code" in bal && bal.asset_code === usdc.code && bal.asset_issuer === usdc.issuer)?.balance ?? 0,
    );
    const share = Number(process.env.MM_USDC_SHARE ?? 0.25);
    const active = pairs.filter((p) => p.priceUsd && cfg.assets[p.code].issuer);
    const wantedUsdc = active.reduce((sum, p) => sum + Number(p.size) * p.priceUsd, 0);
    const scale = wantedUsdc > 0 ? Math.min(1, (usdcBalance * share) / wantedUsdc) : 0;
    let ops = 0;
    for (const p of active) {
      const asset = new Asset(cfg.assets[p.code].code, cfg.assets[p.code].issuer);
      const size = Number(p.size) * scale;
      const bidUsdc = size * p.priceUsd;
      if (size < 0.0000001 || bidUsdc < 0.0000001) continue;
      const ask = (p.priceUsd * 1.003).toFixed(7); // sat: 1 asset = ask USDC
      const bidPrice = (1 / (p.priceUsd * 0.997)).toFixed(7); // sat USDC al asset: 1 USDC = ... asset
      const askOffer = existing.records.find((o) => o.selling.asset_code === p.code && o.buying.asset_code === "USDC");
      const bidOffer = existing.records.find((o) => o.selling.asset_code === "USDC" && o.buying.asset_code === p.code);
      b.addOperation(Operation.manageSellOffer({ selling: asset, buying: usdc, amount: size.toFixed(7), price: ask, offerId: askOffer?.id ?? "0" }));
      b.addOperation(
        Operation.manageSellOffer({
          selling: usdc,
          buying: asset,
          amount: bidUsdc.toFixed(7),
          price: bidPrice,
          offerId: bidOffer?.id ?? "0",
        }),
      );
      ops += 2;
    }
    if (!ops) return;
    const tx = b.setTimeout(60).build();
    tx.sign(mm);
    await server.submitTransaction(tx);
  }

  /** SEP-38: 1 USD kaç TRY (7 ondalık) */
  async refreshFx(): Promise<bigint | undefined> {
    try {
      await this.anchor.discover();
      await this.anchor.authenticateWithKeypair(this.d.fxSigner);
      const r = await this.anchor.prices("iso4217:TRY", "1000", this.anchor.usdcAssetId);
      const usdcPer1000Try = Number(r.buy_assets[0]?.price ?? 0); // price = TRY per USDC (SEP-38: sell 1 buy = price sell units)
      // SEP-38 'price' = sell_asset birimi başına buy_asset fiyatı: 1 USDC = price TRY
      if (usdcPer1000Try > 0) {
        this.usdTry = toStroops(usdcPer1000Try.toFixed(7));
        this.d.db.setPrice("USDTRY", this.usdTry, "sep38");
        this.fxAt = Date.now();
      }
    } catch (e) {
      this.d.log?.(`fx refresh failed: ${e instanceof Error ? e.message : e}`);
      const saved = this.d.db.price("USDTRY");
      if (saved) this.usdTry = saved;
    }
    return this.usdTry;
  }

  /** TL → USD sent (terminal için) */
  tryToUsdCents(amountTry: number): number | undefined {
    if (!this.usdTry) return undefined;
    return Math.round((amountTry / (Number(this.usdTry) / 1e7)) * 100);
  }

  start(intervalSec: number) {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalSec * 1000);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  toJson() {
    const p = this.current();
    const cfg = this.d.cfg;
    return {
      USDC: 1,
      hUSDY: Number(p[cfg.assets.hUSDY.sac]) / 1e7,
      hXAU: Number(p[cfg.assets.hXAU.sac]) / 1e7,
      USDTRY: this.usdTry ? Number(this.usdTry) / 1e7 : null,
      husdyApy: this.d.husdyApy,
      daysPerMinute: this.d.daysPerMinute,
      acceleratedDays: this.acceleratedYears() * 365,
      startedAt: this.startedAt,
      note: "Demo: hUSDY fiyatı hızlandırılmış zamanla artar; hXAU tabana rastgele yürüyüş.",
    };
  }
}

export { fromStroops };
