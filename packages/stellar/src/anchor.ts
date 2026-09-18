/**
 * TR Mock Anchor istemcisi — SEP-1, SEP-10, SEP-12 (otomatik), SEP-38, SEP-6.
 * Kaynak: hackathon SKILL.md (tr-mock-anchor.fly.dev). Yalnızca fetch kullanır.
 */
import { Keypair, Networks, StellarToml, TransactionBuilder } from "@stellar/stellar-sdk";

export interface AnchorEndpoints {
  homeDomain: string;
  webAuth: string;
  transferServer: string;
  kycServer: string;
  quoteServer: string;
  signingKey: string;
  usdcIssuer: string;
}

export interface Sep38Quote {
  id: string;
  expires_at: string;
  price: string;
  total_price?: string;
  sell_asset: string;
  buy_asset: string;
  sell_amount: string;
  buy_amount: string;
}

export interface Sep6Transaction {
  id: string;
  kind: "deposit" | "withdrawal" | "deposit-exchange" | "withdrawal-exchange";
  status: string;
  amount_in?: string;
  amount_out?: string;
  amount_fee?: string;
  stellar_transaction_id?: string;
  external_transaction_id?: string;
  more_info_url?: string;
  started_at?: string;
  completed_at?: string;
}

export const ANCHOR_LIMITS = {
  depositMinTry: 50,
  depositMaxTry: 3000,
  withdrawMinUsdc: 1,
};

export class AnchorClient {
  private token?: string;
  private tokenAccount?: string;
  endpoints?: AnchorEndpoints;

  constructor(
    readonly homeDomain: string,
    readonly networkPassphrase: string = Networks.TESTNET,
  ) {}

  /** SEP-1: stellar.toml keşfi */
  async discover(): Promise<AnchorEndpoints> {
    if (this.endpoints) return this.endpoints;
    const toml = await StellarToml.Resolver.resolve(this.homeDomain);
    const usdc = (toml.CURRENCIES ?? []).find((c) => c.code === "USDC");
    this.endpoints = {
      homeDomain: this.homeDomain,
      webAuth: toml.WEB_AUTH_ENDPOINT!,
      transferServer: toml.TRANSFER_SERVER!,
      kycServer: toml.KYC_SERVER!,
      quoteServer: toml.ANCHOR_QUOTE_SERVER!,
      signingKey: toml.SIGNING_KEY!,
      usdcIssuer: usdc?.issuer ?? "",
    };
    return this.endpoints;
  }

  get usdcAssetId(): string {
    return `stellar:USDC:${this.endpoints?.usdcIssuer}`;
  }

