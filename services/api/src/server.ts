import { serve } from "@hono/node-server";
import { loadEnv } from "./env.ts";
import { buildApp, buildServices } from "./app.ts";

const env = loadEnv();
const fake = process.env.CHAIN === "fake";
if (fake) {
  const f = await import("./fake-chain.ts");
  env.cfg.assets.USDC.sac = f.USDC;
  env.cfg.assets.hUSDY.sac = f.HUSDY;
  env.cfg.assets.hXAU.sac = "CHXAU";
  env.cfg.assets.hNVDA.sac = "CHNVDA";
  env.cfg.assets.hSHEL.sac = "CHSHEL";
  env.cfg.assets.hBMW.sac = "CHBMW";
  for (const c of ["hTRY", "hEUR", "hGBP", "hCHF", "hARS", "hBRL"] as const) env.cfg.assets[c].sac = `C${c.slice(1)}`;
  env.cfg.blend.mode = "hazecredit";
  env.cfg.haze.hazeCredit = "CPOOL";
  env.cfg.haze.vaultFactory = "CFACTORY";
}
const s = buildServices(env, fake ? new (await import("./fake-chain.ts")).FakeChain() : undefined);
if (fake) {
  // testnet olmadan UI geliştirme: demo kullanıcıyı sahte vault + kartla kaydet
  const { Keypair } = await import("@stellar/stellar-sdk");
  const pub = process.env.DEMO_USER_SECRET ? Keypair.fromSecret(process.env.DEMO_USER_SECRET).publicKey() : "GDEMO";
  s.db.upsertUser({ id: pub, g_address: pub, vault_address: "CVAULT", card_token: "demo_fake", card_last4: "4821" });
  s.prices.usdTry = 41_0000000n;
  s.log(`CHAIN=fake · demo kullanıcı ${pub}`);
}
const app = buildApp(s);

// arka plan döngüleri
if (!fake) {
  s.prices.start(env.priceIntervalSec);
  s.indexer.start(5000);
}
setInterval(() => void s.card.drainQueue(), 4000);

serve({ fetch: app.fetch, port: env.port }, (info) => {
  s.log(`listening on http://localhost:${info.port} · pool mode ${env.cfg.blend.mode} · lithic ${env.lithic.enabled ? "on" : "off (direct ASA)"}`);
});
