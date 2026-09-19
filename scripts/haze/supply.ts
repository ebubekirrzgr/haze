/**
 * Aktif havuza (Blend ya da HazeCredit; ikisi de aynı `submit` arayüzü) hazineden USDC likiditesi yatırır (Supply).
 * Kart borçları havuzun kendi bakiyesinden aktarılır; kullanıcı teminatına ek olarak bu likidite borç kapasitesini artırır.
 *
 *   pnpm --filter @haze/scripts pool:supply [usdc=100]
 */
import { activePool } from "@haze/stellar";
import { keyFromEnv, readConfig, stellar } from "../lib/common.ts";

const amount = Number(process.argv[2] ?? 100);
const cfg = readConfig();
const pool = activePool(cfg);
if (!pool) throw new Error("aktif havuz yok (blend.pool / haze.hazeCredit boş)");
const treasury = keyFromEnv("TREASURY_SECRET");
const stroops = BigInt(Math.round(amount * 1e7)).toString();
const requests = JSON.stringify([{ request_type: 0, address: cfg.assets.USDC.sac, amount: stroops }]);
stellar([
  "contract", "invoke", "--id", pool, "--source-account", treasury.secret(), "--network", "testnet", "--",
  "submit", "--from", treasury.publicKey(), "--spender", treasury.publicKey(), "--to", treasury.publicKey(), "--requests", requests,
]);
console.log(`✓ ${cfg.blend.mode} havuzuna (${pool.slice(0, 8)}…) ${amount} USDC likidite yatırıldı (${treasury.publicKey().slice(0, 6)}…)`);
