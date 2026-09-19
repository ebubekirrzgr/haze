/**
 * HazeCredit havuzuna hazineden USDC likiditesi yatırır (Supply). Kart borçları havuzun kendi
 * bakiyesinden aktarılır; kullanıcı teminatına ek olarak bu likidite borç kapasitesini artırır.
 *
 *   pnpm --filter @haze/scripts pool:supply [usdc=100]
 * Yalnızca blend.mode = hazecredit için; Blend modunda likiditeyi blend:deploy sağlar.
 */
import { keyFromEnv, readConfig, stellar } from "../lib/common.ts";

const amount = Number(process.argv[2] ?? 100);
const cfg = readConfig();
if (cfg.blend.mode !== "hazecredit" || !cfg.haze.hazeCredit) throw new Error("blend.mode hazecredit değil ya da HazeCredit dağıtılmamış");
const treasury = keyFromEnv("TREASURY_SECRET");
const stroops = BigInt(Math.round(amount * 1e7)).toString();
const requests = JSON.stringify([{ request_type: 0, address: cfg.assets.USDC.sac, amount: stroops }]);
stellar([
  "contract", "invoke", "--id", cfg.haze.hazeCredit, "--source-account", treasury.secret(), "--network", "testnet", "--",
  "submit", "--from", treasury.publicKey(), "--spender", treasury.publicKey(), "--to", treasury.publicKey(), "--requests", requests,
]);
console.log(`✓ HazeCredit'e ${amount} USDC likidite yatırıldı (${treasury.publicKey().slice(0, 6)}…)`);
