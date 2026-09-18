/**
 * Kredi motoru — saf hesap. haze-api ASA kararını bu fonksiyonlarla verir.
 *
 * Etkin teminat  EC = Σ miktar × fiyat × c_factor
 * Etkin borç     EL = Σ borç × fiyat / l_factor + açık hold'lar / l_factor(USDC)
 * Onay koşulu    EC / (EL + tutar / l_factor(USDC)) ≥ hedef (1,25)
 * Gösterilen limit (EC / hedef − EL) × l_factor(USDC)
 *
 * Tüm tutarlar 7 ondalık bigint; fiyatlar 7 ondalık (USDC = 1_0000000).
 */
import { SCALAR_7, div7, factor7, mul7 } from "./amount.ts";

export interface ReserveParams {
  /** SAC adresi ya da sembol; sadece anahtar */
  asset: string;
  /** 0.95 gibi */
  c_factor: number;
  l_factor: number;
  /** 7 ondalık fiyat */
  price: bigint;
}

export interface PositionAmounts {
  /** asset → teminat miktarı (7 ondalık, varlık cinsinden) */
  collateral: Record<string, bigint>;
  /** asset → borç miktarı (7 ondalık, varlık cinsinden) */
  liabilities: Record<string, bigint>;
}

export interface CreditSnapshot {
  effectiveCollateral: bigint;
  effectiveLiabilities: bigint;
  /** açık hold'lar dahil */
  effectiveLiabilitiesWithHolds: bigint;
  /** Kullanıcıya gösterilen harcanabilir USDC limiti (7 ondalık) */
  availableLimit: bigint;
  /** EC / EL (hold'lar dahil); borç yoksa Infinity */
  healthFactor: number;
  /** Toplam teminat değeri (USD, 7 ondalık) — c_factor uygulanmamış */
  collateralValue: bigint;
  /** Toplam borç değeri (USD, 7 ondalık) — l_factor uygulanmamış */
  debtValue: bigint;
}

export function effectiveCollateral(pos: PositionAmounts, reserves: Record<string, ReserveParams>): bigint {
  let ec = 0n;
  for (const [asset, amt] of Object.entries(pos.collateral)) {
    const r = reserves[asset];
    if (!r || amt <= 0n) continue;
    ec += mul7(mul7(amt, r.price), factor7(r.c_factor));
  }
  return ec;
}

export function effectiveLiabilities(pos: PositionAmounts, reserves: Record<string, ReserveParams>): bigint {
  let el = 0n;
  for (const [asset, amt] of Object.entries(pos.liabilities)) {
    const r = reserves[asset];
    if (!r || amt <= 0n) continue;
    el += div7(mul7(amt, r.price), factor7(r.l_factor));
  }
  return el;
}

export interface SnapshotInput {
  positions: PositionAmounts;
  reserves: Record<string, ReserveParams>;
  usdcAsset: string;
  /** açık (PENDING/BORROWED-but-unindexed) hold'ların USDC toplamı */
  openHolds: bigint;
  targetHealth?: number;
}

export function creditSnapshot(input: SnapshotInput): CreditSnapshot {
  const target = factor7(input.targetHealth ?? 1.25);
  const usdc = input.reserves[input.usdcAsset];
  if (!usdc) throw new Error("USDC reserve params missing");
  const lUsdc = factor7(usdc.l_factor);

  const ec = effectiveCollateral(input.positions, input.reserves);
  const el = effectiveLiabilities(input.positions, input.reserves);
  const elHolds = el + div7(mul7(input.openHolds, usdc.price), lUsdc);

  // limit = (EC / target − EL) × l_usdc
  const room = div7(ec, target) - elHolds;
  const availableLimit = room > 0n ? mul7(room, lUsdc) : 0n;

  let collateralValue = 0n;
  for (const [asset, amt] of Object.entries(input.positions.collateral)) {
    const r = input.reserves[asset];
    if (r && amt > 0n) collateralValue += mul7(amt, r.price);
  }
  let debtValue = 0n;
  for (const [asset, amt] of Object.entries(input.positions.liabilities)) {
    const r = input.reserves[asset];
    if (r && amt > 0n) debtValue += mul7(amt, r.price);
  }
  debtValue += mul7(input.openHolds, usdc.price);

  const healthFactor = elHolds === 0n ? Number.POSITIVE_INFINITY : Number(ec) / Number(elHolds);

  return {
    effectiveCollateral: ec,
    effectiveLiabilities: el,
    effectiveLiabilitiesWithHolds: elHolds,
    availableLimit,
    healthFactor,
    collateralValue,
    debtValue,
  };
}

export type DeclineReason = "frozen" | "daily_limit" | "health" | "no_collateral";

export interface AuthorizeInput extends SnapshotInput {
  /** talep edilen USDC (7 ondalık) */
  amount: bigint;
  frozen: boolean;
  dailyLimit: bigint;
  spentToday: bigint;
}

export interface AuthorizeDecision {
  approved: boolean;
  reason?: DeclineReason;
  snapshot: CreditSnapshot;
  /** onay sonrası kalan limit */
  remainingLimit: bigint;
}

/** ASA kararı. Kontrat tarafında Blend/HazeVault son sözü söyler; bu yalnızca hızlı onay içindir. */
export function authorizeCard(input: AuthorizeInput): AuthorizeDecision {
  const snapshot = creditSnapshot(input);
  const usdc = input.reserves[input.usdcAsset]!;
  const lUsdc = factor7(usdc.l_factor);
  const target = factor7(input.targetHealth ?? 1.25);

  if (input.frozen) return { approved: false, reason: "frozen", snapshot, remainingLimit: snapshot.availableLimit };
  if (snapshot.effectiveCollateral === 0n)
    return { approved: false, reason: "no_collateral", snapshot, remainingLimit: 0n };
  if (input.spentToday + input.amount > input.dailyLimit)
    return { approved: false, reason: "daily_limit", snapshot, remainingLimit: snapshot.availableLimit };

  // EC / (EL_holds + amount/l) ≥ target  ⇔  EC ≥ target × (EL_holds + amount/l)
  const elAfter = snapshot.effectiveLiabilitiesWithHolds + div7(mul7(input.amount, usdc.price), lUsdc);
  const ok = snapshot.effectiveCollateral * SCALAR_7 >= target * elAfter;
  if (!ok) return { approved: false, reason: "health", snapshot, remainingLimit: snapshot.availableLimit };

  const remaining = snapshot.availableLimit - input.amount;
  return { approved: true, snapshot, remainingLimit: remaining > 0n ? remaining : 0n };
}
