/**
 * Lithic sandbox istemcisi (kart oluşturma, simülasyon) ve ASA HMAC doğrulaması.
 * Yalnızca fetch; SDK bağımlılığı yok. Kaynak: Lithic Auth Stream Access + simülasyon dokümanları.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface LithicCard {
  token: string;
  last_four: string;
  pan?: string;
  exp_month?: string;
  exp_year?: string;
  cvv?: string;
  state: string;
  type: string;
}

/** ASA isteği (Lithic → biz). Alan adları Lithic'in gönderdiğiyle aynı; haze-terminal aynı şemayı üretir. */
export interface AsaRequest {
  token: string;
  card_token: string;
  /** minor units (USD sent) */
  amount: number;
  status?: string;
  merchant: {
    descriptor: string;
    mcc?: string;
    country?: string;
    city?: string;
    acceptor_id?: string;
  };
  merchant_currency?: string;
  merchant_amount?: number;
  /** haze-terminal ekler: TL tutar gösterimi için */
  haze_try_amount?: string;
}

/** Lithic ASA isteği ham yükü: kart token'ı `card.token` içinde gelir; haze-terminal ise düz `card_token` gönderir. */
export interface LithicAsaRaw extends Partial<AsaRequest> {
  card?: { token?: string; last_four?: string };
  merchant?: AsaRequest["merchant"];
  /** Lithic: işlem tutarları; merchant.currency işlemin yapıldığı para birimi (ör. TRY), amount o birimin en küçük birimi */
  amounts?: { merchant?: { amount?: number; currency?: string }; cardholder?: { amount?: number; currency?: string } };
}

/** Lithic/terminal yükünü tek şemaya indirger. */
export function normalizeAsaRequest(raw: LithicAsaRaw): { req: AsaRequest; fromLithic: boolean } {
  const fromLithic = !!raw.card?.token && !raw.card_token;
  return {
    fromLithic,
    req: {
      ...(raw as AsaRequest),
      card_token: raw.card_token ?? raw.card?.token ?? "",
      merchant: raw.merchant ?? { descriptor: "Unknown merchant" },
      merchant_currency: raw.amounts?.merchant?.currency ?? raw.merchant_currency,
      merchant_amount: raw.amounts?.merchant?.amount ?? raw.merchant_amount,
    },
  };
}

/**
 * Lithic yalnızca belirli `result` değerlerini kabul eder (APPROVED, INSUFFICIENT_FUNDS, CARD_PAUSED, VELOCITY_EXCEEDED, …);
 * "DECLINED" ya da ek alanlar (decline_reason, haze, balance) MALFORMED_ASA_RESPONSE ile reddedilir.
 */
export function toLithicAsaResponse(res: AsaResponse): { result: string } {
  if (res.result === "APPROVED") return { result: "APPROVED" };
  const map: Record<string, string> = {
    CARD_FROZEN: "CARD_PAUSED",
    DAILY_LIMIT_EXCEEDED: "VELOCITY_EXCEEDED",
    INSUFFICIENT_COLLATERAL: "INSUFFICIENT_FUNDS",
    NO_COLLATERAL: "INSUFFICIENT_FUNDS",
    UNKNOWN_CARD: "INSUFFICIENT_FUNDS",
    DUPLICATE_AUTHORIZATION: "INSUFFICIENT_FUNDS",
  };
  return { result: map[res.decline_reason ?? ""] ?? "INSUFFICIENT_FUNDS" };
}

export interface AsaResponse {
  result: "APPROVED" | "DECLINED";
  decline_reason?: string;
  balance?: { amount: number; available: number };
  /** Haze'e özgü ek bilgi (Lithic yok sayar) */
  haze?: Record<string, unknown>;
}

export class LithicClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  private async call<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: this.apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Lithic ${method} ${path} ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  createVirtualCard(memo: string): Promise<LithicCard> {
    return this.call<LithicCard>("/cards", { type: "VIRTUAL", memo, state: "OPEN" });
  }
  getCard(token: string): Promise<LithicCard> {
    return this.call<LithicCard>(`/cards/${token}`, undefined, "GET");
  }
  /** Sandbox: yetkilendirme simülasyonu (USD sent) */
  simulateAuthorize(params: { pan: string; amount: number; descriptor: string; mcc?: string; merchant_currency?: string; merchant_amount?: number }) {
    return this.call<{ token: string; debugging_request_id: string }>("/simulate/authorize", params);
  }
  simulateClearing(token: string, amount?: number) {
    return this.call<{ debugging_request_id: string }>("/simulate/clearing", amount != null ? { token, amount } : { token });
  }
  simulateVoid(token: string, amount?: number) {
    return this.call<{ debugging_request_id: string }>("/simulate/void", amount != null ? { token, amount } : { token });
  }
  /** ASA kaydı: Lithic isteği bu URL'ye gönderir */
  enrollAsa(webhookUrl: string) {
    return this.call<unknown>("/auth_stream", { webhook_url: webhookUrl });
  }
  getAsaSecret() {
    return this.call<{ secret: string }>("/auth_stream/secret", undefined, "GET");
  }
}

/**
 * Lithic webhook imzası (ASA ve Events aynı yöntem: Standard Webhooks / Svix).
 *   webhook-signature = "v1,base64(HMAC-SHA256(base64decode(secret sans "whsec_"), `${webhook-id}.${webhook-timestamp}.${rawBody}`))"
 * Birden fazla imza boşlukla ayrılmış gelebilir (anahtar rotasyonu); biri eşleşirse geçerli. Zaman damgası ±5 dk.
 */
export function verifyLithicWebhook(
  secret: string,
  rawBody: string,
  headers: { id?: string; timestamp?: string; signature?: string },
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${rawBody}`).digest();
  for (const part of headers.signature.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    const given = Buffer.from(sig, "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

/** Hono/İstek başlıklarından imza üçlüsünü toplar. */
export function webhookHeaders(get: (name: string) => string | undefined) {
  return { id: get("webhook-id"), timestamp: get("webhook-timestamp"), signature: get("webhook-signature") };
}
