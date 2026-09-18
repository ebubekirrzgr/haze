/**
 * Tutar yardımcıları. Zincirde her şey 7 ondalıklı bigint (stroop benzeri) olarak dolaşır;
 * Horizon/klasik işlemler ise "123.4567890" biçiminde string ister.
 */
export const SCALAR_7 = 10_000_000n;

/** "12.5" → 125000000n */
export function toStroops(decimal: string | number): bigint {
  const s = typeof decimal === "number" ? decimal.toFixed(7) : decimal.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`bad amount: ${decimal}`);
  const neg = s.startsWith("-");
  const [intPart, fracPart = ""] = s.replace("-", "").split(".");
  const frac = (fracPart + "0000000").slice(0, 7);
  const v = BigInt(intPart) * SCALAR_7 + BigInt(frac);
  return neg ? -v : v;
}

/** 125000000n → "12.5000000" (Horizon formatı) */
export function fromStroops(v: bigint): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const i = a / SCALAR_7;
  const f = (a % SCALAR_7).toString().padStart(7, "0");
  return `${neg ? "-" : ""}${i}.${f}`;
}

/** bigint 7-ondalık → JS number (görüntüleme için) */
export function toFloat(v: bigint): number {
  return Number(v) / 1e7;
}

/** USD sent (Lithic) → USDC stroop. 1 sent = 100.000 stroop */
export function usdCentsToUsdc(cents: number): bigint {
  return BigInt(Math.round(cents)) * 100_000n;
}

/** a * b / SCALAR_7 */
export function mul7(a: bigint, b: bigint): bigint {
  return (a * b) / SCALAR_7;
}

/** a * SCALAR_7 / b */
export function div7(a: bigint, b: bigint): bigint {
  return (a * SCALAR_7) / b;
}

/** 0.95 → 9500000n */
export function factor7(f: number): bigint {
  return BigInt(Math.round(f * 1e7));
}
