/**
 * Yalnızca Node tarafı: testnet.contracts.json yükleyici. Tarayıcı paketi bunu içe almaz.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { HazeConfig } from "./config.ts";

export function loadConfig(path?: string): HazeConfig {
  const p =
    path ??
    process.env.HAZE_CONFIG ??
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../testnet.contracts.json");
  return JSON.parse(readFileSync(p, "utf8")) as HazeConfig;
}
