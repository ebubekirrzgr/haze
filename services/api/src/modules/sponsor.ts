/**
 * Sponsor: sponsorlu hesap açılışı ve fee-bump. Musluğa dönüşmesin diye yalnızca izinli işlemler:
 *  - InvokeHostFunction: kullanıcının kendi vault'u, VaultFactory.create_vault, USDC SAC approve(spender = kendi vault'u)
 *  - PathPaymentStrictReceive: izinli varlık çiftleri
 *  - Payment: anchor hazinesine memo'lu USDC
 *  - ChangeTrust: izinli varlıklar
 *  - Hesap başına dakikada en fazla 10 işlem
 */
import { Asset, Keypair, Operation, StrKey, Transaction, xdr, scValToNative } from "@stellar/stellar-sdk";
import type { HazeConfig } from "@haze/stellar";

export interface AllowlistContext {
  cfg: HazeConfig;
  /** kaynak hesabın vault adresi (yoksa null) */
  vaultOf: (g: string) => Promise<string | null>;
  anchorTreasury: string;
}

export interface Verdict {
  ok: boolean;
  reason?: string;
}

const MAX_OPS = 4;

function allowedAssets(cfg: HazeConfig): Set<string> {
  const s = new Set<string>();
  for (const a of Object.values(cfg.assets)) if (a.issuer) s.add(`${a.code}:${a.issuer}`);
  return s;
}

function assetKey(a: Asset): string {
  return a.isNative() ? "XLM" : `${a.getCode()}:${a.getIssuer()}`;
}

export async function checkAllowlist(tx: Transaction, ctx: AllowlistContext): Promise<Verdict> {
  const cfg = ctx.cfg;
  if (tx.operations.length === 0 || tx.operations.length > MAX_OPS) return { ok: false, reason: "op count" };
  const source = tx.source;
  if (!StrKey.isValidEd25519PublicKey(source)) return { ok: false, reason: "source must be G-account" };
  const assets = allowedAssets(cfg);
  const vault = await ctx.vaultOf(source);

  for (const op of tx.operations) {
    if (op.source && op.source !== source) return { ok: false, reason: "op source mismatch" };
    switch (op.type) {
      case "invokeHostFunction": {
        const v = checkInvoke(op as Operation.InvokeHostFunction, cfg, source, vault);
        if (!v.ok) return v;
        break;
      }
      case "pathPaymentStrictReceive": {
        const o = op as Operation.PathPaymentStrictReceive;
        for (const a of [o.sendAsset, o.destAsset, ...o.path]) if (!assets.has(assetKey(a))) return { ok: false, reason: `asset not allowed: ${assetKey(a)}` };
        if (o.destination !== source && o.destination !== ctx.anchorTreasury) return { ok: false, reason: "path payment destination" };
        break;
      }
      case "payment": {
        const o = op as Operation.Payment;
        if (o.destination !== ctx.anchorTreasury) return { ok: false, reason: "payment destination must be anchor treasury" };
        if (assetKey(o.asset) !== `${cfg.assets.USDC.code}:${cfg.assets.USDC.issuer}`) return { ok: false, reason: "payment asset must be USDC" };
        if (tx.memo.type === "none") return { ok: false, reason: "anchor payment needs memo" };
        break;
      }
      case "changeTrust": {
        const o = op as Operation.ChangeTrust;
        if (o.line instanceof Asset && !assets.has(assetKey(o.line))) return { ok: false, reason: "trustline asset not allowed" };
        break;
      }
      default:
        return { ok: false, reason: `op not allowed: ${op.type}` };
    }
  }
  return { ok: true };
}

function checkInvoke(op: Operation.InvokeHostFunction, cfg: HazeConfig, source: string, vault: string | null): Verdict {
  // stellar-sdk 17: XDR nesneleri düz alanlı (js-xdr 5 modeli)
  const fn = op.func as unknown as {
    type: string;
    invokeContract?: { contractAddress: { contractId: { value: Uint8Array } }; functionName: { toString(): string }; args: xdr.ScVal[] };
  };
  if (fn.type !== "hostFunctionTypeInvokeContract" || !fn.invokeContract) return { ok: false, reason: "only invoke contract" };
  const inv = fn.invokeContract;
  const contractId = StrKey.encodeContract(Buffer.from(inv.contractAddress.contractId.value));
  const method = inv.functionName.toString();
  const args = inv.args;

  if (contractId === cfg.haze.vaultFactory) {
    if (method !== "create_vault") return { ok: false, reason: "factory: only create_vault" };
    const owner = scValToNative(args[0]!) as string;
    if (owner !== source) return { ok: false, reason: "factory: owner must be source" };
    return { ok: true };
  }
  if (vault && contractId === vault) {
    const ownerFns = new Set(["deposit", "withdraw", "borrow", "repay", "set_daily_limit", "set_frozen"]);
    if (!ownerFns.has(method)) return { ok: false, reason: `vault: ${method} not allowed via sponsor` };
    return { ok: true };
  }
  if (contractId === cfg.assets.USDC.sac) {
    if (method !== "approve") return { ok: false, reason: "usdc: only approve" };
    const from = scValToNative(args[0]!) as string;
    const spender = scValToNative(args[1]!) as string;
    if (from !== source) return { ok: false, reason: "approve: from must be source" };
    if (!vault || spender !== vault) return { ok: false, reason: "approve: spender must be own vault" };
    return { ok: true };
  }
  return { ok: false, reason: `contract not allowed: ${contractId}` };
}

/** Basit hız sınırı: hesap başına dakikada N işlem */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly perMinute = 10) {}
  allow(key: string, now = Date.now()): boolean {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < 60_000);
    if (arr.length >= this.perMinute) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }
}

/** İç işlemin kaynak hesabı tarafından imzalandığını doğrula */
export function hasSourceSignature(tx: Transaction): boolean {
  const kp = Keypair.fromPublicKey(tx.source);
  const hash = tx.hash();
  return tx.signatures.some((s) => {
    try {
      // stellar-sdk 17 (js-xdr 5): signature.value Uint8Array; eski model: signature() fonksiyonu
      const raw = (s as unknown as { signature: { value?: Uint8Array } | (() => Uint8Array) }).signature;
      const bytes = typeof raw === "function" ? raw.call(s) : (raw.value ?? (raw as unknown as Uint8Array));
      return kp.verify(hash, Buffer.from(bytes));
    } catch {
      return false;
    }
  });
}

export { xdr };
