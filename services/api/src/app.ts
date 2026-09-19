/**
 * Hono uygulaması. server.ts bunu dinler; testler doğrudan app.request() ile çağırabilir.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { Keypair, Asset } from "@stellar/stellar-sdk";
import { buildSponsoredAccountCreation, classicAsset, toStroops, toFloat, usdCentsToUsdc } from "@haze/stellar";
import type { Env } from "./env.ts";
import { Db } from "./db.ts";
import { LiveChain, parseInner, type ChainOps } from "./chain.ts";
import { CreditService } from "./modules/credit.ts";
import { CardService } from "./modules/card.ts";
import { LithicClient, verifyLithicWebhook, webhookHeaders, type AsaRequest, normalizeAsaRequest, toLithicAsaResponse, type LithicAsaRaw } from "./modules/lithic.ts";
import { RulesService } from "./modules/rules.ts";
import { PriceService } from "./modules/prices.ts";
import { Indexer } from "./modules/indexer.ts";
import { AnchorService } from "./modules/anchor.ts";
import { checkAllowlist, hasSourceSignature, RateLimiter } from "./modules/sponsor.ts";

export interface Services {
  env: Env;
  db: Db;
  chain: ChainOps;
  credit: CreditService;
  card: CardService;
  rules: RulesService;
  prices: PriceService;
  indexer: Indexer;
  anchor: AnchorService;
  lithic?: LithicClient;
  log: (msg: string, extra?: unknown) => void;
}

export function buildServices(env: Env, chain?: ChainOps): Services {
  const log = (msg: string, extra?: unknown) => console.log(`[haze-api] ${msg}`, extra ?? "");
  const db = new Db(env.dbPath);
  const ch = chain ?? new LiveChain(env);
  const credit = new CreditService(db, ch, env.cfg.assets.USDC.sac, env.creditCacheSec * 1000);
  const prices = new PriceService({
    cfg: env.cfg,
    db,
    chain: ch,
    marketMaker: env.treasury,
    fxSigner: env.operator,
    husdyApy: env.husdyApy,
    daysPerMinute: env.yieldAccelerationDaysPerMinute,
    log,
  });
  const card = new CardService({ db, chain: ch, credit, log, usdTry: () => prices.usdTry });
  const rules = new RulesService({ db, chain: ch, credit, log });
  const indexer = new Indexer({ db, chain: ch, card, credit, factoryId: env.cfg.haze.vaultFactory, log });
  const anchor = new AnchorService({ cfg: env.cfg, db, rules, log });
  const lithic = env.lithic.enabled ? new LithicClient(env.lithic.apiKey, env.lithic.baseUrl) : undefined;
  return { env, db, chain: ch, credit, card, rules, prices, indexer, anchor, lithic, log };
}

/** bigint alanları (tutarlar, 7 ondalık) JSON'a string olarak yazılır; aksi halde c.json TypeError atar. */
function bigintSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x))) as T;
}

