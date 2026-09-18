/**
 * Soroban yardımcıları: InvokeHostFunction kurma, simülasyon, gönderme, okuma ve event çözme.
 * Tarayıcı ve Node'da çalışır (node: modülü yok).
 */
import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

export const sc = {
  address: (a: string) => new Address(a).toScVal(),
  i128: (v: bigint) => nativeToScVal(v, { type: "i128" }),
  u32: (v: number) => nativeToScVal(v, { type: "u32" }),
  bool: (v: boolean) => nativeToScVal(v),
  bytes: (b: Uint8Array) => xdr.ScVal.scvBytes(b),
  bytesHex: (hex: string) => xdr.ScVal.scvBytes(fromHex(hex)),
  symbol: (s: string) => xdr.ScVal.scvSymbol(s),
  optionI128: (v: bigint | null | undefined) => (v == null ? xdr.ScVal.scvVoid() : nativeToScVal(v, { type: "i128" })),
  vec: (items: xdr.ScVal[]) => xdr.ScVal.scvVec(items),
};

export interface InvokeOptions {
  fee?: string;
  timeoutSec?: number;
  /** simülasyondaki kaynak ücretini bu oranda şişir (yavaş testnet için) */
  resourceFeeMultiplier?: number;
}

export class SorobanClient {
  readonly server: rpc.Server;
  constructor(
    readonly rpcUrl: string,
    readonly passphrase: string,
  ) {
    this.server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });
  }

  /**
   * Tek bir kontrat çağrısı içeren işlemi kurar, simüle eder ve assemble eder.
   * Dönen işlem henüz imzalanmamıştır; kaynak hesap `source`'tur (sequence oradan tüketilir).
   */
  async buildInvoke(
    source: string,
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    opts: InvokeOptions = {},
  ): Promise<{ tx: Transaction; sim: rpc.Api.SimulateTransactionSuccessResponse }> {
    const account = await this.server.getAccount(source);
    const contract = new Contract(contractId);
    const tx = new TransactionBuilder(account, {
      fee: opts.fee ?? (Number(BASE_FEE) * 100).toString(),
      networkPassphrase: this.passphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(opts.timeoutSec ?? 60)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      throw new SimulationError(`${method} simulation failed: ${sim.error}`, sim);
    }
    if (rpc.Api.isSimulationRestore(sim)) {
      throw new SimulationError(`${method} needs state restore (TTL expired)`, sim);
    }
    const assembled = rpc.assembleTransaction(tx, sim).build();
    return { tx: assembled, sim };
  }

  /** Salt okunur çağrı: simüle eder, sonucu native değere çevirir. `source` var olan herhangi bir hesap. */
  async read<T = unknown>(source: string, contractId: string, method: string, args: xdr.ScVal[] = []): Promise<T> {
    const account = await this.server.getAccount(source);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: this.passphrase })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(30)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new SimulationError(`${method} read failed: ${sim.error}`, sim);
    const retval = (sim as rpc.Api.SimulateTransactionSuccessResponse).result?.retval;
    return retval ? (scValToNative(retval) as T) : (undefined as T);
  }

  /** İmzalı işlemi gönderir ve sonucu bekler. */
  async sendAndWait(tx: Transaction | ReturnType<typeof TransactionBuilder.buildFeeBumpTransaction>): Promise<SendResult> {
    const sent = await this.server.sendTransaction(tx);
    if (sent.status === "ERROR") {
      throw new Error(`sendTransaction ERROR: ${sent.errorResult?.toXDR("base64") ?? "unknown"}`);
    }
    const hash = sent.hash;
    const res = await this.server.pollTransaction(hash, { attempts: 40, sleepStrategy: rpc.LinearSleepStrategy });
    if (res.status === "SUCCESS") {
      return { hash, status: "SUCCESS", returnValue: res.returnValue ? scValToNative(res.returnValue) : undefined, ledger: res.ledger };
    }
    if (res.status === "FAILED") {
      throw new Error(`tx ${hash} FAILED: ${res.resultXdr?.toXDR("base64")}`);
    }
    throw new Error(`tx ${hash} not found after polling`);
  }

  /** İmzala + gönder kısayolu (sunucu tarafı anahtarlar için). */
  async signAndSend(tx: Transaction, ...signers: Keypair[]): Promise<SendResult> {
    for (const k of signers) tx.sign(k);
    return this.sendAndWait(tx);
  }

  /** Kontrat event'lerini çeker ve #[contractevent] biçimini çözer. */
  async events(
    contractIds: string[],
    startLedger: number,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<{ events: DecodedEvent[]; latestLedger: number; cursor?: string }> {
    const req: rpc.Server.GetEventsRequest = {
      filters: [{ type: "contract", contractIds }],
      limit: opts.limit ?? 100,
      ...(opts.cursor ? { cursor: opts.cursor } : { startLedger }),
    };
    const res = await this.server.getEvents(req);
    const events = res.events.map(decodeEvent);
    return { events, latestLedger: res.latestLedger, cursor: res.cursor };
  }
}

export interface SendResult {
  hash: string;
  status: "SUCCESS";
  returnValue?: unknown;
  ledger?: number;
}

export class SimulationError extends Error {
  constructor(
    message: string,
    readonly sim: rpc.Api.SimulateTransactionResponse,
  ) {
    super(message);
  }
}

export interface DecodedEvent {
  id: string;
  contractId: string;
  ledger: number;
  txHash: string;
  /** topic[0] (ör. "card_borrow", "salary_settled", "vault_created") */
  name: string;
  topics: unknown[];
  data: unknown;
}

export function decodeEvent(ev: rpc.Api.EventResponse): DecodedEvent {
  const topics = ev.topic.map((t) => {
    try {
      return scValToNative(t);
    } catch {
      return t.toXDR("base64");
    }
  });
  let data: unknown;
  try {
    data = scValToNative(ev.value);
  } catch {
    data = ev.value.toXDR("base64");
  }
  return {
    id: ev.id,
    contractId: ev.contractId?.toString() ?? "",
    ledger: ev.ledger,
    txHash: ev.txHash,
    name: typeof topics[0] === "string" ? topics[0] : String(topics[0]),
    topics: topics.slice(1),
    data,
  };
}

/** Blend Positions (Map<u32,i128>) native çıktısını düz nesneye çevirir. */
export interface RawPositions {
  liabilities: Map<number, bigint> | Record<string, bigint>;
  collateral: Map<number, bigint> | Record<string, bigint>;
  supply: Map<number, bigint> | Record<string, bigint>;
}

export function positionsToRecord(p: Map<number, bigint> | Record<string, bigint> | undefined): Record<number, bigint> {
  const out: Record<number, bigint> = {};
  if (!p) return out;
  if (p instanceof Map) {
    for (const [k, v] of p) out[Number(k)] = BigInt(v);
  } else {
    for (const [k, v] of Object.entries(p)) out[Number(k)] = BigInt(v as bigint);
  }
  return out;
}

export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return new Uint8Array(digest);
}

export function fromHex(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, "");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
