/**
 * Adım 2 — varlıklar: hUSDY, hXAU, hTRY'yi issuer'dan treasury'ye bas; her biri için SAC deploy et;
 * USDC SAC adresini de yaz. İhraççıda AUTH bayrağı yok (path payment serbest geçsin).
 *
 *   pnpm --filter @haze/scripts assets
 * Gerekli: stellar-cli (SAC deploy için).
 */
import { Asset, Operation } from "@stellar/stellar-sdk";
import { ensureTrustline, hasStellarCli, keyFromEnv, readConfig, stellar, submitClassic, writeConfig } from "../lib/common.ts";

if (!hasStellarCli()) throw new Error("stellar-cli gerekli: cargo install --locked stellar-cli  (ya da brew install stellar-cli)");

const cfg = readConfig();
const issuer = keyFromEnv("ISSUER_SECRET");
const treasury = keyFromEnv("TREASURY_SECRET");

const MINT: Record<"hUSDY" | "hXAU" | "hTRY", string> = {
  hUSDY: "1000000",
  hXAU: "1000",
  hTRY: "50000000",
};

for (const code of ["hUSDY", "hXAU", "hTRY"] as const) {
  const asset = new Asset(code, issuer.publicKey());
  cfg.assets[code].issuer = issuer.publicKey();
  await ensureTrustline(cfg, treasury, asset);
  const hash = await submitClassic(cfg, issuer, [Operation.payment({ destination: treasury.publicKey(), asset, amount: MINT[code] })]);
  console.log(`✓ ${code}: ${MINT[code]} → treasury (${hash.slice(0, 8)}…)`);
}

// SAC deploy (idempotent: zaten varsa id'yi hesapla)
const netArgs = ["--network", "testnet"];
for (const code of ["USDC", "hUSDY", "hXAU", "hTRY"] as const) {
  const assetStr = `${cfg.assets[code].code}:${cfg.assets[code].issuer}`;
  let sac: string;
  try {
    sac = stellar(["contract", "asset", "deploy", "--asset", assetStr, "--source-account", issuer.secret(), ...netArgs]);
  } catch {
    sac = stellar(["contract", "id", "asset", "--asset", assetStr, ...netArgs], { quiet: true });
    console.log(`  ${code} SAC zaten var`);
  }
  cfg.assets[code].sac = sac.split("\n").pop()!.trim();
  console.log(`✓ ${code} SAC ${cfg.assets[code].sac}`);
}
writeConfig(cfg);
