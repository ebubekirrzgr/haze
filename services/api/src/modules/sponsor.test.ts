import { test } from "node:test";
import assert from "node:assert/strict";
import { Account, Asset, Contract, Keypair, Memo, Networks, Operation, TransactionBuilder, nativeToScVal, Address } from "@stellar/stellar-sdk";
import type { HazeConfig } from "@haze/stellar";
import { checkAllowlist, hasSourceSignature, RateLimiter } from "./sponsor.ts";

const user = Keypair.random();
const other = Keypair.random();
const issuer = Keypair.random().publicKey();
const VAULT = "CDS3FDGQ4JA2V3F26Y4BMWWJEC5TT26RJBN7KIQKUMVO2MAOCMDTSZ7A";
const FACTORY = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVAX5";
const USDC_SAC = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHK3M";
const TREASURY = Keypair.random().publicKey();

const cfg = {
  networkPassphrase: Networks.TESTNET,
  assets: {
    USDC: { code: "USDC", issuer, sac: USDC_SAC },
    hUSDY: { code: "hUSDY", issuer, sac: "" },
    hXAU: { code: "hXAU", issuer, sac: "" },
    hNVDA: { code: "hNVDA", issuer, sac: "" },
    hSHEL: { code: "hSHEL", issuer, sac: "" },
    hBMW: { code: "hBMW", issuer, sac: "" },
    hTRY: { code: "hTRY", issuer, sac: "" },
  },
  haze: { vaultFactory: FACTORY, vaultWasmHash: "", hazeCredit: "", mockOracle: "" },
} as unknown as HazeConfig;

const ctx = { cfg, vaultOf: async (g: string) => (g === user.publicKey() ? VAULT : null), anchorTreasury: TREASURY };
const build = (ops: ReturnType<typeof Operation.payment>[], memo?: Memo, src = user.publicKey()) => {
  const b = new TransactionBuilder(new Account(src, "1"), { fee: "100", networkPassphrase: Networks.TESTNET });
  for (const o of ops) b.addOperation(o);
  if (memo) b.addMemo(memo);
  return b.setTimeout(30).build();
};
const usdc = new Asset("USDC", issuer);
const husdy = new Asset("hUSDY", issuer);

test("kendi vault'una deposit izinli, operatör fonksiyonu değil", async () => {
  const ok = build([new Contract(VAULT).call("deposit", new Address(USDC_SAC).toScVal(), nativeToScVal(10n, { type: "i128" }))]);
  assert.equal((await checkAllowlist(ok, ctx)).ok, true);
  const bad = build([new Contract(VAULT).call("borrow_for_card", nativeToScVal(10n, { type: "i128" }))]);
  assert.equal((await checkAllowlist(bad, ctx)).ok, false);
});

test("başkasının vault'u reddedilir", async () => {
  const tx = build([new Contract(VAULT).call("deposit", new Address(USDC_SAC).toScVal(), nativeToScVal(10n, { type: "i128" }))], undefined, other.publicKey());
  const v = await checkAllowlist(tx, ctx);
  assert.equal(v.ok, false);
});

test("factory create_vault yalnızca kendi adına", async () => {
  const ok = build([new Contract(FACTORY).call("create_vault", new Address(user.publicKey()).toScVal(), nativeToScVal(null))]);
  assert.equal((await checkAllowlist(ok, ctx)).ok, true);
  const bad = build([new Contract(FACTORY).call("create_vault", new Address(other.publicKey()).toScVal(), nativeToScVal(null))]);
  assert.equal((await checkAllowlist(bad, ctx)).ok, false);
});

test("USDC approve yalnızca kendi vault'una", async () => {
  const ok = build([new Contract(USDC_SAC).call("approve", new Address(user.publicKey()).toScVal(), new Address(VAULT).toScVal(), nativeToScVal(5n, { type: "i128" }), nativeToScVal(100, { type: "u32" }))]);
  assert.equal((await checkAllowlist(ok, ctx)).ok, true);
  const bad = build([new Contract(USDC_SAC).call("approve", new Address(user.publicKey()).toScVal(), new Address(FACTORY).toScVal(), nativeToScVal(5n, { type: "i128" }), nativeToScVal(100, { type: "u32" }))]);
  assert.equal((await checkAllowlist(bad, ctx)).ok, false);
  const bad2 = build([new Contract(USDC_SAC).call("transfer", new Address(user.publicKey()).toScVal(), new Address(VAULT).toScVal(), nativeToScVal(5n, { type: "i128" }))]);
  assert.equal((await checkAllowlist(bad2, ctx)).ok, false);
});

test("path payment izinli varlıklarla; XLM değil", async () => {
  const ok = build([Operation.pathPaymentStrictReceive({ sendAsset: usdc, sendMax: "10", destination: user.publicKey(), destAsset: husdy, destAmount: "9", path: [] })]);
  assert.equal((await checkAllowlist(ok, ctx)).ok, true);
  const bad = build([Operation.pathPaymentStrictReceive({ sendAsset: Asset.native(), sendMax: "10", destination: user.publicKey(), destAsset: husdy, destAmount: "9", path: [] })]);
  assert.equal((await checkAllowlist(bad, ctx)).ok, false);
  const badDest = build([Operation.pathPaymentStrictReceive({ sendAsset: usdc, sendMax: "10", destination: other.publicKey(), destAsset: husdy, destAmount: "9", path: [] })]);
  assert.equal((await checkAllowlist(badDest, ctx)).ok, false);
});

test("anchor hazinesine memo'lu USDC ödemesi; memo yoksa red; başka hedef red", async () => {
  const ok = build([Operation.payment({ destination: TREASURY, asset: usdc, amount: "5" })], Memo.id("123"));
  assert.equal((await checkAllowlist(ok, ctx)).ok, true);
  const noMemo = build([Operation.payment({ destination: TREASURY, asset: usdc, amount: "5" })]);
  assert.equal((await checkAllowlist(noMemo, ctx)).ok, false);
  const wrongDest = build([Operation.payment({ destination: other.publicKey(), asset: usdc, amount: "5" })], Memo.id("1"));
  assert.equal((await checkAllowlist(wrongDest, ctx)).ok, false);
});

test("hız sınırı", () => {
  const rl = new RateLimiter(2);
  assert.equal(rl.allow("a", 0), true);
  assert.equal(rl.allow("a", 1), true);
  assert.equal(rl.allow("a", 2), false);
  assert.equal(rl.allow("a", 61_000), true);
});

test("kaynak imzası doğrulanır", () => {
  const tx = build([Operation.payment({ destination: TREASURY, asset: usdc, amount: "5" })], Memo.id("1"));
  assert.equal(hasSourceSignature(tx), false);
  tx.sign(other);
  assert.equal(hasSourceSignature(tx), false);
  tx.sign(user);
  assert.equal(hasSourceSignature(tx), true);
});
