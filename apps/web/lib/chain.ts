/**
 * Tarayıcı zincir işlemleri. Her işlemin kaynağı kullanıcının G-hesabı; kullanıcı imzalar,
 * haze-api sponsor olarak fee-bump uygular. İki işlemli akışlarda ikinci işlem, birincisi
 * ledger'a girdikten sonra kurulur.
 */
import { Asset, Keypair, Networks, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import {
  AnchorClient,
  FactoryClient,
  SorobanClient,
  VaultClient,
  buildApprove,
  buildMemoPayment,
  buildPathPaymentStrictReceive,
  estimateSendAmount,
  loadBalances,
  toStroops,
  type HazeConfig,
} from "@haze/stellar/browser";
import { api, type ApiConfig } from "./api.ts";

export type AssetCode = "USDC" | "hUSDY" | "hXAU" | "hTRY";

export function toHazeConfig(c: ApiConfig): HazeConfig {
  return {
    network: "testnet",
    networkPassphrase: c.networkPassphrase,
    rpcUrl: c.rpcUrl,
    horizonUrl: c.horizonUrl,
    anchorHomeDomain: c.anchorHomeDomain,
    anchorTreasury: "",
    anchorUsdcIssuer: c.assets.USDC.issuer,
    accounts: { sponsor: c.sponsor, operator: c.operator, issuer: "", distributor: "", treasury: "", settlement: c.settlement, oracleAdmin: "" },
    assets: c.assets,
    blend: { mode: c.poolMode, poolFactory: "", backstop: "", emitter: "", blndToken: "", lpToken: "", pool: c.poolMode === "blend" ? c.pool : "", oracle: "" },
    haze: { vaultWasmHash: "", vaultFactory: c.vaultFactory, hazeCredit: c.poolMode === "hazecredit" ? c.pool : "", mockOracle: "" },
  };
}

export class Chain {
  readonly soroban: SorobanClient;
  readonly cfg: HazeConfig;
  constructor(
    readonly api_: ApiConfig,
    readonly kp: Keypair,
  ) {
    this.cfg = toHazeConfig(api_);
    this.soroban = new SorobanClient(this.cfg.rpcUrl, this.cfg.networkPassphrase);
  }
  get pub() {
    return this.kp.publicKey();
  }
  asset(code: AssetCode) {
    return new Asset(this.cfg.assets[code].code, this.cfg.assets[code].issuer);
  }
  sac(code: AssetCode) {
    return this.cfg.assets[code].sac;
  }

  /** Kullanıcı imzalar, sponsor gönderir. Hash döner. */
  async signAndSponsor(tx: Transaction): Promise<string> {
    tx.sign(this.kp);
    const r = await api.sponsor(tx.toXDR());
    return r.hash;
  }

  // ---- onboarding ----
  static async onboard(cfgApi: ApiConfig, kp: Keypair, onStep?: (s: string) => void): Promise<{ vault: string }> {
    const chain = new Chain(cfgApi, kp);
    onStep?.("Sponsorlu hesap açılıyor");
    const { xdr } = await api.onboard(kp.publicKey());
    const tx = TransactionBuilder.fromXDR(xdr, cfgApi.networkPassphrase) as Transaction;
    tx.sign(kp);
    await api.onboardSubmit(tx.toXDR());
    onStep?.("Kasa (vault) kuruluyor");
    const factory = new FactoryClient(chain.soroban, cfgApi.vaultFactory);
    const { tx: ctx } = await factory.createVault(kp.publicKey());
    await chain.signAndSponsor(ctx);
    const reg = await api.registerVault(kp.publicKey());
    onStep?.("Anchor kimliği (SEP-10)");
    await chain.anchorLogin();
    onStep?.("Kart oluşturuluyor");
    await api.cardCreate(kp.publicKey());
    return { vault: reg.vaultAddress };
  }

  async anchorLogin(): Promise<string> {
    const anchor = new AnchorClient(this.cfg.anchorHomeDomain, this.cfg.networkPassphrase);
    await anchor.discover();
    const jwt = await anchor.authenticate(this.pub, (x) => {
      const t = TransactionBuilder.fromXDR(x, Networks.TESTNET) as Transaction;
      t.sign(this.kp);
      return t.toXDR();
    });
    await api.anchorToken(this.pub, jwt);
    return jwt;
  }

  // ---- vault (sahip) ----
  vault(v: string) {
    return new VaultClient(this.soroban, v);
  }
  async deposit(vault: string, code: AssetCode, amount: bigint) {
    const { tx } = await this.vault(vault).deposit(this.pub, this.sac(code), amount);
    return this.signAndSponsor(tx);
  }
  async withdraw(vault: string, code: AssetCode, amount: bigint) {
    const { tx } = await this.vault(vault).withdraw(this.pub, this.sac(code), amount);
    return this.signAndSponsor(tx);
  }
  async borrow(vault: string, amount: bigint) {
    const { tx } = await this.vault(vault).borrow(this.pub, amount);
    return this.signAndSponsor(tx);
  }
  async repay(vault: string, amount: bigint) {
    const { tx } = await this.vault(vault).repay(this.pub, amount);
    return this.signAndSponsor(tx);
  }
  async setFrozen(vault: string, frozen: boolean) {
    const { tx } = await this.vault(vault).setFrozen(this.pub, frozen);
    return this.signAndSponsor(tx);
  }
  async setDailyLimit(vault: string, limit: bigint) {
    const { tx } = await this.vault(vault).setDailyLimit(this.pub, limit);
    return this.signAndSponsor(tx);
  }
  async approveSalary(vault: string, amount: bigint, days = 30) {
    const ledger = (await this.soroban.server.getLatestLedger()).sequence;
    const expiry = ledger + 17280 * days;
    const { tx } = await buildApprove(this.soroban, this.pub, this.sac("USDC"), vault, amount, expiry);
    const hash = await this.signAndSponsor(tx);
    await api.allowance(this.pub, amount.toString(), expiry);
    return { hash, expiry };
  }

  // ---- klasik ----
  balances() {
    return loadBalances(this.cfg, this.pub);
  }

  /** USDC → hedef varlık (strict receive): hedef miktar alınır, sendMax %1 pay */
  async swapUsdcTo(code: "hUSDY" | "hXAU", destAmount: bigint): Promise<string> {
    const est = await estimateSendAmount(this.cfg, this.asset("USDC"), this.asset(code), destAmount);
    if (!est) throw new Error(`USDC → ${code} yolu bulunamadı`);
    const tx = await buildPathPaymentStrictReceive(this.cfg, this.pub, {
      sendAsset: this.asset("USDC"),
      sendMax: (est.sendAmount * 101n) / 100n,
      destination: this.pub,
      destAsset: this.asset(code),
      destAmount,
      path: est.path,
    });
    return this.signAndSponsor(tx);
  }

  /** Nakde çevirme adım 3a: hXAU/hUSDY gönder, anchor hazinesi tam USDC alsın (memo'lu) */
  async pathPayToAnchor(code: "hXAU" | "hUSDY", usdcAmount: bigint, treasury: string, memoId: string): Promise<string> {
    const est = await estimateSendAmount(this.cfg, this.asset(code), this.asset("USDC"), usdcAmount);
    if (!est) throw new Error(`${code} → USDC yolu bulunamadı`);
    const tx = await buildPathPaymentStrictReceive(this.cfg, this.pub, {
      sendAsset: this.asset(code),
      sendMax: (est.sendAmount * 101n) / 100n,
      destination: treasury,
      destAsset: this.asset("USDC"),
      destAmount: usdcAmount,
      path: est.path,
      memoId,
    });
    return this.signAndSponsor(tx);
  }

  /** Nakde çevirme adım 3b: USDC'yi memo ile anchor hazinesine öde */
  async payAnchor(usdcAmount: bigint, treasury: string, memoId: string): Promise<string> {
    const tx = await buildMemoPayment(this.cfg, this.pub, { destination: treasury, asset: this.asset("USDC"), amount: usdcAmount, memoId });
    return this.signAndSponsor(tx);
  }

  /** hedef miktar için gereken kaynak miktarı (gösterim) */
  async quoteSend(from: AssetCode, to: AssetCode, destAmount: bigint) {
    return estimateSendAmount(this.cfg, this.asset(from), this.asset(to), destAmount);
  }
}

export { toStroops };
