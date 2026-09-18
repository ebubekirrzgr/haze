/**
 * SQLite (node:sqlite) — belgedeki veri modeli: users, holds, anchor_txs, rules, prices (+ kv).
 */
import { DatabaseSync } from "node:sqlite";

export type HoldStatus = "PENDING" | "BORROWED" | "CLEARED" | "REFUNDED" | "FAILED" | "DECLINED";

export interface UserRow {
  id: string;
  g_address: string;
  vault_address: string | null;
  card_token: string | null;
  card_last4: string | null;
  allowance_amount: string; // bigint as text
  allowance_expiry_ledger: number;
  anchor_jwt: string | null;
  anchor_jwt_at: number;
  created_at: number;
}

export interface HoldRow {
  auth_id: string; // hex
  lithic_token: string | null;
  user_id: string;
  usd_cents: number;
  usdc_amount: string; // bigint text
  merchant: string;
  merchant_try: string | null;
  mcc: string | null;
  status: HoldStatus;
  borrow_tx: string | null;
  attempts: number;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface AnchorTxRow {
  id: string;
  user_id: string;
  kind: "deposit" | "withdraw";
  quote_id: string | null;
  amount_try: string | null;
  amount_usdc: string | null;
  status: string;
  stellar_tx: string | null;
  created_at: number;
  updated_at: number;
}

export interface RuleRow {
  user_id: string;
  repay_first: number;
  allocation: string; // JSON {USDC:50,hUSDY:30,hXAU:20}
}

export interface PriceRow {
  asset: string;
  price: string; // 7 ondalık bigint text
  source: string;
  updated_at: number;
}

export interface NotificationRow {
  id: number;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  data: string | null;
  created_at: number;
}

export class Db {
  readonly d: DatabaseSync;
  constructor(path: string) {
    this.d = new DatabaseSync(path);
    this.d.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        g_address TEXT UNIQUE NOT NULL,
        vault_address TEXT,
        card_token TEXT,
        card_last4 TEXT,
        allowance_amount TEXT NOT NULL DEFAULT '0',
        allowance_expiry_ledger INTEGER NOT NULL DEFAULT 0,
        anchor_jwt TEXT,
        anchor_jwt_at INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS holds (
        auth_id TEXT PRIMARY KEY,
        lithic_token TEXT,
        user_id TEXT NOT NULL,
        usd_cents INTEGER NOT NULL,
        usdc_amount TEXT NOT NULL,
        merchant TEXT NOT NULL,
        merchant_try TEXT,
        mcc TEXT,
        status TEXT NOT NULL,
        borrow_tx TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS holds_user ON holds(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS holds_status ON holds(status);
      CREATE TABLE IF NOT EXISTS anchor_txs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        quote_id TEXT,
        amount_try TEXT,
        amount_usdc TEXT,
        status TEXT NOT NULL,
        stellar_tx TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rules (
        user_id TEXT PRIMARY KEY,
        repay_first INTEGER NOT NULL DEFAULT 1,
        allocation TEXT NOT NULL DEFAULT '{"USDC":50,"hUSDY":30,"hXAU":20}'
      );
      CREATE TABLE IF NOT EXISTS prices (
        asset TEXT PRIMARY KEY,
        price TEXT NOT NULL,
        source TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        data TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    `);
  }

  // ---- kv ----
  get(k: string): string | undefined {
    const r = this.d.prepare("SELECT v FROM kv WHERE k = ?").get(k) as { v: string } | undefined;
    return r?.v;
  }
  set(k: string, v: string) {
    this.d.prepare("INSERT INTO kv(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, v);
  }

  // ---- users ----
  upsertUser(u: Pick<UserRow, "id" | "g_address"> & Partial<UserRow>): UserRow {
    const now = Date.now();
    this.d
      .prepare(
        `INSERT INTO users(id, g_address, vault_address, card_token, card_last4, created_at)
         VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           vault_address = COALESCE(excluded.vault_address, users.vault_address),
           card_token = COALESCE(excluded.card_token, users.card_token),
           card_last4 = COALESCE(excluded.card_last4, users.card_last4)`,
      )
      .run(u.id, u.g_address, u.vault_address ?? null, u.card_token ?? null, u.card_last4 ?? null, now);
    return this.user(u.id)!;
  }
  user(id: string): UserRow | undefined {
    return this.d.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  }
  userByAddress(g: string): UserRow | undefined {
    return this.d.prepare("SELECT * FROM users WHERE g_address = ?").get(g) as UserRow | undefined;
  }
  userByCard(cardToken: string): UserRow | undefined {
    return this.d.prepare("SELECT * FROM users WHERE card_token = ?").get(cardToken) as UserRow | undefined;
  }
  userByVault(vault: string): UserRow | undefined {
    return this.d.prepare("SELECT * FROM users WHERE vault_address = ?").get(vault) as UserRow | undefined;
  }
  users(): UserRow[] {
    return this.d.prepare("SELECT * FROM users").all() as unknown as UserRow[];
  }
  setAllowance(id: string, amount: bigint, expiryLedger: number) {
    this.d.prepare("UPDATE users SET allowance_amount = ?, allowance_expiry_ledger = ? WHERE id = ?").run(amount.toString(), expiryLedger, id);
  }
  setAnchorJwt(id: string, jwt: string) {
    this.d.prepare("UPDATE users SET anchor_jwt = ?, anchor_jwt_at = ? WHERE id = ?").run(jwt, Date.now(), id);
  }
  setCard(id: string, cardToken: string, last4: string) {
    this.d.prepare("UPDATE users SET card_token = ?, card_last4 = ? WHERE id = ?").run(cardToken, last4, id);
  }
  setVault(id: string, vault: string) {
    this.d.prepare("UPDATE users SET vault_address = ? WHERE id = ?").run(vault, id);
  }

  // ---- holds ----
  insertHold(h: Omit<HoldRow, "created_at" | "updated_at" | "attempts" | "error" | "borrow_tx">): HoldRow {
    const now = Date.now();
    this.d
      .prepare(
        `INSERT INTO holds(auth_id, lithic_token, user_id, usd_cents, usdc_amount, merchant, merchant_try, mcc, status, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(h.auth_id, h.lithic_token, h.user_id, h.usd_cents, h.usdc_amount, h.merchant, h.merchant_try, h.mcc, h.status, now, now);
    return this.hold(h.auth_id)!;
  }
  hold(authId: string): HoldRow | undefined {
    return this.d.prepare("SELECT * FROM holds WHERE auth_id = ?").get(authId) as HoldRow | undefined;
  }
  holdByLithic(token: string): HoldRow | undefined {
    return this.d.prepare("SELECT * FROM holds WHERE lithic_token = ?").get(token) as HoldRow | undefined;
  }
  updateHold(authId: string, patch: Partial<Pick<HoldRow, "status" | "borrow_tx" | "attempts" | "error" | "lithic_token">>) {
    const sets: string[] = ["updated_at = ?"];
    const vals: (string | number | null)[] = [Date.now()];
    for (const [k, v] of Object.entries(patch)) {
      sets.push(`${k} = ?`);
      vals.push(v as string | number | null);
    }
    vals.push(authId);
    this.d.prepare(`UPDATE holds SET ${sets.join(", ")} WHERE auth_id = ?`).run(...vals);
  }
  holdsByStatus(status: HoldStatus, limit = 50): HoldRow[] {
    return this.d.prepare("SELECT * FROM holds WHERE status = ? ORDER BY created_at ASC LIMIT ?").all(status, limit) as unknown as HoldRow[];
  }
  userHolds(userId: string, limit = 50): HoldRow[] {
    return this.d.prepare("SELECT * FROM holds WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(userId, limit) as unknown as HoldRow[];
  }
  /** Zincire henüz yansımamış hold'ların USDC toplamı (PENDING). BORROWED zaten pozisyonda görünür. */
  openHoldsUsdc(userId: string): bigint {
    const rows = this.d.prepare("SELECT usdc_amount FROM holds WHERE user_id = ? AND status = 'PENDING'").all(userId) as { usdc_amount: string }[];
    return rows.reduce((s, r) => s + BigInt(r.usdc_amount), 0n);
  }

  // ---- anchor txs ----
  insertAnchorTx(t: Omit<AnchorTxRow, "created_at" | "updated_at">): void {
    const now = Date.now();
    this.d
      .prepare(
        `INSERT INTO anchor_txs(id, user_id, kind, quote_id, amount_try, amount_usdc, status, stellar_tx, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, stellar_tx = COALESCE(excluded.stellar_tx, anchor_txs.stellar_tx), updated_at = excluded.updated_at`,
      )
      .run(t.id, t.user_id, t.kind, t.quote_id, t.amount_try, t.amount_usdc, t.status, t.stellar_tx, now, now);
  }
  updateAnchorTx(id: string, status: string, stellarTx?: string) {
    this.d.prepare("UPDATE anchor_txs SET status = ?, stellar_tx = COALESCE(?, stellar_tx), updated_at = ? WHERE id = ?").run(status, stellarTx ?? null, Date.now(), id);
  }
  userAnchorTxs(userId: string): AnchorTxRow[] {
    return this.d.prepare("SELECT * FROM anchor_txs WHERE user_id = ? ORDER BY created_at DESC").all(userId) as unknown as AnchorTxRow[];
  }

  // ---- rules ----
  rule(userId: string): RuleRow {
    const r = this.d.prepare("SELECT * FROM rules WHERE user_id = ?").get(userId) as RuleRow | undefined;
    return r ?? { user_id: userId, repay_first: 1, allocation: '{"USDC":50,"hUSDY":30,"hXAU":20}' };
  }
  setRule(userId: string, allocation: Record<string, number>, repayFirst = true) {
    this.d
      .prepare("INSERT INTO rules(user_id, repay_first, allocation) VALUES(?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET repay_first = excluded.repay_first, allocation = excluded.allocation")
      .run(userId, repayFirst ? 1 : 0, JSON.stringify(allocation));
  }

  // ---- prices ----
  setPrice(asset: string, price: bigint, source: string) {
    this.d.prepare("INSERT INTO prices(asset, price, source, updated_at) VALUES(?, ?, ?, ?) ON CONFLICT(asset) DO UPDATE SET price = excluded.price, source = excluded.source, updated_at = excluded.updated_at").run(asset, price.toString(), source, Date.now());
  }
  prices(): PriceRow[] {
    return this.d.prepare("SELECT * FROM prices").all() as unknown as PriceRow[];
  }
  price(asset: string): bigint | undefined {
    const r = this.d.prepare("SELECT price FROM prices WHERE asset = ?").get(asset) as { price: string } | undefined;
    return r ? BigInt(r.price) : undefined;
  }

  // ---- notifications ----
  notify(userId: string, kind: string, title: string, body: string, data?: unknown) {
    this.d.prepare("INSERT INTO notifications(user_id, kind, title, body, data, created_at) VALUES(?, ?, ?, ?, ?, ?)").run(userId, kind, title, body, data ? JSON.stringify(data) : null, Date.now());
  }
  notifications(userId: string, since = 0, limit = 50): NotificationRow[] {
    return this.d.prepare("SELECT * FROM notifications WHERE user_id = ? AND id > ? ORDER BY id DESC LIMIT ?").all(userId, since, limit) as unknown as NotificationRow[];
  }
}
