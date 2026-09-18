/**
 * blend:deploy sonrası: blend-utils adres defterinden (haze.contracts.json) adresleri
 * testnet.contracts.json'a yazar, modu "blend" yapar ve VaultFactory.set_pool çağırır.
 *   node --experimental-transform-types scripts/blend/apply.ts <path/to/haze.contracts.json>
 */
import { readFileSync } from "node:fs";
import { keyFromEnv, readConfig, stellar, writeConfig } from "../lib/common.ts";

const [bookPath] = process.argv.slice(2);
if (!bookPath) throw new Error("adres defteri yolu gerekli");
const book = JSON.parse(readFileSync(bookPath, "utf8")) as { ids: Record<string, string> };
const cfg = readConfig();
cfg.blend = {
  mode: "blend",
  poolFactory: book.ids.poolFactoryV2 ?? "",
  backstop: book.ids.backstopV2 ?? "",
  emitter: book.ids.emitter ?? "",
  blndToken: book.ids.BLND ?? "",
  lpToken: book.ids.comet ?? "",
  pool: book.ids.Haze ?? "",
  oracle: book.ids.oraclemock ?? "",
};
if (!cfg.blend.pool) throw new Error("Haze havuzu adres defterinde yok");
writeConfig(cfg);

if (cfg.haze.vaultFactory) {
  const sponsor = keyFromEnv("SPONSOR_SECRET");
  stellar(["contract", "invoke", "--id", cfg.haze.vaultFactory, "--source-account", sponsor.secret(), "--network", "testnet", "--", "set_pool", "--pool", cfg.blend.pool]);
  console.log(`✓ VaultFactory.pool → Blend ${cfg.blend.pool}`);
}
console.log("\nNot: Blend modunda fiyat botu blend-utils oraclemock'una BLEND_ADMIN ile set_price_stable yazar (haze-api bunu mode'a göre seçer).");
