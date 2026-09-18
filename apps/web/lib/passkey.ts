/**
 * Passkey (WebAuthn + PRF) ile G-hesabı anahtarını şifreleme.
 * PRF çıktısı → HKDF → AES-GCM anahtarı; gizli anahtar yalnızca tarayıcıda, şifreli durur.
 * PRF desteklenmiyorsa (eski tarayıcı) düz saklama + "DEMO MODU" uyarısı.
 */
const STORE = "haze.wallet.v1";
const SALT = new TextEncoder().encode("haze:prf:v1");

export interface StoredWallet {
  publicKey: string;
  mode: "passkey" | "plain";
  credentialId?: string; // base64url
  cipher?: string; // base64
  iv?: string; // base64
  plainSecret?: string;
  vaultAddress?: string;
  createdAt: number;
}

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (b: ArrayBuffer | Uint8Array) => b64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => unb64(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));

export function loadWallet(): StoredWallet | null {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as StoredWallet) : null;
  } catch {
    return null;
  }
}
export function saveWallet(w: StoredWallet) {
  localStorage.setItem(STORE, JSON.stringify(w));
}
export function clearWallet() {
  localStorage.removeItem(STORE);
}

export function passkeySupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;
}

async function aesKeyFromPrf(prf: ArrayBuffer): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", prf, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: SALT, info: new TextEncoder().encode("wallet-key") }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** Yeni passkey oluştur ve PRF ile gizli anahtarı şifrele. PRF yoksa null döner (düz saklama). */
export async function registerPasskey(publicKey: string, secret: string): Promise<StoredWallet | null> {
  if (!passkeySupported()) return null;
  const userId = new TextEncoder().encode(publicKey);
  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: "HAZE", id: location.hostname },
        user: { id: userId, name: `haze:${publicKey.slice(0, 8)}`, displayName: "HAZE" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        extensions: { prf: { eval: { first: SALT } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    if (!cred) return null;
    const ext = cred.getClientExtensionResults() as { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };
    let prf = ext.prf?.results?.first;
    if (!prf) {
      // bazı platformlar PRF'yi yalnızca get() sırasında verir
      prf = await prfFromAssertion(cred.rawId);
    }
    if (!prf) return null;
    const key = await aesKeyFromPrf(prf);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(secret));
    return { publicKey, mode: "passkey", credentialId: b64url(cred.rawId), cipher: b64(cipher), iv: b64(iv), createdAt: Date.now() };
  } catch (e) {
    console.warn("passkey kaydı başarısız, düz saklamaya düşülüyor", e);
    return null;
  }
}

async function prfFromAssertion(credentialId: ArrayBuffer | Uint8Array): Promise<ArrayBuffer | undefined> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: location.hostname,
      allowCredentials: [{ type: "public-key", id: credentialId as BufferSource }],
      userVerification: "required",
      extensions: { prf: { eval: { first: SALT } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  const ext = assertion?.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } } | undefined;
  return ext?.prf?.results?.first;
}

/** Passkey ile kilidi aç: gizli anahtarı döner */
export async function unlockWithPasskey(w: StoredWallet): Promise<string> {
  if (w.mode === "plain") return w.plainSecret!;
  const prf = await prfFromAssertion(unb64url(w.credentialId!));
  if (!prf) throw new Error("Passkey PRF sonucu alınamadı");
  const key = await aesKeyFromPrf(prf);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(w.iv!) }, key, unb64(w.cipher!));
  return new TextDecoder().decode(plain);
}