  /** SEP-10: challenge al, imzala, JWT al. `signer` kullanıcı anahtarı (ya da challenge imzalayıcı fonksiyon). */
  async authenticate(account: string, sign: (xdr: string) => Promise<string> | string): Promise<string> {
    const ep = await this.discover();
    const ch = await fetch(`${ep.webAuth}?account=${account}`);
    if (!ch.ok) throw new Error(`SEP-10 challenge failed: ${ch.status}`);
    const { transaction } = (await ch.json()) as { transaction: string };
    const signed = await sign(transaction);
    const res = await fetch(ep.webAuth, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction: signed }),
    });
    if (!res.ok) throw new Error(`SEP-10 token failed: ${res.status} ${await res.text()}`);
    const { token } = (await res.json()) as { token: string };
    this.token = token;
    this.tokenAccount = account;
    return token;
  }

  /** Sunucu tarafı kısayol: anahtar elimizdeyse doğrudan imzala */
  authenticateWithKeypair(kp: Keypair): Promise<string> {
    return this.authenticate(kp.publicKey(), (x) => {
      const tx = TransactionBuilder.fromXDR(x, this.networkPassphrase);
      tx.sign(kp);
      return tx.toXDR();
    });
  }

  useToken(token: string, account: string) {
    this.token = token;
    this.tokenAccount = account;
  }

  private auth(): Record<string, string> {
    if (!this.token) throw new Error("SEP-10 token missing; call authenticate() first");
    return { Authorization: `Bearer ${this.token}` };
  }

  /** SEP-6 info */
  async info(): Promise<unknown> {
    const ep = await this.discover();
    return (await fetch(`${ep.transferServer}/info`)).json();
  }

  /** SEP-38 gösterge fiyatı (kilitsiz) */
  async prices(sellAsset: string, sellAmount: string, buyAsset?: string): Promise<{ buy_assets: { asset: string; price: string; decimals: number }[] }> {
    const ep = await this.discover();
    const q = new URLSearchParams({ sell_asset: sellAsset, sell_amount: sellAmount });
    if (buyAsset) q.set("buy_asset", buyAsset);
    const res = await fetch(`${ep.quoteServer}/prices?${q}`, { headers: this.auth() });
    if (!res.ok) throw new Error(`SEP-38 prices failed: ${res.status}`);
    return res.json() as Promise<{ buy_assets: { asset: string; price: string; decimals: number }[] }>;
  }

  /** SEP-38 kilitli teklif. sell_amount ya da buy_amount'tan biri verilir. */
  async quote(params: { sell_asset: string; buy_asset: string; sell_amount?: string; buy_amount?: string }): Promise<Sep38Quote> {
    const ep = await this.discover();
    const res = await fetch(`${ep.quoteServer}/quote`, {
      method: "POST",
      headers: { ...this.auth(), "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(`SEP-38 quote failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<Sep38Quote>;
  }

  /** SEP-6 deposit (TRY → USDC). Teklif varsa deposit-exchange kullanılır. */
  async deposit(params: { account: string; amountTry: string; quoteId?: string }): Promise<{ id: string; how?: string; more_info_url?: string }> {
    const ep = await this.discover();
    const q = new URLSearchParams({ asset_code: "USDC", account: params.account, amount: params.amountTry });
    let path = "/deposit";
    if (params.quoteId) {
      path = "/deposit-exchange";
      q.set("source_asset", "iso4217:TRY");
      q.set("destination_asset", "USDC");
      q.set("quote_id", params.quoteId);
    }
    const res = await fetch(`${ep.transferServer}${path}?${q}`, { headers: this.auth() });
    if (!res.ok) throw new Error(`SEP-6 deposit failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<{ id: string; how?: string; more_info_url?: string }>;
  }

  /** Yalnızca mock: banka transferini simüle et */
  async simulateBankTransfer(txId: string, amountTry: string): Promise<void> {
    const ep = await this.discover();
    const res = await fetch(`${ep.transferServer}/tx/${txId}/simulate-bank-transfer`, {
      method: "POST",
      headers: { ...this.auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amountTry }),
    });
    if (!res.ok) throw new Error(`simulate-bank-transfer failed: ${res.status} ${await res.text()}`);
  }

  /** SEP-6 withdraw (USDC → TRY). Döner: hazine adresi + memo. */
  async withdraw(params: { amountUsdc: string; quoteId?: string; dest?: string }): Promise<{ id: string; account_id: string; memo: string; memo_type: string }> {
    const ep = await this.discover();
    const q = new URLSearchParams({ asset_code: "USDC", type: "bank_account", amount: params.amountUsdc });
    if (params.dest) q.set("dest", params.dest);
    let path = "/withdraw";
    if (params.quoteId) {
      path = "/withdraw-exchange";
      q.set("source_asset", "USDC");
      q.set("destination_asset", "iso4217:TRY");
      q.set("quote_id", params.quoteId);
    }
    const res = await fetch(`${ep.transferServer}${path}?${q}`, { headers: this.auth() });
    if (!res.ok) throw new Error(`SEP-6 withdraw failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<{ id: string; account_id: string; memo: string; memo_type: string }>;
  }

  async transaction(id: string): Promise<Sep6Transaction> {
    const ep = await this.discover();
    const res = await fetch(`${ep.transferServer}/transaction?id=${id}`, { headers: this.auth() });
    if (!res.ok) throw new Error(`SEP-6 transaction failed: ${res.status}`);
    const j = (await res.json()) as { transaction: Sep6Transaction };
    return j.transaction;
  }

  async transactions(): Promise<Sep6Transaction[]> {
    const ep = await this.discover();
    const res = await fetch(`${ep.transferServer}/transactions?asset_code=USDC`, { headers: this.auth() });
    if (!res.ok) throw new Error(`SEP-6 transactions failed: ${res.status}`);
    const j = (await res.json()) as { transactions: Sep6Transaction[] };
    return j.transactions;
  }

  /** Durum `completed` (ya da hata) olana kadar bekle */
  async waitForCompletion(id: string, opts: { intervalMs?: number; timeoutMs?: number; onStatus?: (s: string) => void } = {}): Promise<Sep6Transaction> {
    const start = Date.now();
    for (;;) {
      const tx = await this.transaction(id);
      opts.onStatus?.(tx.status);
      if (tx.status === "completed") return tx;
      if (tx.status === "error" || tx.status === "refunded") throw new Error(`anchor tx ${id} ${tx.status}`);
      if (Date.now() - start > (opts.timeoutMs ?? 120_000)) throw new Error(`anchor tx ${id} timeout in status ${tx.status}`);
      await new Promise((r) => setTimeout(r, opts.intervalMs ?? 2000));
    }
  }
}

/** Anchor limiti (3000 TRY / işlem) için parçalara böl. */
export function splitTry(amountTry: number, max = ANCHOR_LIMITS.depositMaxTry, min = ANCHOR_LIMITS.depositMinTry): number[] {
  if (amountTry < min) throw new Error(`amount below minimum ${min} TRY`);
  const parts: number[] = [];
  let rest = Math.round(amountTry * 100) / 100;
  while (rest > max) {
    // son parça minimumun altında kalmasın
    const chunk = rest - max < min ? Math.round((rest - min) * 100) / 100 : max;
    parts.push(chunk);
    rest = Math.round((rest - chunk) * 100) / 100;
  }
  parts.push(rest);
  return parts;
}
