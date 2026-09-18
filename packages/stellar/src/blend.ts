/**
 * Havuz durumu ve vault pozisyonlarını tek biçimde okur.
 * mode = "blend": @blend-capital/blend-sdk ile (b/dToken → varlık dönüşümü SDK'da).
 * mode = "hazecredit": HazeCredit'in kendi görünüm fonksiyonları ile.
 */
import { PoolV2, type Network } from "@blend-capital/blend-sdk";
import { xdr } from "@stellar/stellar-sdk";
import type { AssetCode, HazeConfig } from "./config.ts";
import { activeOracle, activePool } from "./config.ts";
import type { PositionAmounts, ReserveParams } from "./credit.ts";
import { SorobanClient, positionsToRecord, sc, type RawPositions } from "./soroban.ts";

export interface ReserveInfo extends ReserveParams {
  code: AssetCode | string;
  index: number;
  /** yıllık, 0.05 = %5 */
  supplyApr: number;
  borrowApr: number;
  /** oracle fiyatının zaman damgası (sn) */
  priceTimestamp: number;
}

export interface PoolState {
  poolId: string;
  mode: "blend" | "hazecredit";
  reserves: ReserveInfo[];
  /** SAC adresi → rezerv */
  byAsset: Record<string, ReserveInfo>;
  byIndex: Record<number, ReserveInfo>;
  loadedAt: number;
}

function codeOf(cfg: HazeConfig, sac: string): AssetCode | string {
  for (const [code, a] of Object.entries(cfg.assets)) if (a.sac === sac) return code;
  return sac.slice(0, 6);
}

/** oracle ondalığı ne olursa olsun 7 ondalığa normalize et */
function normalizePrice(p: bigint, decimals: number): bigint {
  if (decimals === 7) return p;
  return decimals > 7 ? p / 10n ** BigInt(decimals - 7) : p * 10n ** BigInt(7 - decimals);
}

export async function loadPoolState(cfg: HazeConfig, soroban: SorobanClient, reader: string): Promise<PoolState> {
  const poolId = activePool(cfg);
  const reserves: ReserveInfo[] = [];
  if (cfg.blend.mode === "blend") {
    const network: Network = { rpc: cfg.rpcUrl, passphrase: cfg.networkPassphrase };
    const pool = await PoolV2.load(network, poolId);
    const oracle = await pool.loadOracle();
    for (const [assetId, r] of pool.reserves) {
      const price = oracle.getPrice(assetId);
      const pd = oracle.prices.get(assetId);
      reserves.push({
        asset: assetId,
        code: codeOf(cfg, assetId),
        index: r.config.index,
        c_factor: r.config.c_factor / 1e7,
        l_factor: r.config.l_factor / 1e7,
        price: price != null ? normalizePrice(price, oracle.decimals) : 0n,
        priceTimestamp: pd?.timestamp ?? 0,
        supplyApr: r.supplyApr,
        borrowApr: r.borrowApr,
      });
    }
  } else {
    type Cfg = { asset: string; index: number; c_factor: number; l_factor: number; borrow_rate_bps: number };
    const list = await soroban.read<Cfg[]>(reader, poolId, "get_reserves");
    const oracleId = activeOracle(cfg);
    for (const r of list) {
      const pd = await soroban.read<{ price: bigint; timestamp: bigint } | null>(reader, oracleId, "lastprice", [
        xdr.ScVal.scvVec([sc.symbol("Stellar"), sc.address(r.asset)]),
      ]);
      reserves.push({
        asset: r.asset,
        code: codeOf(cfg, r.asset),
        index: Number(r.index),
        c_factor: Number(r.c_factor) / 1e7,
        l_factor: Number(r.l_factor) / 1e7,
        price: pd ? BigInt(pd.price) : 0n,
        priceTimestamp: pd ? Number(pd.timestamp) : 0,
        supplyApr: 0,
        borrowApr: Number(r.borrow_rate_bps) / 10_000,
      });
    }
  }
  const byAsset: Record<string, ReserveInfo> = {};
  const byIndex: Record<number, ReserveInfo> = {};
  for (const r of reserves) {
    byAsset[r.asset] = r;
    byIndex[r.index] = r;
  }
  return { poolId, mode: cfg.blend.mode, reserves, byAsset, byIndex, loadedAt: Date.now() };
}

/** Vault'un pozisyonlarını varlık miktarı cinsinden (7 ondalık) döner; anahtar SAC adresi. */
export async function loadVaultPositions(
  cfg: HazeConfig,
  soroban: SorobanClient,
  reader: string,
  state: PoolState,
  vaultId: string,
): Promise<PositionAmounts> {
  const out: PositionAmounts = { collateral: {}, liabilities: {} };
  if (state.mode === "blend") {
    const network: Network = { rpc: cfg.rpcUrl, passphrase: cfg.networkPassphrase };
    const pool = await PoolV2.load(network, state.poolId);
    const user = await pool.loadUser(vaultId);
    for (const [assetId, r] of pool.reserves) {
      const c = user.getCollateral(r);
      const l = user.getLiabilities(r);
      if (c > 0n) out.collateral[assetId] = c;
      if (l > 0n) out.liabilities[assetId] = l;
    }
  } else {
    const raw = await soroban.read<RawPositions>(reader, state.poolId, "get_positions", [sc.address(vaultId)]);
    for (const [idx, amt] of Object.entries(positionsToRecord(raw.collateral))) {
      const r = state.byIndex[Number(idx)];
      if (r && amt > 0n) out.collateral[r.asset] = amt;
    }
    for (const [idx, amt] of Object.entries(positionsToRecord(raw.liabilities))) {
      const r = state.byIndex[Number(idx)];
      if (r && amt > 0n) out.liabilities[r.asset] = amt;
    }
  }
  return out;
}

/** Reserve params haritası (credit.ts girdisi) */
export function reserveParams(state: PoolState): Record<string, ReserveParams> {
  const out: Record<string, ReserveParams> = {};
  for (const r of state.reserves) out[r.asset] = { asset: r.asset, c_factor: r.c_factor, l_factor: r.l_factor, price: r.price };
  return out;
}

/** hUSDY getirisi: oracle fiyat eğiminden yıllıklandırılmış APY. Fiyat botu hızlandırılmış modda
 *  gerçek zamanı `accelerationFactor` ile çarptığı için burada geri bölünür. */
export function husdyApyFromPrices(
  p0: bigint,
  t0: number,
  p1: bigint,
  t1: number,
  accelerationFactor = 1,
): number {
  if (t1 <= t0 || p0 <= 0n) return 0;
  const growth = Number(p1 - p0) / Number(p0);
  const years = ((t1 - t0) * accelerationFactor) / 31_536_000;
  return growth / years;
}
