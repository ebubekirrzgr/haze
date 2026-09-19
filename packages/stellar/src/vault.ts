/**
 * HazeVault / VaultFactory çağrı kurucuları ve okuyucuları.
 * Sahip fonksiyonları tarayıcıda (passkey ile açılan G-hesabı imzalar), operatör fonksiyonları
 * haze-api'de (operatör anahtarı imzalar) kullanılır. Her ikisinde de işlem kaynağı imzalayan
 * hesaptır; sponsor sonradan fee-bump uygular.
 */
import type { Transaction } from "@stellar/stellar-sdk";
import { SorobanClient, positionsToRecord, sc, sha256, type RawPositions } from "./soroban.ts";

export interface VaultConfig {
  owner: string;
  operator: string;
  pool: string;
  usdc: string;
  settlement: string;
}

export interface CardState {
  day: bigint;
  spent_today: bigint;
  daily_limit: bigint;
  frozen: boolean;
}

export interface VaultPositions {
  /** rezerv indeksi → miktar */
  liabilities: Record<number, bigint>;
  collateral: Record<number, bigint>;
  supply: Record<number, bigint>;
}

/** Lithic yetkilendirme token'ı → 32 baytlık auth_id (idempotency anahtarı) */
export async function authIdFromToken(token: string): Promise<Uint8Array> {
  return sha256(`haze:auth:${token}`);
}

export class VaultClient {
  constructor(
    readonly soroban: SorobanClient,
    readonly vaultId: string,
  ) {}

  // ---- sahip ----
  deposit(owner: string, asset: string, amount: bigint) {
    return this.soroban.buildInvoke(owner, this.vaultId, "deposit", [sc.address(asset), sc.i128(amount)]);
  }
  withdraw(owner: string, asset: string, amount: bigint) {
    return this.soroban.buildInvoke(owner, this.vaultId, "withdraw", [sc.address(asset), sc.i128(amount)]);
  }
  borrow(owner: string, amount: bigint) {
    return this.soroban.buildInvoke(owner, this.vaultId, "borrow", [sc.i128(amount)]);
  }
  repay(owner: string, amount: bigint) {
    return this.soroban.buildInvoke(owner, this.vaultId, "repay", [sc.i128(amount)]);
  }
  /** Herhangi bir rezervi (fiat token) borç al → sahibe */
  borrowAsset(owner: string, asset: string, amount: bigint) {
    return this.soroban.buildInvoke(owner, this.vaultId, "borrow_asset", [sc.address(asset), sc.i128(amount)]);
  }
  /** Rezerv cinsinden borç öde; artan sahibe döner */
  repayAsset(owner: string, asset: string, amount: bigint) {
    return this.soroban.buildInvoke(owner, this.vaultId, "repay_asset", [sc.address(asset), sc.i128(amount)]);
  }
  setDailyLimit(owner: string, limit: bigint) {
    return this.soroban.buildInvoke(owner, this.vaultId, "set_daily_limit", [sc.i128(limit)]);
  }
  setFrozen(owner: string, frozen: boolean) {
    return this.soroban.buildInvoke(owner, this.vaultId, "set_frozen", [sc.bool(frozen)]);
  }

