/** haze-api istemcisi */
export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `${path} ${r.status}`);
  return j;
}
const post = <T>(path: string, body: unknown) => req<T>(path, { method: "POST", body: JSON.stringify(body) });

export interface ApiConfig {
  networkPassphrase: string;
  rpcUrl: string;
  horizonUrl: string;
  anchorHomeDomain: string;
  assets: Record<"USDC" | "hUSDY" | "hXAU" | "hTRY", { code: string; issuer: string; sac: string }>;
  pool: string;
  poolMode: "blend" | "hazecredit";
  vaultFactory: string;
  sponsor: string;
  operator: string;
  settlement: string;
  demo: { husdyApy: number; daysPerMinute: number };
}

export interface CreditView {
  vault: string;
  poolMode: string;
  reserves: {
    code: string;
    asset: string;
    priceFloat: number;
    c_factor: number;
    l_factor: number;
    supplyApr: number;
    borrowApr: number;
    collateralFloat: number;
    liabilitiesFloat: number;
    collateral: string;
    liabilities: string;
  }[];
  card: { frozen: boolean; dailyLimitFloat: number; spentTodayFloat: number };
  openHolds: string;
  credit: {
    availableLimitFloat: number;
    effectiveCollateralFloat: number;
    effectiveLiabilitiesFloat: number;
    collateralValueFloat: number;
    debtValueFloat: number;
    healthFactor: number | null;
    targetHealth: number;
  };
  fetchedAt: number;
}

export interface Hold {
  auth_id: string;
  lithic_token: string | null;
  usd_cents: number;
  usdc_amount: string;
  merchant: string;
  merchant_try: string | null;
  status: string;
  borrow_tx: string | null;
  created_at: number;
}
export interface Notification {
  id: number;
  kind: string;
  title: string;
  body: string;
  data: string | null;
  created_at: number;
}
export interface Prices {
  USDC: number;
  hUSDY: number;
  hXAU: number;
  USDTRY: number | null;
  husdyApy: number;
  daysPerMinute: number;
  acceleratedDays: number;
}

export const api = {
  config: () => req<ApiConfig>("/config"),
  prices: () => req<Prices>("/prices"),
  onboard: (publicKey: string) => post<{ xdr: string }>("/onboard", { publicKey }),
  onboardSubmit: (xdr: string) => post<{ hash: string; vaultAddress: string | null }>("/onboard/submit", { xdr }),
  sponsor: (xdr: string) => post<{ hash: string }>("/tx/sponsor", { xdr }),
  registerVault: (publicKey: string) => post<{ vaultAddress: string }>("/vault/register", { publicKey }),
  user: (id: string) =>
    req<{ id: string; vaultAddress: string | null; card: { token: string; last4: string } | null; allowance: { amount: string; expiryLedger: number }; hasAnchorToken: boolean; rule: { allocation: string } }>(`/users/${id}`),
  credit: (id: string, fresh = false) => req<CreditView>(`/credit/${id}${fresh ? "?fresh=1" : ""}`),
  holds: (id: string) => req<Hold[]>(`/users/${id}/holds`),
  notifications: (id: string, since = 0) => req<Notification[]>(`/users/${id}/notifications?since=${since}`),
  anchorToken: (userId: string, jwt: string) => post<{ ok: true }>("/anchor/token", { userId, jwt }),
  allowance: (userId: string, amount: string, expiryLedger: number) => post<{ ok: true }>("/allowance", { userId, amount, expiryLedger }),
  rules: (userId: string, allocation: Record<string, number>) => post<{ ok: true }>("/rules", { userId, allocation }),
  cardCreate: (userId: string) => post<{ token: string; last4: string; pan?: string; expMonth?: string; expYear?: string; cvv?: string; demo?: boolean }>("/card/create", { userId }),
  salaryStart: (userId: string, amountTry: number) => post<{ parts: unknown[]; settle: unknown }>("/salary/start", { userId, amountTry }),
  salarySettle: (userId: string) => post<{ ok: boolean; reason?: string }>("/salary/settle", { userId }),
  cashoutStart: (userId: string, amountTry: number) =>
    post<{ id: string; usdcAmount: string; tryAmount: string; price: string; treasury: string; memo: string; memoType: string; expiresAt: string }>("/cashout/start", { userId, amountTry }),
  cashoutStatus: (userId: string, id: string) => req<{ status: string; amount_out?: string }>(`/cashout/${userId}/${id}`),
  terminalCharge: (userId: string, amountTry: number, merchant: string, city: string) => post<{ result?: string; token: string; usdCents: number; via: string; decline_reason?: string }>("/terminal/charge", { userId, amountTry, merchant, city }),
  terminalClear: (token: string) => post<{ ok: true }>("/terminal/clear", { token }),
  terminalVoid: (token: string) => post<{ ok: true }>("/terminal/void", { token }),
  anchorTxs: (id: string) => req<{ id: string; kind: string; amount_try: string | null; amount_usdc: string | null; status: string; stellar_tx: string | null; created_at: number }[]>(`/users/${id}/anchor-txs`),
};
