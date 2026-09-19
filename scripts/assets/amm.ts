/**
 * Adım 5 — klasik AMM havuzları: USDC/<her RWA> ve USDC/hTRY. Treasury likidite koyar.
 * Fiyatlar başlangıç oracle fiyatıyla aynı (ASSET_META.baseUsd / <CODE>_USD env). Market maker botu ayrıca teklif defterine emir koyar.
 * Var olan havuza yeniden likidite eklenmez (idempotent); yeni RWA eklenince yalnızca eksik havuzlar açılır.
 *
 *   pnpm --filter @haze/scripts amm [usdcPerPool=100] [usdTry=41]
 */
import { Asset, LiquidityPoolAsset, LiquidityPoolFeeV18, Operation, getLiquidityPoolId } from "@stellar/stellar-sdk";
import { ASSET_META, FIAT_CODES, RWA_CODES, baseUsdOf, type FiatCode, type RwaCode } from "@haze/stellar";
import { horizon, keyFromEnv, readConfig, submitClassic } from "../lib/common.ts";

const [usdcPerPoolArg = "100", usdTryArg = "41"] = process.argv.slice(2);
const usdcPerPool = Number(usdcPerPoolArg);
const usdTry = Number(usdTryArg);

const cfg = readConfig();
const treasury = keyFromEnv("TREASURY_SECRET");
const USDC = new Asset(cfg.assets.USDC.code, cfg.assets.USDC.issuer);

const pools: { code: RwaCode | FiatCode; priceUsd: number }[] = [...RWA_CODES, ...FIAT_CODES].map((code) => ({ code, priceUsd: code === "hTRY" ? 1 / usdTry : baseUsdOf(code, process.env) }));
void ASSET_META;

const server = horizon(cfg);
for (const p of pools) {
  const other = new Asset(cfg.assets[p.code].code, cfg.assets[p.code].issuer);
  // Stellar varlık sıralaması: A < B
  const [a, b] = Asset.compare(USDC, other) < 0 ? [USDC, other] : [other, USDC];
  const lp = new LiquidityPoolAsset(a, b, LiquidityPoolFeeV18);
  const poolId = Buffer.from(getLiquidityPoolId("constant_product", lp.getLiquidityPoolParameters())).toString("hex");
  const amountUsdc = usdcPerPool;
  const amountOther = usdcPerPool / p.priceUsd;
  const [amountA, amountB] = a.equals(USDC) ? [amountUsdc, amountOther] : [amountOther, amountUsdc];
  const price = amountA / amountB; // A/B
  let exists = false;
  try {
    await server.liquidityPools().liquidityPoolId(poolId).call();
    exists = true;
  } catch {
    /* yok */
  }
  if (exists) {
    console.log(`  AMM USDC/${p.code} zaten var, atlandı`);
    continue;
  }
  const hash = await submitClassic(cfg, treasury, [
    Operation.changeTrust({ asset: lp }),
    Operation.liquidityPoolDeposit({
      liquidityPoolId: poolId,
      maxAmountA: amountA.toFixed(7),
      maxAmountB: amountB.toFixed(7),
      minPrice: (price * 0.9).toFixed(7),
      maxPrice: (price * 1.1).toFixed(7),
    }),
  ]);
  console.log(`✓ AMM USDC/${p.code} ${exists ? "(mevcut, likidite eklendi)" : "(yeni)"} ${amountUsdc} USDC + ${amountOther.toFixed(4)} ${p.code} · ${hash.slice(0, 8)}…`);
}
