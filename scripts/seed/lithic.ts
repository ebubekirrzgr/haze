/**
 * Lithic sandbox kaydı: ASA webhook'u + transaction olay aboneliği için PUBLIC_URL'yi yazar, gizli anahtarları
 * services/api/.env'e kaydeder (LITHIC_WEBHOOK_SECRET, LITHIC_EVENT_SECRET, PUBLIC_URL, VERIFY_ASA_HMAC=true).
 * Tünel adresi (cloudflared quick tunnel) her başlatmada değişir; her demo öncesi bir kez koşulur.
 *
 *   pnpm --filter @haze/scripts lithic https://xxxx.trycloudflare.com
 * Gerekli: .env içinde LITHIC_API_KEY.
 */
import { API_ENV_PATH, readEnvFile, writeEnvFile } from "../lib/common.ts";

const [publicUrl] = process.argv.slice(2);
if (!publicUrl?.startsWith("https://")) throw new Error("kullanım: lithic <https://public-url>");
const env = readEnvFile();
const key = env.LITHIC_API_KEY;
if (!key) throw new Error("LITHIC_API_KEY yok (services/api/.env)");
const base = env.LITHIC_BASE_URL ?? "https://sandbox.lithic.com/v1";
const DESC = "haze transaction webhook";

async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
  const r = await fetch(`${base}${path}`, { method, headers: { Authorization: key!, "content-type": "application/json", accept: "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`Lithic ${method} ${path} ${r.status}: ${await r.text()}`);
  return r.json() as Promise<T>;
}

// 1) ASA
await call("/auth_stream", "POST", { webhook_url: `${publicUrl}/card/asa` });
const asa = await call<{ secret: string }>("/auth_stream/secret", "GET");
console.log(`✓ ASA → ${publicUrl}/card/asa`);

// 2) transaction olayları (var olan aboneliği güncelle, yoksa oluştur)
const list = await call<{ data: { token: string; description?: string; url: string }[] }>("/event_subscriptions?page_size=100", "GET");
const existing = list.data.find((s) => s.description === DESC);
const sub: { token: string } = existing
  ? (await call(`/event_subscriptions/${existing.token}`, "PATCH", { url: `${publicUrl}/card/webhook`, event_types: ["card_transaction.updated"], description: DESC }), existing)
  : await call(`/event_subscriptions`, "POST", { url: `${publicUrl}/card/webhook`, event_types: ["card_transaction.updated"], description: DESC });
const ev = await call<{ secret: string }>(`/event_subscriptions/${sub.token}/secret`, "GET");
console.log(`✓ card_transaction.updated → ${publicUrl}/card/webhook (${sub.token})`);

writeEnvFile({ PUBLIC_URL: publicUrl, LITHIC_WEBHOOK_SECRET: asa.secret, LITHIC_EVENT_SECRET: ev.secret, VERIFY_ASA_HMAC: "true" }, API_ENV_PATH);
console.log(`✓ ${API_ENV_PATH} güncellendi (imza doğrulaması açık). haze-api'yi yeniden başlat.`);
