/**
 * testnet.contracts.json şeması ve yükleyici. Tüm servisler zincir adreslerini buradan okur.
 */
export type AssetCode = "USDC" | "hUSDY" | "hXAU" | "hNVDA" | "hSHEL" | "hBMW" | "hTRY" | "hEUR" | "hGBP" | "hCHF" | "hARS" | "hBRL";
/** Fiat para birimlerine sabitlenmiş token'lar: havuzda yalnız borç alınabilir rezerv (teminat faktörü 0). */
export type FiatCode = "hTRY" | "hEUR" | "hGBP" | "hCHF" | "hARS" | "hBRL";
/** Havuzda teminat olabilen varlıklar. */
export type CollateralCode = Exclude<AssetCode, FiatCode>;
/** Havuz rezervi olan tüm varlıklar (teminat + fiat). */
export type ReserveCode = AssetCode;
/** USDC dışındaki tokenize gerçek dünya varlıkları (RWA): dağılım ve nakde çevirme kaynakları. */
export type RwaCode = Exclude<CollateralCode, "USDC">;

export type AssetKind = "stable" | "treasury" | "gold" | "stock" | "fiat";

export interface AssetMeta {
  code: AssetCode;
  /** Ürün adı (arayüz) */
  name: string;
  kind: AssetKind;
  /** Mainnet karşılığı (bilgi) */
  mainnetRef: string;
  /** Başlangıç USD fiyatı (fiyat botu tabanı; env ile ezilebilir: <CODE>_USD, ör. NVDA_USD) */
  baseUsd: number;
  /** Arayüzde gösterilecek ondalık */
  displayDecimals: number;
  /** Testnet ihracında treasury'ye basılan miktar */
  mint: string;
  /** demo-user: kullanıcıya verilen teminat miktarı */
  demoAmount: string;
  /** market maker: satış tarafı emir boyutu (varlık cinsinden) */
  mmSize: string;
  /** Havuz rezerv parametreleri (7 ondalık oranlar) */
  reserve?: { c_factor: number; l_factor: number; util: number; max_util: number };
}

export const ASSET_META: Record<AssetCode, AssetMeta> = {
  USDC: { code: "USDC", name: "USD Coin", kind: "stable", mainnetRef: "Circle USDC", baseUsd: 1, displayDecimals: 2, mint: "0", demoAmount: "500", mmSize: "0", reserve: { c_factor: 0.95, l_factor: 0.95, util: 0.8, max_util: 0.95 } },
  hUSDY: { code: "hUSDY", name: "Hazine bonosu", kind: "treasury", mainnetRef: "Ondo USDY", baseUsd: 1, displayDecimals: 2, mint: "1000000", demoAmount: "300", mmSize: "5000", reserve: { c_factor: 0.9, l_factor: 0.1, util: 0.5, max_util: 0.6 } },
  hXAU: { code: "hXAU", name: "Altın", kind: "gold", mainnetRef: "Matrixdock XAUm", baseUsd: 2400, displayDecimals: 4, mint: "1000", demoAmount: "0.1", mmSize: "2", reserve: { c_factor: 0.75, l_factor: 0.1, util: 0.5, max_util: 0.6 } },
  hNVDA: { code: "hNVDA", name: "NVIDIA", kind: "stock", mainnetRef: "tokenize NVDA (ör. xStocks NVDAx)", baseUsd: 180, displayDecimals: 4, mint: "100000", demoAmount: "1", mmSize: "30", reserve: { c_factor: 0.65, l_factor: 0.1, util: 0.5, max_util: 0.6 } },
  hSHEL: { code: "hSHEL", name: "Shell", kind: "stock", mainnetRef: "tokenize SHEL", baseUsd: 70, displayDecimals: 4, mint: "100000", demoAmount: "3", mmSize: "80", reserve: { c_factor: 0.7, l_factor: 0.1, util: 0.5, max_util: 0.6 } },
  hBMW: { code: "hBMW", name: "BMW", kind: "stock", mainnetRef: "tokenize BMW", baseUsd: 90, displayDecimals: 4, mint: "100000", demoAmount: "2", mmSize: "60", reserve: { c_factor: 0.7, l_factor: 0.1, util: 0.5, max_util: 0.6 } },
  // Fiat rezervler: teminat değil (c_factor 0), borç alınabilir (l_factor 0,85). baseUsd = 1 birim fiat kaç USD; hTRY için SEP-38 kuru kullanılır.
  hTRY: { code: "hTRY", name: "Türk lirası", kind: "fiat", mainnetRef: "TRY stablecoin", baseUsd: 1 / 41, displayDecimals: 2, mint: "50000000", demoAmount: "0", mmSize: "100000", reserve: { c_factor: 0, l_factor: 0.85, util: 0.5, max_util: 0.6 } },
  hEUR: { code: "hEUR", name: "Euro", kind: "fiat", mainnetRef: "Circle EURC", baseUsd: 1.08, displayDecimals: 2, mint: "10000000", demoAmount: "0", mmSize: "5000", reserve: { c_factor: 0, l_factor: 0.85, util: 0.5, max_util: 0.6 } },
  hGBP: { code: "hGBP", name: "İngiliz sterlini", kind: "fiat", mainnetRef: "GBP stablecoin", baseUsd: 1.27, displayDecimals: 2, mint: "10000000", demoAmount: "0", mmSize: "5000", reserve: { c_factor: 0, l_factor: 0.85, util: 0.5, max_util: 0.6 } },
  hCHF: { code: "hCHF", name: "İsviçre frangı", kind: "fiat", mainnetRef: "CHF stablecoin", baseUsd: 1.12, displayDecimals: 2, mint: "10000000", demoAmount: "0", mmSize: "5000", reserve: { c_factor: 0, l_factor: 0.85, util: 0.5, max_util: 0.6 } },
  hARS: { code: "hARS", name: "Arjantin pesosu", kind: "fiat", mainnetRef: "ARS stablecoin", baseUsd: 0.001, displayDecimals: 0, mint: "10000000000", demoAmount: "0", mmSize: "5000000", reserve: { c_factor: 0, l_factor: 0.85, util: 0.5, max_util: 0.6 } },
  hBRL: { code: "hBRL", name: "Brezilya reali", kind: "fiat", mainnetRef: "BRL stablecoin", baseUsd: 0.18, displayDecimals: 2, mint: "50000000", demoAmount: "0", mmSize: "30000", reserve: { c_factor: 0, l_factor: 0.85, util: 0.5, max_util: 0.6 } },
};