export function buildApp(s: Services) {
  const app = new Hono();
  const rl = new RateLimiter(10);
  const cfg = s.env.cfg;
  app.use("*", cors());

  app.get("/health", (c) => c.json({ ok: true, mode: cfg.blend.mode, lithic: !!s.lithic, ts: Date.now() }));

  app.get("/config", (c) =>
    c.json({
      network: cfg.network,
      networkPassphrase: cfg.networkPassphrase,
      rpcUrl: cfg.rpcUrl,
      horizonUrl: cfg.horizonUrl,
      anchorHomeDomain: cfg.anchorHomeDomain,
      assets: cfg.assets,
      pool: cfg.blend.mode === "hazecredit" ? cfg.haze.hazeCredit : cfg.blend.pool,
      poolMode: cfg.blend.mode,
      vaultFactory: cfg.haze.vaultFactory,
      sponsor: s.env.sponsor.publicKey(),
      operator: s.env.operator.publicKey(),
      settlement: s.env.settlement.publicKey(),
      demo: { husdyApy: s.env.husdyApy, daysPerMinute: s.env.yieldAccelerationDaysPerMinute },
    }),
  );

  // ---------- onboarding & sponsor ----------
  app.post("/onboard", async (c) => {
    const { publicKey } = await c.req.json<{ publicKey: string }>();
    const assets = (["USDC", "hUSDY", "hXAU", "hTRY"] as const).filter((k) => cfg.assets[k].issuer).map((k) => classicAsset(cfg.assets[k]));
    const tx = await buildSponsoredAccountCreation(cfg, s.env.sponsor.publicKey(), publicKey, assets);
    tx.sign(s.env.sponsor);
    s.db.upsertUser({ id: publicKey, g_address: publicKey });
    return c.json({ xdr: tx.toXDR(), networkPassphrase: cfg.networkPassphrase });
  });

  app.post("/onboard/submit", async (c) => {
    const { xdr } = await c.req.json<{ xdr: string }>();
    const tx = parseInner(xdr, cfg.networkPassphrase);
    if (tx.source !== s.env.sponsor.publicKey()) return c.json({ error: "not an onboarding tx" }, 400);
    const ref = await s.chain.send(tx);
    const created = tx.operations.find((o) => o.type === "createAccount") as { destination?: string } | undefined;
    const g = created?.destination;
    let vaultAddress: string | null = null;
    if (g) {
      vaultAddress = await s.chain.vaultAddressFor(g);
      s.db.upsertUser({ id: g, g_address: g });
    }
    return c.json({ hash: ref.hash, vaultAddress });
  });

  app.post("/tx/sponsor", async (c) => {
    const { xdr } = await c.req.json<{ xdr: string }>();
    let tx;
    try {
      tx = parseInner(xdr, cfg.networkPassphrase);
    } catch (e) {
      return c.json({ error: `bad xdr: ${e instanceof Error ? e.message : e}` }, 400);
    }
    if (!rl.allow(tx.source)) return c.json({ error: "rate limited" }, 429);
    if (!hasSourceSignature(tx)) return c.json({ error: "source signature missing" }, 400);
    const verdict = await checkAllowlist(tx, {
      cfg,
      vaultOf: async (g) => s.db.user(g)?.vault_address ?? (await s.chain.vaultExists(g)),
      anchorTreasury: s.db.get("anchor.treasury") ?? cfg.anchorTreasury,
    });
    if (!verdict.ok) return c.json({ error: `not allowed: ${verdict.reason}` }, 403);
    try {
      const ref = await s.chain.sponsorAndSend(tx);
      const u = s.db.user(tx.source);
      if (u) s.credit.invalidate(u.id);
      return c.json({ hash: ref.hash, ledger: ref.ledger });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
  });

  /** create_vault sonrası: vault adresini kaydet */
  app.post("/vault/register", async (c) => {
    const { publicKey } = await c.req.json<{ publicKey: string }>();
    const v = await s.chain.vaultExists(publicKey);
    if (!v) return c.json({ error: "vault not deployed yet" }, 404);
    s.db.upsertUser({ id: publicKey, g_address: publicKey, vault_address: v });
    s.db.setVault(publicKey, v);
    return c.json({ vaultAddress: v });
  });

  // ---------- kullanıcı ----------
  app.get("/users/:id", async (c) => {
    const u = s.db.user(c.req.param("id"));
    if (!u) return c.json({ error: "not found" }, 404);
    return c.json({
      id: u.id,
      gAddress: u.g_address,
      vaultAddress: u.vault_address,
      card: u.card_token ? { token: u.card_token, last4: u.card_last4 } : null,
      allowance: { amount: u.allowance_amount, expiryLedger: u.allowance_expiry_ledger },
      hasAnchorToken: !!u.anchor_jwt,
      rule: s.db.rule(u.id),
    });
  });
  app.get("/users/:id/holds", (c) => c.json(s.db.userHolds(c.req.param("id"))));
  app.get("/users/:id/notifications", (c) => c.json(s.db.notifications(c.req.param("id"), Number(c.req.query("since") ?? 0))));
  app.get("/users/:id/anchor-txs", (c) => c.json(s.db.userAnchorTxs(c.req.param("id"))));

  app.get("/credit/:id", async (c) => {
    try {
      const uc = await s.credit.get(c.req.param("id"), c.req.query("fresh") === "1");
      return c.json(s.credit.toJson(uc));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  });

  app.post("/rules", async (c) => {
    const { userId, allocation, repayFirst } = await c.req.json<{ userId: string; allocation: Record<string, number>; repayFirst?: boolean }>();
    const sum = Object.values(allocation).reduce((a, b) => a + b, 0);
    if (Math.round(sum) !== 100) return c.json({ error: "allocation must sum to 100" }, 400);
    s.db.setRule(userId, allocation, repayFirst ?? true);
    return c.json({ ok: true });
  });

  app.post("/allowance", async (c) => {
    const { userId, amount, expiryLedger } = await c.req.json<{ userId: string; amount: string; expiryLedger: number }>();
    s.rules.recordAllowance(userId, BigInt(amount), expiryLedger);
    return c.json({ ok: true });
  });

  // ---------- anchor ----------
  app.post("/anchor/token", async (c) => {
    const { userId, jwt } = await c.req.json<{ userId: string; jwt: string }>();
    if (!s.db.user(userId)) s.db.upsertUser({ id: userId, g_address: userId });
    s.db.setAnchorJwt(userId, jwt);
    return c.json({ ok: true });
  });
  app.post("/anchor/treasury", async (c) => {
    const { address } = await c.req.json<{ address: string }>();
    s.db.set("anchor.treasury", address);
    return c.json({ ok: true });
  });
  app.post("/salary/start", async (c) => {
    const { userId, amountTry } = await c.req.json<{ userId: string; amountTry: number }>();
    try {
      const r = await s.anchor.startSalary(userId, Number(amountTry), (m) => s.log(`salary ${userId}: ${m}`));
      return c.json(bigintSafe(r));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });
  app.post("/salary/settle", async (c) => {
    const { userId, amount } = await c.req.json<{ userId: string; amount?: string }>();
    const r = await s.rules.settleSalary(userId, amount ? BigInt(amount) : undefined);
    return c.json(bigintSafe(r), r.ok ? 200 : 409);
  });
  app.post("/cashout/start", async (c) => {
    const { userId, amountTry } = await c.req.json<{ userId: string; amountTry: number }>();
    try {
      return c.json(await s.anchor.cashoutInstructions(userId, Number(amountTry)));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });
  app.get("/cashout/:userId/:id", async (c) => c.json(await s.anchor.status(c.req.param("userId"), c.req.param("id"))));

  // ---------- kart ----------
  app.post("/card/create", async (c) => {
    const { userId } = await c.req.json<{ userId: string }>();
    const u = s.db.user(userId);
    if (!u) return c.json({ error: "user not found" }, 404);
    if (u.card_token) return c.json({ token: u.card_token, last4: u.card_last4, existing: true });
    if (s.lithic) {
      const card = await s.lithic.createVirtualCard(`haze:${userId}`);
      s.db.setCard(userId, card.token, card.last_four);
      return c.json({ token: card.token, last4: card.last_four, pan: card.pan, expMonth: card.exp_month, expYear: card.exp_year, cvv: card.cvv });
    }
    // Lithic yoksa demo kart (Visa test BIN)
    const rand = Math.floor(1000 + Math.random() * 9000);
    const token = `demo_${Keypair.random().publicKey().slice(1, 9).toLowerCase()}`;
    const pan = `4111 1111 1111 ${rand}`;
    s.db.setCard(userId, token, String(rand));
    return c.json({ token, last4: String(rand), pan, expMonth: "09", expYear: "2029", cvv: "123", demo: true });
  });

  app.post("/card/asa", async (c) => {
    const raw = await c.req.text();
    if (s.env.verifyAsaHmac) {
      // Tünel üzerinden internete açık uç: imzasız ASA kabul edilirse herkes kasalara karşı harcama yetkilendirebilir.
      if (!s.env.lithic.webhookSecret || !verifyLithicWebhook(s.env.lithic.webhookSecret, raw, webhookHeaders((n) => c.req.header(n)))) return c.json({ error: "bad signature" }, 401);
    }
    const { req, fromLithic } = normalizeAsaRequest(JSON.parse(raw) as LithicAsaRaw);
    s.log(`ASA ← ${fromLithic ? "lithic" : "direct"} ${req.token} card …${req.card_token.slice(-4)} ${req.amount}c ${req.merchant.descriptor}`);
    const res = await s.card.authorize(req);
    return c.json(fromLithic ? toLithicAsaResponse(res) : res);
  });

  app.post("/card/webhook", async (c) => {
    const raw = await c.req.text();
    if (s.env.verifyAsaHmac) {
      if (!s.env.lithic.eventSecret || !verifyLithicWebhook(s.env.lithic.eventSecret, raw, webhookHeaders((n) => c.req.header(n)))) return c.json({ error: "bad signature" }, 401);
    }
    // Lithic event webhook'u zarf gönderir: { event_type, payload: { token, status, amount, … } }; düz işlem gövdesi de kabul edilir.
    const env = JSON.parse(raw) as { event_type?: string; payload?: Record<string, unknown>; token?: string; status?: string; amount?: number };
    const ev = (env.payload && typeof env.payload === "object" ? env.payload : env) as { token?: string; status?: string; amount?: number };
    if (ev.token && ev.status) await s.card.onTransactionEvent({ token: ev.token, status: ev.status, amount: ev.amount });
    return c.json({ ok: true });
  });

  // ---------- terminal (demo POS) ----------
  /** TL tutar → USD sent → Lithic simulate/authorize ya da doğrudan ASA */
  app.post("/terminal/charge", async (c) => {
    const { userId, amountTry, merchant, mcc, city } = await c.req.json<{ userId: string; amountTry: number; merchant?: string; mcc?: string; city?: string }>();
    if (!Number(amountTry) || Number(amountTry) <= 0) return c.json({ error: "bad amount" }, 400);
    const u = s.db.user(userId);
    if (!u?.card_token) return c.json({ error: "user has no card" }, 400);
    const rate = s.prices.usdTry ?? (await s.prices.refreshFx());
    if (!rate) return c.json({ error: "FX rate unavailable" }, 503);
    const cents = s.prices.tryToUsdCents(Number(amountTry))!;
    const descriptor = `${merchant ?? "KAFE"} ${city ?? "BURSA"} TR`;
    if (s.lithic && !u.card_token.startsWith("demo_")) {
      const card = await s.lithic.getCard(u.card_token);
      const r = await s.lithic.simulateAuthorize({ pan: card.pan!, amount: cents, descriptor, mcc: mcc ?? "5814" });
      return c.json({ via: "lithic", token: r.token, usdCents: cents, descriptor });
    }
    const token = `term_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const res = await s.card.authorize({
      token,
      card_token: u.card_token,
      amount: cents,
      merchant: { descriptor, mcc: mcc ?? "5814", country: "TUR", city: city ?? "BURSA" },
      merchant_currency: "USD",
      haze_try_amount: Number(amountTry).toFixed(2),
    });
    return c.json({ via: "direct", token, usdCents: cents, usdc: usdCentsToUsdc(cents).toString(), descriptor, ...res });
  });
  app.post("/terminal/clear", async (c) => {
    const { token } = await c.req.json<{ token: string }>();
    if (s.lithic && !token.startsWith("term_")) await s.lithic.simulateClearing(token);
    else await s.card.onTransactionEvent({ token, status: "SETTLED" });
    return c.json({ ok: true });
  });
  app.post("/terminal/void", async (c) => {
    const { token } = await c.req.json<{ token: string }>();
    if (s.lithic && !token.startsWith("term_")) await s.lithic.simulateVoid(token);
    else await s.card.onTransactionEvent({ token, status: "VOIDED" });
    return c.json({ ok: true });
  });

  // ---------- fiyat / admin ----------
  app.get("/prices", (c) => c.json(s.prices.toJson()));
  app.post("/prices/tick", async (c) => {
    await s.prices.tick();
    return c.json(s.prices.toJson());
  });
  app.get("/admin/users", (c) => c.json(s.db.users().map((u) => ({ id: u.id, vault: u.vault_address, card: u.card_token ? { token: u.card_token, last4: u.card_last4 } : null }))));
  app.get("/admin/holds", (c) =>
    c.json({
      pending: s.db.holdsByStatus("PENDING"),
      failed: s.db.holdsByStatus("FAILED"),
      borrowed: s.db.holdsByStatus("BORROWED", 20),
    }),
  );
  app.post("/admin/holds/:authId/retry", async (c) => {
    const h = s.db.hold(c.req.param("authId"));
    if (!h) return c.json({ error: "not found" }, 404);
    s.db.updateHold(h.auth_id, { status: "PENDING", attempts: 0, error: null });
    await s.card.drainQueue();
    return c.json(s.db.hold(h.auth_id));
  });

  app.get("/", (c) => c.text(`haze-api · ${toFloat(toStroops("1"))} · ${Asset.native().code}`));
  return app;
}
