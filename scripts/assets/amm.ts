/**
 * Adım 5 — klasik AMM havuzları: USDC/hUSDY, USDC/hXAU, USDC/hTRY. Treasury likidite koyar.
 * Fiyatlar başlangıç oracle fiyatıyla aynı. Market maker botu ayrıca teklif defterine emir koyar.
 *
 *   pnpm --filter @haze/scripts amm -- [usdcPerPool=100] [xauUsd=2400] [usdTry=41]
 */
import { Asset, LiquidityPoolAsset, LiquidityPoolFeeV18, Operation, getLiquidityPoolId } from "@stellar/stellar-sdk";
import { horizon, keyFromEnv, readConfig, submitClassic } from "../lib/common.ts";

const [usdcPerPoolArg = "100", xauArg = "2400", usdTryArg = "41"] = process.argv.slice(2);
const usdcPerPool = Number(usdcPerPoolArg);
const xauUsd = Number(xauArg);
const usdTry = Number(usdTryArg);

const cfg = readConfig();
const treasury = keyFromEnv("TREASURY_SECRET");
const USDC = new Asset(cfg.assets.USDC.code, cfg.assets.USDC.issuer);

const pools: { code: "hUSDY" | "hXAU" | "hTRY"; priceUsd: number }[] = [
  { code: "hUSDY", priceUsd: 1.0 },
  { code: "hXAU", priceUsd: xauUsd },
  { code: "hTRY", priceUsd: 1 / usdTry },
];

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
