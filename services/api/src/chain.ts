/**
 * Zincir erişimi tek arayüzün arkasında: modüller `ChainOps` kullanır, testler sahte uygulama verir.
 */
import { Keypair, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { FactoryClient, SorobanClient, VaultClient, activeOracle, feeBump, loadPoolState, loadVaultPositions, readAllowance, readBalance, sc, type CardState, type HazeConfig, type PoolState, type PositionAmounts, type DecodedEvent, RESERVE_CODES } from "@haze/stellar";
import { xdr } from "@stellar/stellar-sdk";
import type { Env } from "./env.ts";

export interface TxRef {
  hash: string;
  ledger?: number;
}

export interface ChainOps {
  poolState(): Promise<PoolState>;
  vaultPositions(vault: string): Promise<PositionAmounts>;
  cardState(vault: string): Promise<CardState>;
  vaultAddressFor(owner: string): Promise<string>;
  vaultExists(owner: string): Promise<string | null>;
  usdcAllowance(owner: string, vault: string): Promise<bigint>;
  usdcBalance(holder: string): Promise<bigint>;
  latestLedger(): Promise<number>;

  borrowForCard(vault: string, amount: bigint, authId: Uint8Array): Promise<TxRef>;
  refundForCard(vault: string, amount: bigint, authId: Uint8Array): Promise<TxRef>;
  settleSalary(vault: string, amount: bigint, repayAmount: bigint): Promise<TxRef>;
  /** takas hazinesi → vault USDC iadesi (void) */
  settlementRefund(vault: string, amount: bigint): Promise<TxRef>;
  /** işlem para biriminde kart borcu (ör. hTRY): asset SAC, amount varlık cinsinden, usdAmount limit sayacı */
  borrowForCardAsset(vault: string, asset: string, amount: bigint, usdAmount: bigint, authId: Uint8Array): Promise<TxRef>;
  refundForCardAsset(vault: string, amount: bigint, authId: Uint8Array): Promise<TxRef>;
  /** takas hazinesi → vault: fiat token iadesi (void) */
  settlementRefundAsset(vault: string, asset: string, amount: bigint): Promise<TxRef>;
  /** kur masası: hazine fiat token'ı vault'a gönderir */
  treasuryTransfer(asset: string, to: string, amount: bigint): Promise<TxRef>;
  /** kur masası: fiat borcu vault'taki tokenla kapat, karşılığı USDC teminattan takas hazinesine */
  settleFx(vault: string, asset: string, fiatAmount: bigint, usdcAmount: bigint): Promise<TxRef>;
  /** oracle'a toplu fiyat yaz */
  setOraclePrices(assets: string[], prices: bigint[]): Promise<TxRef>;
  /** imzalı iç işlemi sponsor fee-bump ile gönder */
  sponsorAndSend(inner: Transaction): Promise<TxRef>;
  /** sponsor kaynaklı, sponsor imzalı işlemi gönder (onboarding) */
  send(tx: Transaction): Promise<TxRef>;
  events(contractIds: string[], startLedger: number, cursor?: string): Promise<{ events: DecodedEvent[]; latestLedger: number; cursor?: string }>;
}

export class LiveChain implements ChainOps {
  readonly soroban: SorobanClient;
  readonly cfg: HazeConfig;
  private poolCache?: { state: PoolState; at: number };
  constructor(
    readonly env: Env,
    private readonly poolCacheMs = 10_000,
  ) {
    this.cfg = env.cfg;
    this.soroban = new SorobanClient(env.cfg.rpcUrl, env.cfg.networkPassphrase);
  }
  private get reader() {
    return this.env.operator.publicKey();
  }
  private vault(v: string) {
    return new VaultClient(this.soroban, v);
  }
  private get factory() {
    return new FactoryClient(this.soroban, this.cfg.haze.vaultFactory);
  }

  async poolState(): Promise<PoolState> {
    if (this.poolCache && Date.now() - this.poolCache.at < this.poolCacheMs) return this.poolCache.state;
    const state = await loadPoolState(this.cfg, this.soroban, this.reader);
    this.poolCache = { state, at: Date.now() };
    return state;
  }
  invalidatePool() {
    this.poolCache = undefined;
  }
  async vaultPositions(vault: string) {
    return loadVaultPositions(this.cfg, this.soroban, this.reader, await this.poolState(), vault);
  }
  cardState(vault: string) {
    return this.vault(vault).cardState(this.reader);
  }
  vaultAddressFor(owner: string) {
    return this.factory.vaultAddress(this.reader, owner);
  }
  async vaultExists(owner: string) {
    const v = await this.factory.getVault(this.reader, owner);
    return v ?? null;
  }
  usdcAllowance(owner: string, vault: string) {
    return readAllowance(this.soroban, this.reader, this.cfg.assets.USDC.sac, owner, vault);
  }
  usdcBalance(holder: string) {
    return readBalance(this.soroban, this.reader, this.cfg.assets.USDC.sac, holder);
  }
  async latestLedger() {
    return (await this.soroban.server.getLatestLedger()).sequence;
  }

  private async opSend(build: Promise<{ tx: Transaction }>, signer: Keypair): Promise<TxRef> {
    const { tx } = await build;
    tx.sign(signer);
    const fb = feeBump(this.cfg, this.env.sponsor, tx);
    const r = await this.soroban.sendAndWait(fb);
    return { hash: r.hash, ledger: r.ledger };
  }
  borrowForCard(vault: string, amount: bigint, authId: Uint8Array) {
    return this.opSend(this.vault(vault).borrowForCard(this.env.operator.publicKey(), amount, authId), this.env.operator);
  }
  refundForCard(vault: string, amount: bigint, authId: Uint8Array) {
    return this.opSend(this.vault(vault).refundForCard(this.env.operator.publicKey(), amount, authId), this.env.operator);
  }
  settleSalary(vault: string, amount: bigint, repayAmount: bigint) {
    return this.opSend(this.vault(vault).settleSalary(this.env.operator.publicKey(), amount, repayAmount), this.env.operator);
  }
  settlementRefund(vault: string, amount: bigint) {
    return this.settlementRefundAsset(vault, this.cfg.assets.USDC.sac, amount);
  }
  settlementRefundAsset(vault: string, asset: string, amount: bigint) {
    const from = this.env.settlement.publicKey();
    return this.opSend(this.soroban.buildInvoke(from, asset, "transfer", [sc.address(from), sc.address(vault), sc.i128(amount)]), this.env.settlement);
  }
  borrowForCardAsset(vault: string, asset: string, amount: bigint, usdAmount: bigint, authId: Uint8Array) {
    return this.opSend(this.vault(vault).borrowForCardAsset(this.env.operator.publicKey(), asset, amount, usdAmount, authId), this.env.operator);
  }
  refundForCardAsset(vault: string, amount: bigint, authId: Uint8Array) {
    return this.opSend(this.vault(vault).refundForCardAsset(this.env.operator.publicKey(), amount, authId), this.env.operator);
  }
  treasuryTransfer(asset: string, to: string, amount: bigint) {
    const from = this.env.treasury.publicKey();
    return this.opSend(this.soroban.buildInvoke(from, asset, "transfer", [sc.address(from), sc.address(to), sc.i128(amount)]), this.env.treasury);
  }
  settleFx(vault: string, asset: string, fiatAmount: bigint, usdcAmount: bigint) {
    return this.opSend(this.vault(vault).settleFx(this.env.operator.publicKey(), asset, fiatAmount, usdcAmount), this.env.operator);
  }
  setOraclePrices(assets: string[], prices: bigint[]) {
    if (this.cfg.blend.mode === "blend") {
      // blend-utils oraclemock: set_price_stable(prices) — sıra set_data'daki varlık sırası = RESERVE_CODES
      const admin = this.env.blendAdmin ?? this.env.oracleAdmin;
      const order = RESERVE_CODES.map((c) => this.cfg.assets[c].sac);
      const ordered = order.map((a) => prices[assets.indexOf(a)] ?? 0n);
      return this.opSend(
        this.soroban.buildInvoke(admin.publicKey(), this.cfg.blend.oracle, "set_price_stable", [sc.vec(ordered.map((p) => sc.i128(p)))]),
        admin,
      );
    }
    const admin = this.env.oracleAdmin.publicKey();
    const assetVals = assets.map((a) => xdr.ScVal.scvVec([sc.symbol("Stellar"), sc.address(a)]));
    return this.opSend(
      this.soroban.buildInvoke(admin, activeOracle(this.cfg), "set_prices", [sc.vec(assetVals), sc.vec(prices.map((p) => sc.i128(p)))]),
      this.env.oracleAdmin,
    );
  }
  async sponsorAndSend(inner: Transaction) {
    const fb = feeBump(this.cfg, this.env.sponsor, inner);
    const r = await this.soroban.sendAndWait(fb);
    return { hash: r.hash, ledger: r.ledger };
  }
  async send(tx: Transaction) {
    const r = await this.soroban.sendAndWait(tx);
    return { hash: r.hash, ledger: r.ledger };
  }
  events(contractIds: string[], startLedger: number, cursor?: string) {
    return this.soroban.events(contractIds, startLedger, { cursor });
  }
}

export function parseInner(xdrB64: string, passphrase: string): Transaction {
  const tx = TransactionBuilder.fromXDR(xdrB64, passphrase);
  if (!("operations" in tx)) throw new Error("fee-bump transactions are not accepted here");
  return tx as Transaction;
}
