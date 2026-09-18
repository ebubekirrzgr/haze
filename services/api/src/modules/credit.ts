/**
 * Kredi motoru: pozisyon + fiyat önbelleği, limit hesabı, ASA kararı.
 */
import {
  authorizeCard,
  creditSnapshot,
  reserveParams,
  toFloat,
  type AuthorizeDecision,
  type CardState,
  type CreditSnapshot,
  type PoolState,
  type PositionAmounts,
} from "@haze/stellar";
import type { ChainOps } from "../chain.ts";
import type { Db, UserRow } from "../db.ts";

export interface UserCredit {
  user: UserRow;
  vault: string;
  pool: PoolState;
  positions: PositionAmounts;
  card: CardState;
  openHolds: bigint;
  snapshot: CreditSnapshot;
  fetchedAt: number;
}

export class CreditService {
  private cache = new Map<string, UserCredit>();
  constructor(
    private readonly db: Db,
    private readonly chain: ChainOps,
    private readonly usdcSac: string,
    private readonly cacheMs = 10_000,
    private readonly targetHealth = 1.25,
  ) {}

  invalidate(userId: string) {
    this.cache.delete(userId);
  }

  async get(userId: string, fresh = false): Promise<UserCredit> {
    const cached = this.cache.get(userId);
    if (!fresh && cached && Date.now() - cached.fetchedAt < this.cacheMs) {
      // hold'lar DB'den her seferinde okunur (ucuz)
      const openHolds = this.db.openHoldsUsdc(userId);
      if (openHolds !== cached.openHolds) return this.recompute({ ...cached, openHolds });
      return cached;
    }
    const user = this.db.user(userId);
    if (!user?.vault_address) throw new Error(`user ${userId} has no vault`);
    const vault = user.vault_address;
    const [pool, positions, card] = await Promise.all([
      this.chain.poolState(),
      this.chain.vaultPositions(vault),
      this.chain.cardState(vault),
    ]);
    const openHolds = this.db.openHoldsUsdc(userId);
    const uc = this.recompute({ user, vault, pool, positions, card, openHolds, snapshot: undefined as unknown as CreditSnapshot, fetchedAt: Date.now() });
    this.cache.set(userId, uc);
    return uc;
  }

  private recompute(uc: UserCredit): UserCredit {
    const snapshot = creditSnapshot({
      positions: uc.positions,
      reserves: reserveParams(uc.pool),
      usdcAsset: this.usdcSac,
      openHolds: uc.openHolds,
      targetHealth: this.targetHealth,
    });
    const next = { ...uc, snapshot };
    this.cache.set(uc.user.id, next);
    return next;
  }

  /** ASA kararı (hızlı yol; önbellekten) */
  async decide(userId: string, amountUsdc: bigint): Promise<{ decision: AuthorizeDecision; credit: UserCredit }> {
    const credit = await this.get(userId);
    const decision = authorizeCard({
      positions: credit.positions,
      reserves: reserveParams(credit.pool),
      usdcAsset: this.usdcSac,
      openHolds: credit.openHolds,
      targetHealth: this.targetHealth,
      amount: amountUsdc,
      frozen: credit.card.frozen,
      dailyLimit: credit.card.daily_limit,
      spentToday: credit.card.spent_today,
    });
    return { decision, credit };
  }

  /** Güncel USDC borcu (settle_salary için) */
  async usdcDebt(userId: string): Promise<bigint> {
    const c = await this.get(userId, true);
    return c.positions.liabilities[this.usdcSac] ?? 0n;
  }

  /** API çıktısı */
  toJson(c: UserCredit) {
    const reserves = c.pool.reserves.map((r) => ({
      code: r.code,
      asset: r.asset,
      price: r.price.toString(),
      priceFloat: toFloat(r.price),
      c_factor: r.c_factor,
      l_factor: r.l_factor,
      supplyApr: r.supplyApr,
      borrowApr: r.borrowApr,
      collateral: (c.positions.collateral[r.asset] ?? 0n).toString(),
      collateralFloat: toFloat(c.positions.collateral[r.asset] ?? 0n),
      liabilities: (c.positions.liabilities[r.asset] ?? 0n).toString(),
      liabilitiesFloat: toFloat(c.positions.liabilities[r.asset] ?? 0n),
    }));
    return {
      vault: c.vault,
      poolMode: c.pool.mode,
      reserves,
      card: {
        frozen: c.card.frozen,
        dailyLimit: c.card.daily_limit.toString(),
        dailyLimitFloat: toFloat(c.card.daily_limit),
        spentToday: c.card.spent_today.toString(),
        spentTodayFloat: toFloat(c.card.spent_today),
      },
      openHolds: c.openHolds.toString(),
      credit: {
        availableLimit: c.snapshot.availableLimit.toString(),
        availableLimitFloat: toFloat(c.snapshot.availableLimit),
        effectiveCollateralFloat: toFloat(c.snapshot.effectiveCollateral),
        effectiveLiabilitiesFloat: toFloat(c.snapshot.effectiveLiabilitiesWithHolds),
        collateralValueFloat: toFloat(c.snapshot.collateralValue),
        debtValueFloat: toFloat(c.snapshot.debtValue),
        healthFactor: Number.isFinite(c.snapshot.healthFactor) ? c.snapshot.healthFactor : null,
        targetHealth: this.targetHealth,
      },
      fetchedAt: c.fetchedAt,
    };
  }
}
