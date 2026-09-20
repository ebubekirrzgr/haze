/**
 * Ortam değişkenleri. .env örneği için services/api/.env.example.
 */
import { Keypair } from "@stellar/stellar-sdk";
import type { HazeConfig } from "@haze/stellar";
import { loadConfig } from "@haze/stellar/node";

export interface Env {
  cfg: HazeConfig;
  port: number;
  dbPath: string;
  sponsor: Keypair;
  operator: Keypair;
  /** Kart takas hazinesi (USDC alır; void'de vault'a iade eder) */
  settlement: Keypair;
  /** Blend likiditesi + AMM market maker */
  treasury: Keypair;
  /** Mock oracle admin (fiyat botu) */
  oracleAdmin: Keypair;
  /** Blend modunda blend-utils oraclemock admin'i (= BLEND_ADMIN) */
  blendAdmin?: Keypair;
  lithic: { apiKey: string; webhookSecret: string; eventSecret: string; baseUrl: string; enabled: boolean };
  /** getiri hızlandırma: 1 dakika = kaç gün */
  yieldAccelerationDaysPerMinute: number;
  /** hUSDY yıllık getiri (demo) */
  husdyApy: number;
  /** fiyat botu aralığı (sn) */
  priceIntervalSec: number;
  /** kredi önbelleği (sn) */
  creditCacheSec: number;
  /** ASA HMAC doğrulaması (dev'de kapatılabilir) */
  verifyAsaHmac: boolean;
  publicUrl: string;
  /** yönetim, terminal, fiyat tetikleme uçları için paylaşımlı anahtar (x-haze-key); boşsa kontrol yok (yerel geliştirme) */
  adminKey: string;
}

function kp(name: string, optional = false): Keypair {
  const v = process.env[name];
  if (!v) {
    if (optional) return Keypair.random();
    throw new Error(`env ${name} missing`);
  }
  return Keypair.fromSecret(v);
}

export function loadEnv(): Env {
  const cfg = loadConfig(process.env.HAZE_CONFIG);
  return {
    cfg,
    port: Number(process.env.PORT ?? 8787),
    dbPath: process.env.DB_PATH ?? "haze.db",
    sponsor: kp("SPONSOR_SECRET"),
    operator: kp("OPERATOR_SECRET"),
    settlement: kp("SETTLEMENT_SECRET"),
    treasury: kp("TREASURY_SECRET"),
    oracleAdmin: kp("ORACLE_ADMIN_SECRET"),
    blendAdmin: process.env.BLEND_ADMIN_SECRET ? Keypair.fromSecret(process.env.BLEND_ADMIN_SECRET) : undefined,
    lithic: {
      apiKey: process.env.LITHIC_API_KEY ?? "",
      webhookSecret: process.env.LITHIC_WEBHOOK_SECRET ?? "",
      eventSecret: process.env.LITHIC_EVENT_SECRET ?? "",
      baseUrl: process.env.LITHIC_BASE_URL ?? "https://sandbox.lithic.com/v1",
      enabled: !!process.env.LITHIC_API_KEY,
    },
    yieldAccelerationDaysPerMinute: Number(process.env.YIELD_DAYS_PER_MINUTE ?? 1),
    husdyApy: Number(process.env.HUSDY_APY ?? 0.05),
    priceIntervalSec: Number(process.env.PRICE_INTERVAL_SEC ?? 30),
    creditCacheSec: Number(process.env.CREDIT_CACHE_SEC ?? 10),
    verifyAsaHmac: process.env.VERIFY_ASA_HMAC !== "false",
    adminKey: process.env.API_ADMIN_KEY ?? "",
    publicUrl: process.env.PUBLIC_URL ?? "http://localhost:8787",
  };
}
