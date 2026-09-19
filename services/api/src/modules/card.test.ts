import { test } from "node:test";
import assert from "node:assert/strict";
import { toStroops } from "@haze/stellar";
import { Db } from "../db.ts";
import { FakeChain, USDC } from "../fake-chain.ts";
import { CreditService } from "./credit.ts";
import { CardService } from "./card.ts";

function setup() {
  const db = new Db(":memory:");
  const chain = new FakeChain();
  const credit = new CreditService(db, chain, USDC, 10_000);
  const card = new CardService({ db, chain, credit });
  db.upsertUser({ id: "u1", g_address: "GUSER", vault_address: "CVAULT", card_token: "card_1" });
  return { db, chain, credit, card };
}

const asa = (token: string, cents: number, cardToken = "card_1") => ({
  token,
  card_token: cardToken,
  amount: cents,
  merchant: { descriptor: "KAFE BURSA", mcc: "5814", country: "TUR" },
  haze_try_amount: "450.00",
});

test("onay: hold PENDING yazılır, kuyruk borcu açar, hold BORROWED olur", async () => {
  const { db, chain, card } = setup();
  const res = await card.authorize(asa("auth_1", 1250));
  assert.equal(res.result, "APPROVED");
  assert.ok(res.haze?.authId);
  let h = db.hold(res.haze!.authId as string)!;
  assert.equal(h.status, "PENDING");
  assert.equal(h.usdc_amount, toStroops("12.5").toString());
  await card.drainQueue();
  h = db.hold(h.auth_id)!;
  assert.equal(h.status, "BORROWED");
  assert.equal(h.borrow_tx, "tx1");
  assert.equal(chain.borrowCalls[0].amount, toStroops("12.5"));
  assert.equal(chain.borrowCalls[0].authId, h.auth_id);
  assert.equal(db.notifications("u1").length, 1);
});

test("boş kuyruk turu sonraki turları kilitlemez (setInterval boşta dönerken gelen hold işlenir)", async () => {
  const { db, card } = setup();
  await card.drainQueue(); // boş tur (sunucuda 4 sn'de bir çalışan interval)
  await card.drainQueue();
  const res = await card.authorize(asa("auth_after_idle", 500));
  assert.equal(res.result, "APPROVED");
  await card.drainQueue();
  assert.equal(db.hold(res.haze!.authId as string)!.status, "BORROWED");
});

test("aynı yetkilendirme token'ı ikinci kez reddedilir", async () => {
  const { card } = setup();
  await card.authorize(asa("auth_dup", 100));
  const r2 = await card.authorize(asa("auth_dup", 100));
  assert.equal(r2.result, "DECLINED");
  assert.equal(r2.decline_reason, "DUPLICATE_AUTHORIZATION");
});

test("açık hold limitten düşer; günlük limit ve dondurulmuş kart reddedilir", async () => {
  const { chain, card, credit } = setup();
  const r1 = await card.authorize(asa("a1", 40_000)); // 400 USDC → PENDING (kuyruk henüz çalışmadı olabilir)
  assert.equal(r1.result, "APPROVED");
  const r2 = await card.authorize(asa("a2", 15_000)); // 150 → günlük 500 aşılır
  assert.equal(r2.result, "DECLINED");
  assert.equal(r2.decline_reason, "DAILY_LIMIT_EXCEEDED");
  chain.card = { ...chain.card, frozen: true };
  credit.invalidate("u1");
  const r3 = await card.authorize(asa("a3", 100));
  assert.equal(r3.decline_reason, "CARD_FROZEN");
});

test("teminat yetmezse red", async () => {
  const { chain, card, credit } = setup();
  chain.positions = { collateral: { [USDC]: toStroops("100") }, liabilities: {} };
  chain.card = { ...chain.card, daily_limit: toStroops("10000") };
  credit.invalidate("u1");
  const r = await card.authorize(asa("b1", 9_000)); // limit ≈ 72
  assert.equal(r.decline_reason, "INSUFFICIENT_COLLATERAL");
  const ok = await card.authorize(asa("b2", 7_000));
  assert.equal(ok.result, "APPROVED");
});

test("borç işlemi 3 kez başarısız olursa hold FAILED", async () => {
  const { db, chain, card } = setup();
  chain.failNext = 3;
  const r = await card.authorize(asa("f1", 500));
  const id = r.haze!.authId as string;
  // authorize'ın kendisi de kuyruğu tetikler; drainQueue çalışan turu bekler
  await card.drainQueue();
  assert.equal(db.hold(id)!.status, "PENDING");
  assert.equal(db.hold(id)!.attempts, 1);
  await card.drainQueue();
  assert.equal(db.hold(id)!.attempts, 2);
  await card.drainQueue();
  assert.equal(db.hold(id)!.status, "FAILED");
  assert.equal(db.hold(id)!.attempts, 3);
  assert.ok(db.notifications("u1").some((n) => n.kind === "hold_failed"));
});

test("clearing → CLEARED, void → REFUNDED (hazine iade + refund_for_card)", async () => {
  const { db, chain, card } = setup();
  const r = await card.authorize(asa("c1", 2000));
  const id = r.haze!.authId as string;
  await card.drainQueue();
  await card.onTransactionEvent({ token: "c1", status: "SETTLED" });
  assert.equal(db.hold(id)!.status, "CLEARED");

  const r2 = await card.authorize(asa("v1", 3000));
  const id2 = r2.haze!.authId as string;
  await card.drainQueue();
  await card.onTransactionEvent({ token: "v1", status: "VOIDED" });
  assert.equal(db.hold(id2)!.status, "REFUNDED");
  assert.deepEqual(chain.refunds, [toStroops("30")]);
});

test("bilinmeyen kart reddedilir", async () => {
  const { card } = setup();
  const r = await card.authorize(asa("x", 100, "nope"));
  assert.equal(r.decline_reason, "UNKNOWN_CARD");
});
