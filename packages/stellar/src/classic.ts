/**
 * Klasik Stellar işlemleri: sponsorlu hesap açılışı, trustline, path payment, memo'lu ödeme, fee-bump.
 */
import {
  Asset,
  BASE_FEE,
  FeeBumpTransaction,
  Horizon,
  Keypair,
  Memo,
  Operation,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import type { AssetEntry, HazeConfig } from "./config.ts";
import { fromStroops } from "./amount.ts";

export function classicAsset(a: AssetEntry): Asset {
  return a.code === "XLM" && !a.issuer ? Asset.native() : new Asset(a.code, a.issuer);
}

export function horizon(cfg: HazeConfig): Horizon.Server {
  return new Horizon.Server(cfg.horizonUrl);
}

/**
 * Sponsorlu hesap açılış paketi. Sponsor kaynak hesaptır; yeni hesap 0 XLM ile açılır, rezervler
 * ve trustline'lar sponsorlanır. Yeni hesabın anahtarı da işlemi imzalamalıdır (trustline'lar için).
 */
export async function buildSponsoredAccountCreation(
  cfg: HazeConfig,
  sponsorPub: string,
  newAccountPub: string,
  trustAssets: Asset[],
): Promise<Transaction> {
  const server = horizon(cfg);
  const sponsor = await server.loadAccount(sponsorPub);
  const b = new TransactionBuilder(sponsor, { fee: (Number(BASE_FEE) * 10).toString(), networkPassphrase: cfg.networkPassphrase })
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: newAccountPub }))
    .addOperation(Operation.createAccount({ destination: newAccountPub, startingBalance: "0" }));
  for (const asset of trustAssets) {
    b.addOperation(Operation.changeTrust({ asset, source: newAccountPub }));
  }
  b.addOperation(Operation.endSponsoringFutureReserves({ source: newAccountPub }));
  return b.setTimeout(120).build();
}

/** Var olan hesaba sponsorlu trustline ekle */
export async function buildSponsoredTrustlines(
  cfg: HazeConfig,
  sponsorPub: string,
  accountPub: string,
  trustAssets: Asset[],
): Promise<Transaction> {
  const server = horizon(cfg);
  const sponsor = await server.loadAccount(sponsorPub);
  const b = new TransactionBuilder(sponsor, { fee: (Number(BASE_FEE) * 10).toString(), networkPassphrase: cfg.networkPassphrase })
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: accountPub }));
  for (const asset of trustAssets) b.addOperation(Operation.changeTrust({ asset, source: accountPub }));
  b.addOperation(Operation.endSponsoringFutureReserves({ source: accountPub }));
  return b.setTimeout(120).build();
}

/**
 * PathPaymentStrictReceive: `destAmount` kadar destAsset alınır, en fazla `sendMax` sendAsset gider.
 * Kaynak = kullanıcı. Varlık dağılımı (USDC → hUSDY/hXAU) ve nakde çevirme (hXAU → USDC, hazineye memo'lu) için.
 */
export async function buildPathPaymentStrictReceive(
  cfg: HazeConfig,
  sourcePub: string,
  params: {
    sendAsset: Asset;
    sendMax: bigint;
    destination: string;
    destAsset: Asset;
    destAmount: bigint;
    path?: Asset[];
    memoId?: string;
  },
): Promise<Transaction> {
  const server = horizon(cfg);
  const account = await server.loadAccount(sourcePub);
  const b = new TransactionBuilder(account, { fee: (Number(BASE_FEE) * 10).toString(), networkPassphrase: cfg.networkPassphrase }).addOperation(
    Operation.pathPaymentStrictReceive({
      sendAsset: params.sendAsset,
      sendMax: fromStroops(params.sendMax),
      destination: params.destination,
      destAsset: params.destAsset,
      destAmount: fromStroops(params.destAmount),
      path: params.path ?? [],
    }),
  );
  if (params.memoId) b.addMemo(Memo.id(params.memoId));
  return b.setTimeout(120).build();
}

/** Memo'lu düz ödeme (anchor hazinesine USDC) */
export async function buildMemoPayment(
  cfg: HazeConfig,
  sourcePub: string,
  params: { destination: string; asset: Asset; amount: bigint; memoId?: string; memoText?: string },
): Promise<Transaction> {
  const server = horizon(cfg);
  const account = await server.loadAccount(sourcePub);
  const b = new TransactionBuilder(account, { fee: (Number(BASE_FEE) * 10).toString(), networkPassphrase: cfg.networkPassphrase }).addOperation(
    Operation.payment({ destination: params.destination, asset: params.asset, amount: fromStroops(params.amount) }),
  );
  if (params.memoId) b.addMemo(Memo.id(params.memoId));
  else if (params.memoText) b.addMemo(Memo.text(params.memoText));
  return b.setTimeout(120).build();
}

/** Strict-receive için gerekli gönderim miktarını Horizon'dan tahmin et (sendMax hesabı). */
export async function estimateSendAmount(
  cfg: HazeConfig,
  sendAsset: Asset,
  destAsset: Asset,
  destAmount: bigint,
): Promise<{ sendAmount: bigint; path: Asset[] } | null> {
  const server = horizon(cfg);
  const res = await server.strictReceivePaths([sendAsset], destAsset, fromStroops(destAmount)).call();
  const best = res.records.sort((a, b) => Number(a.source_amount) - Number(b.source_amount))[0];
  if (!best) return null;
  const path = best.path.map((p) => (p.asset_type === "native" ? Asset.native() : new Asset(p.asset_code!, p.asset_issuer!)));
  const [i, f = ""] = best.source_amount.split(".");
  return { sendAmount: BigInt(i) * 10_000_000n + BigInt((f + "0000000").slice(0, 7)), path };
}

/** Sponsor ücreti öder: iç işlemi fee-bump ile sarar ve imzalar. */
/**
 * Sponsor fee-bump. Dış ücret = perOp × (op sayısı + 1) ve iç işlemin ücretini (Soroban kaynak ücreti dahil)
 * kapsamak zorunda; bu yüzden perOp, iç ücretin üstüne en az `minInclusionPerOp` dahil etme payı bırakacak
 * şekilde yükseltilir. Aksi halde surge fiyatlamasında tx_insufficient_fee alınır.
 */
export function feeBump(cfg: HazeConfig, sponsor: Keypair, inner: Transaction, minInclusionPerOp = 200_000): FeeBumpTransaction {
  const ops = Math.max(1, inner.operations.length);
  const innerFee = Number(inner.fee) || 0;
  const maxFeePerOp = Math.ceil(innerFee / (ops + 1)) + minInclusionPerOp;
  const fb = TransactionBuilder.buildFeeBumpTransaction(sponsor, maxFeePerOp.toString(), inner, cfg.networkPassphrase);
  fb.sign(sponsor);
  return fb;
}

/** Hesap bakiyeleri (klasik) → kod → 7 ondalık bigint */
export async function loadBalances(cfg: HazeConfig, pub: string): Promise<Record<string, bigint>> {
  const acc = await horizon(cfg).loadAccount(pub);
  const out: Record<string, bigint> = {};
  for (const b of acc.balances) {
    const code = b.asset_type === "native" ? "XLM" : (b as Horizon.HorizonApi.BalanceLineAsset).asset_code;
    const [i, f = ""] = b.balance.split(".");
    out[code] = BigInt(i) * 10_000_000n + BigInt((f + "0000000").slice(0, 7));
  }
  return out;
}
