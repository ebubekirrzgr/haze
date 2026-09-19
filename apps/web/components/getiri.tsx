"use client";
/** Canlı getiri sayacı: son okunan orana göre saniyelik interpolasyon; 30 sn'de bir zincirden düzeltme. */
import { useEffect, useMemo, useState } from "react";
import { ASSET_META, isYieldByPrice, type AssetCode } from "@haze/stellar/browser";
import type { CreditView, Prices } from "@/lib/api.ts";

export function yieldRates(credit: CreditView, prices?: Prices) {
  const husdyApy = prices?.husdyApy ?? 0.05;
  const accel = (prices?.daysPerMinute ?? 1) * 1440; // 1 dk = N gün → saniye çarpanı
  let valuePerYear = 0;
  let collateralValue = 0;
  const rows = credit.reserves.map((r) => {
    const value = r.collateralFloat * r.priceFloat;
    // hUSDY: fiyat artışı = getiri · altın ve hisseler: getiri yok (değer koruma) · USDC: Blend supply faizi
    const kind = ASSET_META[r.code as AssetCode]?.kind;
    const apy = isYieldByPrice(r.code) ? husdyApy : kind === "gold" || kind === "stock" ? 0 : r.supplyApr;
    valuePerYear += value * apy;
    collateralValue += value;
    return { ...r, value, apy };
  });
  const netApy = collateralValue > 0 ? valuePerYear / collateralValue : 0;
  return { rows, collateralValue, valuePerYear, netApy, accel, perSecond: (valuePerYear / (365 * 86400)) * accel };
}

export function useLiveYield(credit?: CreditView, prices?: Prices) {
  const base = useMemo(() => (credit ? yieldRates(credit, prices) : undefined), [credit, prices]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  if (!credit || !base) return undefined;
  const elapsed = Math.max(0, (now - credit.fetchedAt) / 1000);
  const earned = base.perSecond * elapsed;
  return { ...base, earned, liveValue: base.collateralValue + earned };
}
