/**
 * testnet.contracts.json şeması ve yükleyici. Tüm servisler zincir adreslerini buradan okur.
 */
export type AssetCode = "USDC" | "hUSDY" | "hXAU" | "hTRY";

export interface AssetEntry {
  code: string;
  issuer: string;
  /** Stellar Asset Contract (SAC) adresi */
  sac: string;
}

export interface HazeConfig {
  network: "testnet";
  networkPassphrase: string;
  rpcUrl: string;
  horizonUrl: string;
  anchorHomeDomain: string;
  /** Mock anchor USDC hazinesi (withdraw ödemeleri buraya, memo ile) */
  anchorTreasury: string;
  anchorUsdcIssuer: string;
  accounts: {
    sponsor: string;
    operator: string;
    issuer: string;
    distributor: string;
    treasury: string;
    settlement: string;
    oracleAdmin: string;
  };
  assets: Record<AssetCode, AssetEntry>;
  blend: {
    /** "blend": kendi Blend v2 dağıtımımız · "hazecredit": yedek havuz */
    mode: "blend" | "hazecredit";
    poolFactory: string;
    backstop: string;
    emitter: string;
    blndToken: string;
    lpToken: string;
    pool: string;
    oracle: string;
  };
  haze: {
    vaultWasmHash: string;
    vaultFactory: string;
    hazeCredit: string;
    mockOracle: string;
  };
}

/** Aktif havuz adresi: mode'a göre Blend havuzu ya da HazeCredit. */
export function activePool(cfg: HazeConfig): string {
  return cfg.blend.mode === "hazecredit" ? cfg.haze.hazeCredit : cfg.blend.pool;
}

/** Aktif oracle: Blend modunda blend.oracle, yedek modda mockOracle. */
export function activeOracle(cfg: HazeConfig): string {
  return cfg.blend.mode === "hazecredit" ? cfg.haze.mockOracle : cfg.blend.oracle;
}

/** Demo parametreleri (belgedeki havuz yapılandırması). 7 ondalık. */
export const DEMO_RESERVES: Record<
  Exclude<AssetCode, "hTRY">,
  { c_factor: number; l_factor: number; util: number; max_util: number }
> = {
  USDC: { c_factor: 0.95, l_factor: 0.95, util: 0.8, max_util: 0.95 },
  hUSDY: { c_factor: 0.9, l_factor: 0.1, util: 0.5, max_util: 0.6 },
  hXAU: { c_factor: 0.75, l_factor: 0.1, util: 0.5, max_util: 0.6 },
};

export const TARGET_HEALTH_FACTOR = 1.25;
export const WARN_HEALTH_FACTOR = 1.1;
