/**
 * Script yardımcıları: config okuma/yazma, .env, friendbot, Horizon işlemleri, stellar-cli çağrısı.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Asset, BASE_FEE, Horizon, Keypair, Operation, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import type { HazeConfig } from "@haze/stellar";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const CONFIG_PATH = resolve(ROOT, "testnet.contracts.json");
export const API_ENV_PATH = resolve(ROOT, "services/api/.env");

export function readConfig(): HazeConfig {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as HazeConfig;
}
export function writeConfig(cfg: HazeConfig) {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
  console.log(`✓ testnet.contracts.json güncellendi`);
}

/** services/api/.env dosyasını anahtar → değer olarak oku */
export function readEnvFile(path = API_ENV_PATH): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}
export function writeEnvFile(vals: Record<string, string>, path = API_ENV_PATH) {
  const existing = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  const seen = new Set<string>();
  const lines = existing.map((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (m && vals[m[1]!] !== undefined) {
      seen.add(m[1]!);
      return `${m[1]}=${vals[m[1]!]}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(vals)) if (!seen.has(k)) lines.push(`${k}=${v}`);
  writeFileSync(path, lines.join("\n").replace(/\n+$/, "") + "\n");
  console.log(`✓ ${path} güncellendi`);
}

export function keyFromEnv(name: string): Keypair {
  const env = { ...readEnvFile(), ...process.env } as Record<string, string>;
  const v = env[name];
  if (!v) throw new Error(`${name} bulunamadı (services/api/.env). Önce: pnpm --filter @haze/scripts keys`);
  return Keypair.fromSecret(v);
}

export async function friendbot(pub: string) {
  const r = await fetch(`https://friendbot.stellar.org/?addr=${pub}`);
  if (!r.ok && r.status !== 400) throw new Error(`friendbot ${pub}: ${r.status} ${await r.text()}`);
  console.log(`  friendbot ${pub.slice(0, 6)}… ${r.ok ? "ok" : "zaten fonlu"}`);
}

export function horizon(cfg: HazeConfig) {
  return new Horizon.Server(cfg.horizonUrl);
}

/** Klasik işlemi kur, imzala, gönder (retry'lı) */
export async function submitClassic(cfg: HazeConfig, source: Keypair, ops: ReturnType<typeof Operation.payment>[], signers: Keypair[] = [], memo?: import("@stellar/stellar-sdk").Memo) {
  const server = horizon(cfg);
  const account = await server.loadAccount(source.publicKey());
  const b = new TransactionBuilder(account, { fee: (Number(BASE_FEE) * 50).toString(), networkPassphrase: cfg.networkPassphrase });
  for (const op of ops) b.addOperation(op);
  if (memo) b.addMemo(memo);
  const tx = b.setTimeout(120).build();
  tx.sign(source, ...signers.filter((k) => k.publicKey() !== source.publicKey()));
  try {
    const res = await server.submitTransaction(tx);
    return res.hash;
  } catch (e) {
    const err = e as { response?: { data?: { extras?: { result_codes?: unknown } } } };
    throw new Error(`submit failed: ${JSON.stringify(err.response?.data?.extras?.result_codes ?? (e instanceof Error ? e.message : e))}`);
  }
}

export function assetOf(code: string, issuer: string): Asset {
  return new Asset(code, issuer);
}

/** stellar-cli çağır (stdout döner) */
export function stellar(args: string[], opts: { env?: Record<string, string>; quiet?: boolean } = {}): string {
  const bin = process.env.STELLAR_CLI ?? "stellar";
  if (!opts.quiet) console.log(`  $ stellar ${args.join(" ")}`);
  const out = execFileSync(bin, args, { encoding: "utf8", env: { ...process.env, ...opts.env }, stdio: ["ignore", "pipe", "inherit"] });
  return out.trim();
}

export function hasStellarCli(): boolean {
  try {
    execFileSync(process.env.STELLAR_CLI ?? "stellar", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export async function ensureTrustline(cfg: HazeConfig, account: Keypair, asset: Asset) {
  const server = horizon(cfg);
  const acc = await server.loadAccount(account.publicKey());
  const has = acc.balances.some((b) => b.asset_type !== "native" && (b as Horizon.HorizonApi.BalanceLineAsset).asset_code === asset.getCode() && (b as Horizon.HorizonApi.BalanceLineAsset).asset_issuer === asset.getIssuer());
  if (has) return;
  await submitClassic(cfg, account, [Operation.changeTrust({ asset })]);
  console.log(`  trustline ${asset.getCode()} → ${account.publicKey().slice(0, 6)}…`);
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export type { Transaction };
