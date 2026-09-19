/**
 * Adım 3 — Haze kontratları: wasm build → haze_vault upload (hash) → MockOracle + HazeCredit deploy
 * (yedek havuz; rezervler + başlangıç fiyatları) → VaultFactory deploy.
 * Havuz modu: testnet.contracts.json blend.mode ("blend" ise Blend havuzu, yoksa HazeCredit).
 * Blend henüz kurulmadıysa factory HazeCredit'e işaret eder; blend:deploy sonrası `set_pool` ile değişir.
 *
 *   pnpm --filter @haze/scripts haze:deploy [-- --skip-build]
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { RESERVE_CODES, DEMO_RESERVES, baseUsdOf } from "@haze/stellar";
import { ROOT, hasStellarCli, keyFromEnv, readConfig, stellar, writeConfig } from "../lib/common.ts";

if (!hasStellarCli()) throw new Error("stellar-cli gerekli");
const skipBuild = process.argv.includes("--skip-build");
const cfg = readConfig();
if (!cfg.assets.USDC.sac) throw new Error("önce: pnpm --filter @haze/scripts assets");

const oracleAdmin = keyFromEnv("ORACLE_ADMIN_SECRET");
const operator = keyFromEnv("OPERATOR_SECRET");
const settlement = keyFromEnv("SETTLEMENT_SECRET");
const sponsor = keyFromEnv("SPONSOR_SECRET");
const net = ["--network", "testnet"];
const src = (k: { secret(): string }) => ["--source-account", k.secret()];

const wasmDir = resolve(ROOT, "target/wasm32v1-none/release");
if (!skipBuild) {
  console.log("stellar contract build (wasm)…");
  execFileSync("stellar", ["contract", "build"], { cwd: ROOT, stdio: "inherit" });
}
for (const f of ["haze_vault", "vault_factory", "haze_credit", "mock_oracle"]) {
  if (!existsSync(resolve(wasmDir, `${f}.wasm`))) throw new Error(`${f}.wasm yok — rustup target add wasm32v1-none && stellar contract build`);
}

// 1) haze_vault wasm upload
const vaultHash = stellar(["contract", "upload", "--wasm", resolve(wasmDir, "haze_vault.wasm"), ...src(sponsor), ...net]).split("\n").pop()!.trim();
cfg.haze.vaultWasmHash = vaultHash;
console.log(`✓ haze_vault wasm ${vaultHash}`);

// 2) MockOracle
if (!cfg.haze.mockOracle) {
  cfg.haze.mockOracle = stellar(["contract", "deploy", "--wasm", resolve(wasmDir, "mock_oracle.wasm"), ...src(oracleAdmin), ...net, "--", "--admin", oracleAdmin.publicKey()]).split("\n").pop()!.trim();
}
console.log(`✓ MockOracle ${cfg.haze.mockOracle}`);
for (const c of RESERVE_CODES) if (!cfg.assets[c]?.sac) throw new Error(`${c} SAC yok — önce: pnpm --filter @haze/scripts assets`);
const prices: Record<string, string> = Object.fromEntries(RESERVE_CODES.map((c) => [c, String(Math.round(baseUsdOf(c, process.env) * 1e7))]));
const assetsJson = JSON.stringify(RESERVE_CODES.map((c) => ({ Stellar: cfg.assets[c].sac })));
const pricesJson = JSON.stringify(RESERVE_CODES.map((c) => prices[c]));
stellar(["contract", "invoke", "--id", cfg.haze.mockOracle, ...src(oracleAdmin), ...net, "--", "set_prices", "--assets", assetsJson, "--prices", pricesJson]);
console.log("✓ oracle başlangıç fiyatları yazıldı");

// 3) HazeCredit (yedek havuz)
if (!cfg.haze.hazeCredit) {
  cfg.haze.hazeCredit = stellar(["contract", "deploy", "--wasm", resolve(wasmDir, "haze_credit.wasm"), ...src(oracleAdmin), ...net, "--", "--admin", oracleAdmin.publicKey(), "--oracle", cfg.haze.mockOracle]).split("\n").pop()!.trim();
  for (const c of RESERVE_CODES) {
    const r = DEMO_RESERVES[c];
    stellar(["contract", "invoke", "--id", cfg.haze.hazeCredit, ...src(oracleAdmin), ...net, "--", "add_reserve", "--asset", cfg.assets[c].sac, "--c_factor", String(Math.round(r.c_factor * 1e7)), "--l_factor", String(Math.round(r.l_factor * 1e7)), "--borrow_rate_bps", c === "USDC" ? "400" : "0"]);
  }
}
console.log(`✓ HazeCredit ${cfg.haze.hazeCredit}`);

// 4) VaultFactory
const pool = cfg.blend.mode === "blend" && cfg.blend.pool ? cfg.blend.pool : cfg.haze.hazeCredit;
if (!cfg.blend.pool) cfg.blend.mode = "hazecredit";
if (!cfg.haze.vaultFactory) {
  cfg.haze.vaultFactory = stellar([
    "contract", "deploy", "--wasm", resolve(wasmDir, "vault_factory.wasm"), ...src(sponsor), ...net, "--",
    "--admin", sponsor.publicKey(),
    "--vault_wasm_hash", vaultHash,
    "--operator", operator.publicKey(),
    "--pool", pool,
    "--usdc", cfg.assets.USDC.sac,
    "--settlement", settlement.publicKey(),
    "--default_daily_limit", String(500 * 1e7),
  ]).split("\n").pop()!.trim();
} else {
  stellar(["contract", "invoke", "--id", cfg.haze.vaultFactory, ...src(sponsor), ...net, "--", "set_vault_wasm_hash", "--hash", vaultHash]);
  stellar(["contract", "invoke", "--id", cfg.haze.vaultFactory, ...src(sponsor), ...net, "--", "set_pool", "--pool", pool]);
}
console.log(`✓ VaultFactory ${cfg.haze.vaultFactory} (pool: ${cfg.blend.mode} ${pool})`);
writeConfig(cfg);

// 5) TypeScript bindings (opsiyonel)
try {
  const out = resolve(ROOT, "packages/bindings");
  for (const [name, id] of [["haze-vault", null], ["vault-factory", cfg.haze.vaultFactory]] as const) {
    const args = ["contract", "bindings", "typescript", "--output-dir", resolve(out, name), "--overwrite", ...net];
    if (id) args.push("--contract-id", id);
    else args.push("--wasm", resolve(wasmDir, "haze_vault.wasm"));
    stellar(args, { quiet: true });
  }
  console.log("✓ bindings → packages/bindings");
} catch (e) {
  console.log("bindings üretilemedi (opsiyonel):", e instanceof Error ? e.message : e);
}
