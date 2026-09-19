import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { normalizeAsaRequest, toLithicAsaResponse, verifyLithicWebhook } from "./lithic.ts";

const secret = "whsec_" + Buffer.from("test-secret-bytes-0123456789").toString("base64");
const sign = (id: string, ts: string, body: string) =>
  "v1," + createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${id}.${ts}.${body}`).digest("base64");

test("Standard Webhooks imzası: doğru imza geçer, gövde değişirse düşer, eski zaman damgası düşer", () => {
  const body = JSON.stringify({ token: "t1", amount: 918 });
  const now = 1_700_000_000;
  const ts = String(now);
  const headers = { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body) };
  assert.equal(verifyLithicWebhook(secret, body, headers, now), true);
  assert.equal(verifyLithicWebhook(secret, body + " ", headers, now), false);
  assert.equal(verifyLithicWebhook(secret, body, { ...headers, signature: "v1,AAAA" }, now), false);
  assert.equal(verifyLithicWebhook(secret, body, headers, now + 600), false);
  // rotasyon: ikinci imza eşleşir
  assert.equal(verifyLithicWebhook(secret, body, { ...headers, signature: "v1,AAAA " + headers.signature }, now), true);
  assert.equal(verifyLithicWebhook(secret, body, { id: undefined, timestamp: ts, signature: headers.signature }, now), false);
});

test("ASA yükü: Lithic card.token normalize edilir, cevap Lithic sonuç kodlarına eşlenir", () => {
  const { req, fromLithic } = normalizeAsaRequest({ token: "tx", amount: 918, card: { token: "card_abc" }, merchant: { descriptor: "KAFE" } });
  assert.equal(fromLithic, true);
  assert.equal(req.card_token, "card_abc");
  const direct = normalizeAsaRequest({ token: "tx", amount: 1, card_token: "demo_1", merchant: { descriptor: "X" } });
  assert.equal(direct.fromLithic, false);
  assert.deepEqual(toLithicAsaResponse({ result: "APPROVED", haze: { x: 1 } }), { result: "APPROVED" });
  assert.deepEqual(toLithicAsaResponse({ result: "DECLINED", decline_reason: "CARD_FROZEN" }), { result: "CARD_PAUSED" });
  assert.deepEqual(toLithicAsaResponse({ result: "DECLINED", decline_reason: "DAILY_LIMIT_EXCEEDED" }), { result: "VELOCITY_EXCEEDED" });
  assert.deepEqual(toLithicAsaResponse({ result: "DECLINED", decline_reason: "INSUFFICIENT_COLLATERAL" }), { result: "INSUFFICIENT_FUNDS" });
});
