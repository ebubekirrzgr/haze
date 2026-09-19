import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@stellar/stellar-sdk";
import { toStroops, type HazeConfig } from "@haze/stellar";
import { buildApp, buildServices } from "./app.ts";
import type { Env } from "./env.ts";
import { FakeChain, USDC } from "./fake-chain.ts";

function env(): Env {
  const cfg: HazeConfig = {
    network: "testnet",
    networkPassphrase: "Test SDF Network ; September 2015",
    rpcUrl: "http://rpc.invalid",
    horizonUrl: "http://horizon.invalid",
    anchorHomeDomain: "anchor.invalid",
    anchorTreasury: "GANCHOR",
    anchorUsdcIssuer: "GISSUER",
    accounts: { sponsor: "", operator: "", issuer: "", distributor: "", treasury: "", settlement: "", oracleAdmin: "" },
    assets: {
      USDC: { code: "USDC", issuer: Keypair.random().publicKey(), sac: USDC },
      hUSDY: { code: "hUSDY", issuer: "", sac: "CHUSDY" },
      hXAU: { code: "hXAU", issuer: "", sac: "CHXAU" },
      hNVDA: { code: "hNVDA", issuer: "", sac: "CHNVDA" },
      hSHEL: { code: "hSHEL", issuer: "", sac: "CHSHEL" },
      hBMW: { code: "hBMW", issuer: "", sac: "CHBMW" },
      hTRY: { code: "hTRY", issuer: "", sac: "" },
      hEUR: { code: "hEUR", issuer: "", sac: "" },
      hGBP: { code: "hGBP", issuer: "", sac: "" },
      hCHF: { code: "hCHF", issuer: "", sac: "" },
      hARS: { code: "hARS", issuer: "", sac: "" },
      hBRL: { code: "hBRL", issuer: "", sac: "" },
    },
    blend: { mode: "hazecredit", poolFactory: "", backstop: "", emitter: "", blndToken: "", lpToken: "", pool: "", oracle: "" },
    haze: { vaultWasmHash: "", vaultFactory: "CFACTORY", hazeCredit: "CPOOL", mockOracle: "CORACLE" },
  };
  return {
    cfg,
    port: 0,
    dbPath: ":memory:",
    sponsor: Keypair.random(),
    operator: Keypair.random(),
    settlement: Keypair.random(),
    treasury: Keypair.random(),
    oracleAdmin: Keypair.random(),
    lithic: { apiKey: "", webhookSecret: "", eventSecret: "", baseUrl: "", enabled: false },
    yieldAccelerationDaysPerMinute: 1,
    husdyApy: 0.05,
    priceIntervalSec: 30,
    creditCacheSec: 10,
    verifyAsaHmac: false,
    publicUrl: "http://localhost",
  };
}

test("uçtan uca (sahte zincir): kart oluştur → terminal 450 TL → onay → borç → kredi ekranı", async () => {
  const chain = new FakeChain();
  const s = buildServices(env(), chain);
  s.prices.usdTry = toStroops("36"); // 1 USD = 36 TL
  const app = buildApp(s);
  const user = "GUSER";
  s.db.upsertUser({ id: user, g_address: user, vault_address: "CVAULT" });

  const card = await (await app.request("/card/create", { method: "POST", body: JSON.stringify({ userId: user }), headers: { "content-type": "application/json" } })).json();
  assert.ok(card.token.startsWith("demo_"));

  const charge = await (
    await app.request("/terminal/charge", { method: "POST", body: JSON.stringify({ userId: user, amountTry: 450, merchant: "KAFE", city: "BURSA" }), headers: { "content-type": "application/json" } })
  ).json();
  assert.equal(charge.result, "APPROVED");
  assert.equal(charge.usdCents, 1250); // 450 / 36 = 12.50
  await s.card.drainQueue();
  assert.equal(chain.borrowCalls.length, 1);
  assert.equal(chain.borrowCalls[0].amount, toStroops("12.5"));

  const credit = await (await app.request(`/credit/${user}?fresh=1`)).json();
  assert.equal(credit.reserves.find((r: { code: string }) => r.code === "USDC").liabilitiesFloat, 12.5);
  assert.ok(credit.credit.availableLimitFloat < 1070.84);

  const holds = await (await app.request(`/users/${user}/holds`)).json();
  assert.equal(holds[0].status, "BORROWED");
  assert.equal(holds[0].merchant_try, "450.00");

  // clearing
  await app.request("/terminal/clear", { method: "POST", body: JSON.stringify({ token: charge.token }), headers: { "content-type": "application/json" } });
  assert.equal(s.db.hold(holds[0].auth_id)!.status, "CLEARED");

  const notes = await (await app.request(`/users/${user}/notifications`)).json();
  assert.ok(notes.some((n: { kind: string }) => n.kind === "card_approved"));
});

test("sponsor: imzasız / izinsiz işlem reddedilir", async () => {
  const s = buildServices(env(), new FakeChain());
  const app = buildApp(s);
  const r = await app.request("/tx/sponsor", { method: "POST", body: JSON.stringify({ xdr: "AAAA" }), headers: { "content-type": "application/json" } });
  assert.equal(r.status, 400);
});
