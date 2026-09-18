import { test } from "node:test";
import assert from "node:assert/strict";
import { authorizeCard, creditSnapshot, type ReserveParams } from "./credit.ts";
import { toStroops, toFloat } from "./amount.ts";

const reserves: Record<string, ReserveParams> = {
  USDC: { asset: "USDC", c_factor: 0.95, l_factor: 0.95, price: toStroops("1") },
  hUSDY: { asset: "hUSDY", c_factor: 0.9, l_factor: 0.1, price: toStroops("1.02") },
  hXAU: { asset: "hXAU", c_factor: 0.75, l_factor: 0.1, price: toStroops("2400") },
};

test("belgedeki örnek: 1.000 USDC + 500 hUSDY → EC 1.409, limit ≈ 1.070", () => {
  const s = creditSnapshot({
    positions: { collateral: { USDC: toStroops("1000"), hUSDY: toStroops("500") }, liabilities: {} },
    reserves,
    usdcAsset: "USDC",
    openHolds: 0n,
  });
  assert.equal(s.effectiveCollateral, toStroops("1409"));
  assert.equal(s.effectiveLiabilities, 0n);
  // 1409 / 1.25 × 0.95 = 1070.84
  assert.ok(Math.abs(toFloat(s.availableLimit) - 1070.84) < 0.01, String(toFloat(s.availableLimit)));
  assert.equal(s.healthFactor, Number.POSITIVE_INFINITY);
});

test("açık hold ve borç limiti düşürür", () => {
  const s = creditSnapshot({
    positions: { collateral: { USDC: toStroops("1000") }, liabilities: { USDC: toStroops("100") } },
    reserves,
    usdcAsset: "USDC",
    openHolds: toStroops("50"),
  });
  // EC = 950; EL = 100/0.95 + 50/0.95 = 157.89
  assert.ok(Math.abs(toFloat(s.effectiveLiabilitiesWithHolds) - 157.894736) < 0.001);
  // limit = (950/1.25 − 157.89) × 0.95 = 572.0
  assert.ok(Math.abs(toFloat(s.availableLimit) - 572.0) < 0.01, String(toFloat(s.availableLimit)));
  assert.ok(Math.abs(s.healthFactor - 950 / 157.894736) < 0.001);
  assert.equal(s.debtValue, toStroops("150"));
});

test("authorizeCard onay ve red nedenleri", () => {
  const base = {
    positions: { collateral: { USDC: toStroops("1000") }, liabilities: {} },
    reserves,
    usdcAsset: "USDC",
    openHolds: 0n,
    frozen: false,
    dailyLimit: toStroops("500"),
    spentToday: 0n,
  };
  const ok = authorizeCard({ ...base, amount: toStroops("12.5") });
  assert.equal(ok.approved, true);
  assert.ok(ok.remainingLimit < ok.snapshot.availableLimit);

  assert.equal(authorizeCard({ ...base, amount: toStroops("10"), frozen: true }).reason, "frozen");
  assert.equal(authorizeCard({ ...base, amount: toStroops("400"), spentToday: toStroops("200") }).reason, "daily_limit");
  // limit 722 → 730 red (sağlık)
  const health = authorizeCard({ ...base, amount: toStroops("730"), dailyLimit: toStroops("10000") });
  assert.equal(health.reason, "health");
  const edge = authorizeCard({ ...base, amount: toStroops("720"), dailyLimit: toStroops("10000") });
  assert.equal(edge.approved, true);
  assert.equal(
    authorizeCard({ ...base, positions: { collateral: {}, liabilities: {} }, amount: toStroops("1") }).reason,
    "no_collateral",
  );
});

test("altın teminatı: getiri yok ama limit var", () => {
  const s = creditSnapshot({
    positions: { collateral: { hXAU: toStroops("0.1") }, liabilities: {} },
    reserves,
    usdcAsset: "USDC",
    openHolds: 0n,
  });
  // 0.1 oz × 2400 × 0.75 = 180 → limit 180/1.25×0.95 = 136.8
  assert.equal(s.effectiveCollateral, toStroops("180"));
  assert.ok(Math.abs(toFloat(s.availableLimit) - 136.8) < 0.01);
});
