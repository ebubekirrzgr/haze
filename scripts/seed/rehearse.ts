/**
 * PWA akışı provası — tarayıcının yaptığı çağrıları sıfırdan bir anahtarla, sunucuya karşı tekrarlar.
 * Passkey yerine rastgele anahtar imzalar; her işlem PWA'daki gibi /tx/sponsor üzerinden fee-bump'lanır.
 *
 *   pnpm --filter @haze/scripts rehearse [salaryTry=1000] [chargeTry=100]
 * Ortam: API_URL (varsayılan http://localhost:8787). haze-api çalışıyor olmalı.
 *
 * Sahneler: sponsorlu hesap → create_vault → SEP-10 → kart → maaş (SEP-38 + SEP-6 + settle_salary)
 *           → Kazan'dan çek → dağılım (2× path payment + 3× deposit) → kart harcaması → BORROWED → clearing
 *           → nakde çevir (hUSDY: vault.withdraw + SEP-38/SEP-6 withdraw-exchange + anchor'a memo'lu path payment)
 */
import { Asset, Keypair, Networks, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import {
  AnchorClient,
  FactoryClient,
  SorobanClient,
  VaultClient,
  buildPathPaymentStrictReceive,
  estimateSendAmount,
  loadBalances,
  toStroops,
} from "@haze/stellar";
import { readConfig } from "../lib/common.ts";

const [salaryTryArg = "1000", chargeTryArg = "100", cashoutTryArg = "100"] = process.argv.slice(2);
const API = process.env.API_URL ?? "http://localhost:8787";
const cfg = readConfig();
const soroban = new SorobanClient(cfg.rpcUrl, cfg.networkPassphrase);
const user = Keypair.random();
const pub = user.publicKey();
const t0 = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

async function post<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(`${path} ${r.status}: ${j.error ?? JSON.stringify(j)}`);
  return j;
}
async function get<T = Record<string, unknown>>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`);
  return (await r.json()) as T;
}
/** PWA'daki signAndSponsor: sahip imzalar, sponsor fee-bump eder */
async function sponsor(tx: Transaction): Promise<string> {
  tx.sign(user);
  const r = await post<{ hash: string }>("/tx/sponsor", { xdr: tx.toXDR() });
  return r.hash;
}
const asset = (code: "USDC" | "hUSDY" | "hXAU") => new Asset(cfg.assets[code].code, cfg.assets[code].issuer);
const sac = (code: "USDC" | "hUSDY" | "hXAU") => cfg.assets[code].sac;

console.log(`prova kullanıcısı: ${pub}\n`);

// 1) sponsorlu hesap (0 XLM, trustline'lar sponsorlu)
const ob = await post<{ xdr: string }>("/onboard", { publicKey: pub });
const obTx = TransactionBuilder.fromXDR(ob.xdr, cfg.networkPassphrase) as Transaction;
obTx.sign(user);
const obRes = await post<{ hash: string }>("/onboard/submit", { xdr: obTx.toXDR() });
log(`✓ sponsorlu hesap açıldı ${obRes.hash.slice(0, 8)}…`);

// 2) vault
const factory = new FactoryClient(soroban, cfg.haze.vaultFactory);
const { tx: cvTx } = await factory.createVault(pub);
const cvHash = await sponsor(cvTx);
const reg = await post<{ vaultAddress: string }>("/vault/register", { publicKey: pub });
const vault = reg.vaultAddress;
log(`✓ vault ${vault} (${cvHash.slice(0, 8)}…)`);

// 3) SEP-10 + kart
const anchor = new AnchorClient(cfg.anchorHomeDomain, cfg.networkPassphrase);
await anchor.discover();
const jwt = await anchor.authenticate(pub, (x) => {
  const t = TransactionBuilder.fromXDR(x, Networks.TESTNET) as Transaction;
  t.sign(user);
  return t.toXDR();
});
await post("/anchor/token", { userId: pub, jwt });
const card = await post<{ last4: string }>("/card/create", { userId: pub });
log(`✓ SEP-10 JWT + kart •••• ${card.last4}`);

// 4) maaş: SEP-38 + SEP-6 deposit-exchange + settle_salary (allowance yoksa kural çağırmaz; PWA'daki gibi önce approve)
const vaultClient = new VaultClient(soroban, vault);
const ledger = (await soroban.server.getLatestLedger()).sequence;
const expiry = ledger + 17280 * 30;
const { buildApprove } = await import("@haze/stellar");
const { tx: apTx } = await buildApprove(soroban, pub, sac("USDC"), vault, toStroops("10000"), expiry);
await sponsor(apTx);
await post("/allowance", { userId: pub, amount: toStroops("10000").toString(), expiryLedger: expiry });
log("✓ maaş allowance 10.000 USDC");
const sal = await post<{ parts: { usdc: string; status: string }[]; settle: { ok: boolean; detail?: string; reason?: string; collateralAdded?: string } }>(
  "/salary/start",
  { userId: pub, amountTry: Number(salaryTryArg) },
);
if (!sal.settle.ok) throw new Error(`settle başarısız: ${sal.settle.reason} ${sal.settle.detail ?? ""}`);
log(`✓ maaş ${salaryTryArg} TL → ${sal.parts.map((p) => p.usdc).join("+")} USDC → settle_salary (teminata ${Number(sal.settle.collateralAdded) / 1e7} USDC)`);

// 5) Kazan'dan çek (USDC → cüzdan) — dağılım için
const withdrawUsdc = "10";
const { tx: wdTx } = await vaultClient.withdraw(pub, sac("USDC"), toStroops(withdrawUsdc));
await sponsor(wdTx);
log(`✓ vault.withdraw ${withdrawUsdc} USDC → cüzdan`);

// 6) dağılım: %50 USDC / %30 hUSDY / %20 hXAU — 2× path payment (strict receive) + 3× deposit
const prices = await get<{ hUSDY: number; hXAU: number }>("/prices");
const total = Number(withdrawUsdc);
const husdyAmt = (total * 0.3) / prices.hUSDY;
const hxauAmt = (total * 0.2) / prices.hXAU;
for (const [code, amt] of [["hUSDY", husdyAmt], ["hXAU", hxauAmt]] as const) {
  const dest = toStroops(amt.toFixed(7));
  const est = await estimateSendAmount(cfg, asset("USDC"), asset(code), dest);
  if (!est) throw new Error(`USDC → ${code} yolu yok`);
  const tx = await buildPathPaymentStrictReceive(cfg, pub, { sendAsset: asset("USDC"), sendMax: (est.sendAmount * 101n) / 100n, destination: pub, destAsset: asset(code), destAmount: dest, path: est.path });
  const h = await sponsor(tx);
  log(`✓ path payment USDC → ${amt.toFixed(6)} ${code} (${h.slice(0, 8)}…)`);
}
const bal = await loadBalances(cfg, pub);
for (const code of ["USDC", "hUSDY", "hXAU"] as const) {
  const amt = bal[code] ?? 0n;
  if (amt <= 0n) continue;
  const { tx } = await vaultClient.deposit(pub, sac(code), amt);
  const h = await sponsor(tx);
  log(`✓ deposit ${Number(amt) / 1e7} ${code} → vault (${h.slice(0, 8)}…)`);
}
await post("/rules", { userId: pub, allocation: { USDC: 50, hUSDY: 30, hXAU: 20 } }).catch(() => {});

// 7) kart harcaması → operatör kuyruğu → BORROWED → clearing
// Lithic açıksa yetkilendirme Lithic'e gider ve ASA bize asenkron gelir (yanıtta result yok); kapalıysa ASA cevabı doğrudan döner.
const ch = await post<{ via: "direct" | "lithic"; result?: string; token: string; usdCents: number; usdc?: string }>("/terminal/charge", { userId: pub, amountTry: Number(chargeTryArg), merchant: "PROVA", city: "ISTANBUL" });
if (ch.via === "direct") {
  log(`✓ ASA (direct) ${ch.result} ${chargeTryArg} TL = ${ch.usdCents / 100} USD`);
  if (ch.result !== "APPROVED") throw new Error("ASA onaylamadı");
} else log(`✓ Lithic simulate/authorize ${ch.token.slice(0, 8)}… ${chargeTryArg} TL = ${ch.usdCents / 100} USD, ASA bekleniyor`);
let status = "PENDING";
for (let i = 0; i < 30 && (status === "PENDING" || status === "NONE"); i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const holds = await get<{ status: string; error?: string | null; lithic_token: string }[]>(`/users/${pub}/holds`);
  const h = holds.find((x) => x.lithic_token === ch.token);
  status = h?.status ?? "NONE";
  if (status === "FAILED" || status === "DECLINED") throw new Error(`hold ${status}: ${h?.error ?? ""}`);
}
if (status === "NONE") throw new Error("ASA isteği gelmedi (Lithic webhook / tünel?)");
log(`✓ ASA onaylandı, hold ${status}`);
await post("/terminal/clear", { token: ch.token });

// 8) nakde çevir: hUSDY'den — PWA'daki sıra: teklif → vault.withdraw → hazineye memo'lu path payment (hUSDY → tam USDC) → anchor durumu
const instr = await post<{ id: string; usdcAmount: string; tryAmount: string; treasury: string; memo: string }>("/cashout/start", { userId: pub, amountTry: Number(cashoutTryArg) });
const usdcOut = toStroops(Number(instr.usdcAmount).toFixed(7));
const needHusdy = (Number(instr.usdcAmount) / prices.hUSDY) * 1.01;
const { tx: cwTx } = await vaultClient.withdraw(pub, sac("hUSDY"), toStroops(needHusdy.toFixed(7)));
await sponsor(cwTx);
const estOut = await estimateSendAmount(cfg, asset("hUSDY"), asset("USDC"), usdcOut);
if (!estOut) throw new Error("hUSDY → USDC yolu yok");
const ppTx = await buildPathPaymentStrictReceive(cfg, pub, { sendAsset: asset("hUSDY"), sendMax: (estOut.sendAmount * 101n) / 100n, destination: instr.treasury, destAsset: asset("USDC"), destAmount: usdcOut, path: estOut.path, memoId: instr.memo });
const ppHash = await sponsor(ppTx);
let st = "pending";
for (let i = 0; i < 30 && st !== "completed" && st !== "error"; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  st = (await get<{ status: string }>(`/cashout/${pub}/${instr.id}`)).status;
}
log(`✓ nakde çevir ${cashoutTryArg} TL: withdraw ${needHusdy.toFixed(4)} hUSDY → path payment ${instr.usdcAmount} USDC → anchor (${ppHash.slice(0, 8)}…) durum ${st}`);
if (st !== "completed") throw new Error(`anchor çekimi tamamlanmadı: ${st}`);

const credit = await get<{ poolMode: string; reserves: { code: string; collateralFloat: number; liabilitiesFloat: number }[]; credit: { availableLimitFloat: number } }>(`/credit/${pub}`);
console.log(`\nSonuç (${credit.poolMode}):`);
for (const r of credit.reserves) console.log(`  ${r.code.padEnd(6)} teminat ${r.collateralFloat}  borç ${r.liabilitiesFloat}`);
console.log(`  limit ${credit.credit.availableLimitFloat} USDC`);
console.log(`\nProva tamam. Bu hesap atılabilir; PWA'da denemek için gizli anahtar: ${user.secret()}`);
