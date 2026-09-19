/**
 * Adım 6 — demo kullanıcı: sponsorlu hesap, vault, önceki aylardan kalma Kazan bakiyesi
 * (USDC + hUSDY + hXAU teminat), maaş allowance'ı, API kaydı, kart ve anchor JWT.
 * Passkey yerine DEMO_USER_SECRET anahtarı imzalar; PWA'da "demo hesabını içe aktar" ile açılır.
 *
 *   pnpm --filter @haze/scripts demo-user -- [usdc=500] [husdy=300] [hxau=0.1]
 * Ortam: API_URL (varsayılan http://localhost:8787) — API çalışmıyorsa API adımları atlanır.
 */
import { Asset, Operation } from "@stellar/stellar-sdk";
import {
  AnchorClient,
  FactoryClient,
  SorobanClient,
  VaultClient,
  buildApprove,
  buildSponsoredAccountCreation,
  classicAsset,
  feeBump,
  toStroops,
} from "@haze/stellar";
import { ensureTrustline, keyFromEnv, readConfig, submitClassic } from "../lib/common.ts";

const [usdcArg = "500", husdyArg = "300", hxauArg = "0.1"] = process.argv.slice(2);
const API = process.env.API_URL ?? "http://localhost:8787";
const cfg = readConfig();
const sponsor = keyFromEnv("SPONSOR_SECRET");
const treasury = keyFromEnv("TREASURY_SECRET");
const user = keyFromEnv("DEMO_USER_SECRET");
const soroban = new SorobanClient(cfg.rpcUrl, cfg.networkPassphrase);
const horizon = (await import("../lib/common.ts")).horizon(cfg);
console.log(`demo kullanıcı: ${user.publicKey()}`);

// 1) sponsorlu hesap (varsa atla)
const assets = (["USDC", "hUSDY", "hXAU", "hTRY"] as const).filter((k) => cfg.assets[k].issuer).map((k) => classicAsset(cfg.assets[k]));
let exists = false;
try {
  await horizon.loadAccount(user.publicKey());
  exists = true;
} catch {
  /* yok */
}
if (!exists) {
  const tx = await buildSponsoredAccountCreation(cfg, sponsor.publicKey(), user.publicKey(), assets);
  tx.sign(sponsor, user);
  const r = await soroban.sendAndWait(tx);
  console.log(`✓ sponsorlu hesap açıldı ${r.hash.slice(0, 8)}…`);
} else {
  // keys.ts demo hesabını friendbot ile fonlar; sponsorlu açılış atlanınca trustline'lar burada açılır.
  console.log("  hesap zaten var");
  for (const a of assets) await ensureTrustline(cfg, user, a);
}

// 2) vault
const factory = new FactoryClient(soroban, cfg.haze.vaultFactory);
let vault = (await factory.getVault(sponsor.publicKey(), user.publicKey())) ?? null;
if (!vault) {
  const { tx } = await factory.createVault(user.publicKey());
  tx.sign(user);
  const r = await soroban.sendAndWait(feeBump(cfg, sponsor, tx));
  vault = (await factory.getVault(sponsor.publicKey(), user.publicKey()))!;
  console.log(`✓ vault ${vault} (${r.hash.slice(0, 8)}…)`);
} else console.log(`  vault zaten var ${vault}`);

// 3) hazine → kullanıcı: USDC, hUSDY, hXAU
const amounts: [keyof typeof cfg.assets, string][] = [
  ["USDC", usdcArg],
  ["hUSDY", husdyArg],
  ["hXAU", hxauArg],
];
const ops = amounts.map(([code, amt]) => Operation.payment({ destination: user.publicKey(), asset: new Asset(cfg.assets[code].code, cfg.assets[code].issuer), amount: Number(amt).toFixed(7) }));
const h = await submitClassic(cfg, treasury, ops);
console.log(`✓ hazineden varlıklar gönderildi ${h.slice(0, 8)}…`);

// 4) Kazan'a ekle (deposit ×3) — her biri sahip imzalı, sponsor fee-bump
const vc = new VaultClient(soroban, vault);
for (const [code, amt] of amounts) {
  const { tx } = await vc.deposit(user.publicKey(), cfg.assets[code].sac, toStroops(Number(amt).toFixed(7)));
  tx.sign(user);
  const r = await soroban.sendAndWait(feeBump(cfg, sponsor, tx));
  console.log(`✓ deposit ${amt} ${code} → vault (${r.hash.slice(0, 8)}…)`);
}

// 5) maaş allowance: 10.000 USDC, ~30 gün
const ledger = (await soroban.server.getLatestLedger()).sequence;
const expiry = ledger + 17280 * 30;
{
  const { tx } = await buildApprove(soroban, user.publicKey(), cfg.assets.USDC.sac, vault, toStroops("10000"), expiry);
  tx.sign(user);
  const r = await soroban.sendAndWait(feeBump(cfg, sponsor, tx));
  console.log(`✓ allowance 10.000 USDC → vault, ledger ${expiry} (${r.hash.slice(0, 8)}…)`);
}

// 6) API kaydı, kart, anchor JWT
try {
  const ok = await fetch(`${API}/health`).then((r) => r.ok).catch(() => false);
  if (!ok) throw new Error("API kapalı");
  await fetch(`${API}/vault/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicKey: user.publicKey() }) });
  await fetch(`${API}/allowance`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: user.publicKey(), amount: toStroops("10000").toString(), expiryLedger: expiry }) });
  const card = await fetch(`${API}/card/create`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: user.publicKey() }) }).then((r) => r.json());
  console.log(`✓ kart: ${JSON.stringify(card)}`);
  const anchor = new AnchorClient(cfg.anchorHomeDomain, cfg.networkPassphrase);
  await anchor.discover();
  const jwt = await anchor.authenticateWithKeypair(user);
  await fetch(`${API}/anchor/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: user.publicKey(), jwt }) });
  console.log(`✓ API kaydı + anchor JWT (${cfg.anchorHomeDomain})`);
} catch (e) {
  console.log(`  API adımları atlandı: ${e instanceof Error ? e.message : e}`);
}
console.log(`\nDemo hazır. PWA'da 'demo hesabını içe aktar' için gizli anahtar: services/api/.env → DEMO_USER_SECRET`);