/** Teminat olabilen rezervler (sıra korunur). */
export const COLLATERAL_CODES: CollateralCode[] = ["USDC", "hUSDY", "hXAU", "hNVDA", "hSHEL", "hBMW"];
export const RWA_CODES: RwaCode[] = ["hUSDY", "hXAU", "hNVDA", "hSHEL", "hBMW"];
/** Fiat rezervler (yalnız borç). */
export const FIAT_CODES: FiatCode[] = ["hTRY", "hEUR", "hGBP", "hCHF", "hARS", "hBRL"];
/** Havuz rezerv sırası — oracle fiyat listesi, Blend reserve index ve HazeCredit add_reserve sırası buna uyar. */
export const RESERVE_CODES: ReserveCode[] = [...COLLATERAL_CODES, ...FIAT_CODES];
/** Borç alınabilen rezervler: USDC (kart ve nakit) + fiat token'lar. */
export const BORROWABLE_CODES: ("USDC" | FiatCode)[] = ["USDC", ...FIAT_CODES];
/** Treasury'nin ihraç ettiği varlıklar (USDC Circle'dan gelir) */
export const ISSUED_CODES: Exclude<AssetCode, "USDC">[] = ["hUSDY", "hXAU", "hNVDA", "hSHEL", "hBMW", ...FIAT_CODES];
export const ALL_CODES: AssetCode[] = ["USDC", ...ISSUED_CODES];

/** ISO para birimi → fiat token (kartla harcanan para biriminde borçlanma). */
export const FIAT_BY_CURRENCY: Record<string, FiatCode> = { TRY: "hTRY", EUR: "hEUR", GBP: "hGBP", CHF: "hCHF", ARS: "hARS", BRL: "hBRL" };
/** Fiat token → ISO para birimi */
export function currencyOf(code: string): string {
  return Object.entries(FIAT_BY_CURRENCY).find(([, c]) => c === code)?.[0] ?? (code === "USDC" ? "USD" : code);
}
/** Fiyatı zamanla artan (getiri = fiyat eğimi) varlıklar; diğer RWA'lar taban fiyat + rastgele yürüyüş. */
export function isYieldByPrice(code: string): boolean {
  return ASSET_META[code as AssetCode]?.kind === "treasury";
}
/** Başlangıç USD fiyatı: env override (<CODE sans h>_USD) → meta. */
export function baseUsdOf(code: AssetCode, env: Record<string, string | undefined> = {}): number {
  const key = `${code.replace(/^h/, "")}_USD`;
  const v = env[key];
  return v && Number(v) > 0 ? Number(v) : ASSET_META[code].baseUsd;
}
/** Kısa açıklama (arayüz satırı) */
export function assetBlurb(code: string): string {
  const m = ASSET_META[code as AssetCode];
  if (!m) return "";
  switch (m.kind) {
    case "stable": return "Blend supply faizi";
    case "treasury": return "Tokenize hazine bonosu · fiyat artar";
    case "gold": return "Tokenize altın · değer koruma";
    case "stock": return `Tokenize hisse · ${m.name}`;
    case "fiat": return `Fiat token · yalnız borç`;
    default: return m.name;
  }
}

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

/** Demo havuz rezerv parametreleri (ASSET_META'dan; 7 ondalık oranlar). */
export const DEMO_RESERVES: Record<ReserveCode, { c_factor: number; l_factor: number; util: number; max_util: number }> = Object.fromEntries(
  RESERVE_CODES.map((c) => [c, ASSET_META[c].reserve!]),
) as Record<ReserveCode, { c_factor: number; l_factor: number; util: number; max_util: number }>;

export const TARGET_HEALTH_FACTOR = 1.25;
export const WARN_HEALTH_FACTOR = 1.1;
