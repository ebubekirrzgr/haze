/**
 * Sahte zincir: testler ve `CHAIN=fake` ile testnet olmadan UI geliştirme.
 */
import { toStroops, type CardState, type PoolState, type PositionAmounts } from "@haze/stellar";
import type { ChainOps } from "./chain.ts";

export const USDC = "CUSDC";
export const HUSDY = "CHUSDY";

export function fakePool(): PoolState {
  const reserves = [
    { asset: USDC, code: "USDC", index: 0, c_factor: 0.95, l_factor: 0.95, price: toStroops("1"), priceTimestamp: 0, supplyApr: 0.03, borrowApr: 0.04 },
    { asset: HUSDY, code: "hUSDY", index: 1, c_factor: 0.9, l_factor: 0.1, price: toStroops("1.02"), priceTimestamp: 0, supplyApr: 0, borrowApr: 0 },
  ];
  return { poolId: "CPOOL", mode: "hazecredit", reserves, byAsset: Object.fromEntries(reserves.map((r) => [r.asset, r])), byIndex: Object.fromEntries(reserves.map((r) => [r.index, r])), loadedAt: Date.now() };
}

export class FakeChain implements ChainOps {
  positions: PositionAmounts = { collateral: { [USDC]: toStroops("1000"), [HUSDY]: toStroops("500") }, liabilities: {} };
  card: CardState = { day: 0n, spent_today: 0n, daily_limit: toStroops("500"), frozen: false };
  borrowCalls: { vault: string; amount: bigint; authId: string }[] = [];
  failNext = 0;
  refunds: bigint[] = [];
  async poolState() { return fakePool(); }
  async vaultPositions() { return this.positions; }
  async cardState() { return this.card; }
  async vaultAddressFor(o: string) { return "CVAULT" + o; }
  async vaultExists() { return null; }
  async usdcAllowance() { return 0n; }
  async usdcBalance() { return 0n; }
  async latestLedger() { return 1; }
  async borrowForCard(vault: string, amount: bigint, authId: Uint8Array) {
    if (this.failNext > 0) { this.failNext--; throw new Error("rpc timeout"); }
    this.borrowCalls.push({ vault, amount, authId: Buffer.from(authId).toString("hex") });
    this.positions = { ...this.positions, liabilities: { [USDC]: (this.positions.liabilities[USDC] ?? 0n) + amount } };
    this.card = { ...this.card, spent_today: this.card.spent_today + amount };
    return { hash: "tx" + this.borrowCalls.length };
  }
  async refundForCard(_v: string, amount: bigint) { this.refunds.push(amount); return { hash: "refund" }; }
  async settleSalary() { return { hash: "settle" }; }
  async settlementRefund() { return { hash: "sref" }; }
  async setOraclePrices() { return { hash: "px" }; }
  async sponsorAndSend() { return { hash: "fb" }; }
  async send() { return { hash: "s" }; }
  async events() { return { events: [], latestLedger: 1 }; }
}