  // ---- operatör ----
  borrowForCard(operator: string, amount: bigint, authId: Uint8Array) {
    return this.soroban.buildInvoke(operator, this.vaultId, "borrow_for_card", [sc.i128(amount), sc.bytes(authId)]);
  }
  refundForCard(operator: string, amount: bigint, authId: Uint8Array) {
    return this.soroban.buildInvoke(operator, this.vaultId, "refund_for_card", [sc.i128(amount), sc.bytes(authId)]);
  }
  /** İşlem para biriminde kart borcu (ör. hTRY): amount varlık cinsinden, usdAmount günlük limit için USDC karşılığı */
  borrowForCardAsset(operator: string, asset: string, amount: bigint, usdAmount: bigint, authId: Uint8Array) {
    return this.soroban.buildInvoke(operator, this.vaultId, "borrow_for_card_asset", [sc.address(asset), sc.i128(amount), sc.i128(usdAmount), sc.bytes(authId)]);
  }
  refundForCardAsset(operator: string, amount: bigint, authId: Uint8Array) {
    return this.soroban.buildInvoke(operator, this.vaultId, "refund_for_card_asset", [sc.i128(amount), sc.bytes(authId)]);
  }
  /** Kur masası: vault'a gelmiş fiat ile borcu kapat, karşılığı USDC teminattan takas hazinesine */
  settleFx(operator: string, asset: string, fiatAmount: bigint, usdcAmount: bigint) {
    return this.soroban.buildInvoke(operator, this.vaultId, "settle_fx", [sc.address(asset), sc.i128(fiatAmount), sc.i128(usdcAmount)]);
  }
  settleSalary(operator: string, amount: bigint, repayAmount: bigint) {
    return this.soroban.buildInvoke(operator, this.vaultId, "settle_salary", [sc.i128(amount), sc.i128(repayAmount)]);
  }

  // ---- okuma ----
  async cardState(reader: string): Promise<CardState> {
    const r = await this.soroban.read<CardState>(reader, this.vaultId, "card_state");
    return { day: BigInt(r.day), spent_today: BigInt(r.spent_today), daily_limit: BigInt(r.daily_limit), frozen: !!r.frozen };
  }
  async config(reader: string): Promise<VaultConfig> {
    return this.soroban.read<VaultConfig>(reader, this.vaultId, "get_config");
  }
  async positions(reader: string): Promise<VaultPositions> {
    const r = await this.soroban.read<RawPositions>(reader, this.vaultId, "positions");
    return {
      liabilities: positionsToRecord(r.liabilities),
      collateral: positionsToRecord(r.collateral),
      supply: positionsToRecord(r.supply),
    };
  }
  async authAmount(reader: string, authId: Uint8Array): Promise<bigint | null> {
    const r = await this.soroban.read<bigint | null | undefined>(reader, this.vaultId, "auth_amount", [sc.bytes(authId)]);
    return r == null ? null : BigInt(r);
  }
}

export class FactoryClient {
  constructor(
    readonly soroban: SorobanClient,
    readonly factoryId: string,
  ) {}

  /** Sahip imzalar; sponsor fee-bump uygular. */
  createVault(owner: string, dailyLimit?: bigint) {
    return this.soroban.buildInvoke(owner, this.factoryId, "create_vault", [sc.address(owner), sc.optionI128(dailyLimit)]);
  }
  vaultAddress(reader: string, owner: string): Promise<string> {
    return this.soroban.read<string>(reader, this.factoryId, "vault_address", [sc.address(owner)]);
  }
  getVault(reader: string, owner: string): Promise<string | null | undefined> {
    return this.soroban.read<string | null | undefined>(reader, this.factoryId, "get_vault", [sc.address(owner)]);
  }
}

/** SAC approve: sahip, vault'a maaş için süreli USDC allowance verir. */
export function buildApprove(
  soroban: SorobanClient,
  owner: string,
  tokenSac: string,
  spender: string,
  amount: bigint,
  expirationLedger: number,
): Promise<{ tx: Transaction }> {
  return soroban.buildInvoke(owner, tokenSac, "approve", [
    sc.address(owner),
    sc.address(spender),
    sc.i128(amount),
    sc.u32(expirationLedger),
  ]);
}

/** SAC allowance okuma */
export async function readAllowance(soroban: SorobanClient, reader: string, tokenSac: string, from: string, spender: string): Promise<bigint> {
  const r = await soroban.read<bigint>(reader, tokenSac, "allowance", [sc.address(from), sc.address(spender)]);
  return BigInt(r ?? 0);
}

export async function readBalance(soroban: SorobanClient, reader: string, tokenSac: string, holder: string): Promise<bigint> {
  const r = await soroban.read<bigint>(reader, tokenSac, "balance", [sc.address(holder)]);
  return BigInt(r ?? 0);
}
