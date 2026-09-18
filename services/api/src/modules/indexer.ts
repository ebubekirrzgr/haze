/**
 * Indexer: Soroban RPC getEvents ile vault/factory olaylarını izler.
 *   card_borrow    → hold BORROWED
 *   card_refund    → (hold zaten REFUNDED; bilgi)
 *   salary_settled → bildirim (rules zaten yazar; yedek)
 *   vault_created  → users.vault_address
 */
import { toHex, type DecodedEvent } from "@haze/stellar";
import type { ChainOps } from "../chain.ts";
import type { Db } from "../db.ts";
import type { CardService } from "./card.ts";
import type { CreditService } from "./credit.ts";

export interface IndexerDeps {
  db: Db;
  chain: ChainOps;
  card: CardService;
  credit: CreditService;
  factoryId: string;
  log?: (msg: string) => void;
}

export class Indexer {
  private timer?: NodeJS.Timeout;
  private running = false;
  constructor(private readonly d: IndexerDeps) {}

  private contractIds(): string[] {
    const ids = new Set<string>();
    if (this.d.factoryId) ids.add(this.d.factoryId);
    for (const u of this.d.db.users()) if (u.vault_address) ids.add(u.vault_address);
    return [...ids].slice(0, 5); // RPC filtre başına en fazla 5 kontrat
  }

  async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const ids = this.contractIds();
      if (!ids.length) return;
      const cursor = this.d.db.get("indexer.cursor");
      let start = Number(this.d.db.get("indexer.startLedger") ?? 0);
      if (!start) {
        start = Math.max(1, (await this.d.chain.latestLedger()) - 100);
        this.d.db.set("indexer.startLedger", String(start));
      }
      const res = await this.d.chain.events(ids, start, cursor);
      for (const ev of res.events) this.handle(ev);
      if (res.cursor) this.d.db.set("indexer.cursor", res.cursor);
      else if (res.events.length) this.d.db.set("indexer.startLedger", String(res.events[res.events.length - 1]!.ledger + 1));
    } catch (e) {
      this.d.log?.(`indexer poll failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.running = false;
    }
  }

  handle(ev: DecodedEvent) {
    const data = (ev.data ?? {}) as Record<string, unknown>;
    switch (ev.name) {
      case "card_borrow": {
        const authId = bytesToHex(ev.topics[0]);
        if (authId) this.d.card.markBorrowed(authId, ev.txHash);
        break;
      }
      case "vault_created": {
        const owner = String(ev.topics[0] ?? "");
        const vault = String(data.vault ?? "");
        const u = this.d.db.userByAddress(owner);
        if (u && vault && !u.vault_address) this.d.db.setVault(u.id, vault);
        break;
      }
      case "salary_settled":
      case "card_refund":
      case "vault_action": {
        const u = this.d.db.userByVault(ev.contractId);
        if (u) this.d.credit.invalidate(u.id);
        break;
      }
    }
  }

  start(intervalMs = 5000) {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), intervalMs);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}

function bytesToHex(v: unknown): string | null {
  if (v instanceof Uint8Array) return toHex(v);
  if (typeof v === "string") return v;
  return null;
}
