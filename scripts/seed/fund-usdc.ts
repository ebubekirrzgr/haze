/**
 * Mock anchor'dan döngüyle testnet USDC al (her tur ≤ 3000 TRY ≈ 70 USDC).
 *   pnpm --filter @haze/scripts fund-usdc -- <ACCOUNT_SECRET_ENV|S...> <turSayısı>
 * Örn: pnpm --filter @haze/scripts fund-usdc -- TREASURY_SECRET 8
 */
import { Keypair, Asset } from "@stellar/stellar-sdk";
import { AnchorClient } from "@haze/stellar";
import { ensureTrustline, keyFromEnv, readConfig, sleep } from "../lib/common.ts";

const [who = "TREASURY_SECRET", roundsArg = "5"] = process.argv.slice(2);
const kp = who.startsWith("S") && who.length === 56 ? Keypair.fromSecret(who) : keyFromEnv(who);
const rounds = Number(roundsArg);
const cfg = readConfig();

await ensureTrustline(cfg, kp, new Asset(cfg.assets.USDC.code, cfg.assets.USDC.issuer));
const anchor = new AnchorClient(cfg.anchorHomeDomain, cfg.networkPassphrase);
await anchor.discover();
await anchor.authenticateWithKeypair(kp);

let total = 0;
for (let i = 0; i < rounds; i++) {
  const amountTry = "3000.00";
  const quote = await anchor.quote({ sell_asset: "iso4217:TRY", buy_asset: anchor.usdcAssetId, sell_amount: amountTry });
  const dep = await anchor.deposit({ account: kp.publicKey(), amountTry, quoteId: quote.id });
  await anchor.simulateBankTransfer(dep.id, amountTry);
  const tx = await anchor.waitForCompletion(dep.id, { onStatus: (s) => process.stdout.write(`\r  tur ${i + 1}/${rounds}: ${s}          `) });
  total += Number(tx.amount_out ?? quote.buy_amount);
  console.log(`\r  tur ${i + 1}/${rounds}: +${tx.amount_out ?? quote.buy_amount} USDC (toplam ${total.toFixed(2)})`);
  await sleep(1000);
}
console.log(`✓ ${kp.publicKey()} → ${total.toFixed(2)} USDC`);
