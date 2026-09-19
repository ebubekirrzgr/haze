/**
 * Adım 2 — varlıklar: ISSUED_CODES (hUSDY, hXAU, hNVDA, hSHEL, hBMW, hTRY) issuer'dan treasury'ye basılır; her biri için
 * SAC deploy edilir; USDC SAC adresi de yazılır. İhraççıda AUTH bayrağı yok (path payment serbest geçsin).
 * İdempotent: issuer'ı zaten yazılı varlık yeniden basılmaz (yeni RWA eklenince yalnızca eksikler ihraç edilir).
 *
 *   pnpm --filter @haze/scripts assets
 * Gerekli: stellar-cli (SAC deploy için).
 */
import { Asset, Operation } from "@stellar/stellar-sdk";
import { ALL_CODES, ASSET_META, ISSUED_CODES } from "@haze/stellar";
import { ensureTrustline, hasStellarCli, keyFromEnv, readConfig, stellar, submitClassic, writeConfig } from "../lib/common.ts";

if (!hasStellarCli()) throw new Error("stellar-cli gerekli: cargo install --locked stellar-cli  (ya da brew install stellar-cli)");

const cfg = readConfig();
const issuer = keyFromEnv("ISSUER_SECRET");
const treasury = keyFromEnv("TREASURY_SECRET");

for (const code of ISSUED_CODES) {
  const asset = new Asset(code, issuer.publicKey());
  if (cfg.assets[code]?.issuer) {
    console.log(`  ${code} zaten ihraç edilmiş`);
    continue;
  }
  cfg.assets[code] = { code, issuer: issuer.publicKey(), sac: "" };
  await ensureTrustline(cfg, treasury, asset);
  const mint = ASSET_META[code].mint;
  const hash = await submitClassic(cfg, issuer, [Operation.payment({ destination: treasury.publicKey(), asset, amount: mint })]);
  console.log(`✓ ${code}: ${mint} → treasury (${hash.slice(0, 8)}…)`);
}

// SAC deploy (idempotent: zaten varsa id'yi hesapla)
const netArgs = ["--network", "testnet"];
for (const code of ALL_CODES) {
  if (cfg.assets[code].sac) {
    console.log(`  ${code} SAC zaten var ${cfg.assets[code].sac}`);
    continue;
  }
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
