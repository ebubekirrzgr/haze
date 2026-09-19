/**
 * Aktif havuza (Blend ya da HazeCredit; ikisi de aynı `submit` arayüzü) hazineden USDC likiditesi yatırır (Supply).
 * Kart borçları havuzun kendi bakiyesinden aktarılır; kullanıcı teminatına ek olarak bu likidite borç kapasitesini artırır.
 *
 *   pnpm --filter @haze/scripts pool:supply [amount=100] [code=USDC]     ör. pool:supply 200 · pool:supply 20000 hTRY · pool:supply all
 *   "all": USDC 200 + her fiat rezerve ASSET_META.mmSize kadar likidite.
 */
import { ASSET_META, FIAT_CODES, activePool, type AssetCode } from "@haze/stellar";
import { keyFromEnv, readConfig, stellar } from "../lib/common.ts";

const [arg1 = "100", codeArg = "USDC"] = process.argv.slice(2);
const cfg = readConfig();
const pool = activePool(cfg);
if (!pool) throw new Error("aktif havuz yok (blend.pool / haze.hazeCredit boş)");
const treasury = keyFromEnv("TREASURY_SECRET");
const plan: [AssetCode, number][] = arg1 === "all"
  ? [["USDC", 200], ...FIAT_CODES.filter((c) => cfg.assets[c]?.sac).map((c) => [c, Number(ASSET_META[c].mmSize)] as [AssetCode, number])]
  : [[codeArg as AssetCode, Number(arg1)]];
for (const [code, amount] of plan) {
  const sac = cfg.assets[code]?.sac;
  if (!sac) throw new Error(`${code} SAC yok`);
  const stroops = BigInt(Math.round(amount * 1e7)).toString();
  const requests = JSON.stringify([{ request_type: 0, address: sac, amount: stroops }]);
  stellar([
    "contract", "invoke", "--id", pool, "--source-account", treasury.secret(), "--network", "testnet", "--",
    "submit", "--from", treasury.publicKey(), "--spender", treasury.publicKey(), "--to", treasury.publicKey(), "--requests", requests,
  ]);
  console.log(`✓ ${cfg.blend.mode} havuzuna (${pool.slice(0, 8)}…) ${amount} ${code} likidite yatırıldı`);
}
