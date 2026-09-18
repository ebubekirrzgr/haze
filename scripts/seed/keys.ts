/**
 * Adım 1 — anahtarlar: sponsor, operator, issuer, treasury (= distributor + market maker + Blend whale),
 * settlement, oracleAdmin, demo kullanıcı. Friendbot ile fonlar; services/api/.env ve
 * testnet.contracts.json'a yazar. Var olan anahtarları korur (idempotent).
 *
 *   pnpm --filter @haze/scripts keys
 */
import { Keypair } from "@stellar/stellar-sdk";
import { API_ENV_PATH, friendbot, readConfig, readEnvFile, writeConfig, writeEnvFile } from "../lib/common.ts";

const NAMES = ["SPONSOR", "OPERATOR", "ISSUER", "TREASURY", "SETTLEMENT", "ORACLE_ADMIN", "DEMO_USER", "BLEND_ADMIN"] as const;

const env = readEnvFile();
const keys: Record<string, Keypair> = {};
for (const n of NAMES) {
  const k = `${n}_SECRET`;
  keys[n] = env[k] ? Keypair.fromSecret(env[k]!) : Keypair.random();
  console.log(`${n.padEnd(13)} ${keys[n]!.publicKey()}${env[k] ? "" : "  (yeni)"}`);
}

console.log("\nFriendbot…");
for (const n of NAMES) await friendbot(keys[n]!.publicKey());

writeEnvFile(
  Object.fromEntries(NAMES.map((n) => [`${n}_SECRET`, keys[n]!.secret()])),
  API_ENV_PATH,
);

const cfg = readConfig();
cfg.accounts.sponsor = keys.SPONSOR!.publicKey();
cfg.accounts.operator = keys.OPERATOR!.publicKey();
cfg.accounts.issuer = keys.ISSUER!.publicKey();
cfg.accounts.distributor = keys.TREASURY!.publicKey();
cfg.accounts.treasury = keys.TREASURY!.publicKey();
cfg.accounts.settlement = keys.SETTLEMENT!.publicKey();
cfg.accounts.oracleAdmin = keys.ORACLE_ADMIN!.publicKey();
writeConfig(cfg);

console.log(`
Sonraki adımlar:
  1. Treasury'ye testnet USDC: https://faucet.circle.com (Stellar testnet, adres: ${keys.TREASURY!.publicKey()})
     ya da: pnpm --filter @haze/scripts fund-usdc   (mock anchor'dan döngüyle)
  2. pnpm --filter @haze/scripts assets      (hUSDY/hXAU/hTRY ihracı + SAC)
  3. pnpm --filter @haze/scripts haze:deploy (kontratlar)
  4. pnpm --filter @haze/scripts blend:deploy ya da HazeCredit modu
  5. pnpm --filter @haze/scripts amm         (AMM havuzları)
  6. pnpm --filter @haze/scripts demo-user   (demo kullanıcı + kart)
`);
