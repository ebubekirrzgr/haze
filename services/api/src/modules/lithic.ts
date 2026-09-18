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
  simulateAuthorize(params: { pan: string; amount: number; descriptor: string; mcc?: string; merchant_currency?: string }) {
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

/** X-Lithic-HMAC = base64(HMAC-SHA256(secret, rawBody)) */
export function verifyLithicHmac(secret: string, rawBody: string, header: string | undefined): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}
