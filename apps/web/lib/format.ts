/** Sayı biçimi yerel ayarı; LangProvider dil değişince günceller (tr-TR: 1.234,56 · en-US: 1,234.56). */
let locale = "tr-TR";
export const setFormatLocale = (l: string) => {
  locale = l;
};
export const fmtUsd = (v: number, digits = 2) =>
  "$" + v.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtTry = (v: number, digits = 0) =>
  "₺" + v.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtNum = (v: number, digits = 2) => v.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtPct = (v: number, digits = 1) => {
  const n = (v * 100).toLocaleString(locale, { maximumFractionDigits: digits });
  const sign = v >= 0 ? "+" : "";
  if (locale.startsWith("tr")) return `${sign}%${n}`; // Türkçede işaret önde: %5,2
  if (locale.startsWith("es")) return `${sign}${n} %`; // İspanyolcada boşluklu: 5,2 %
  return `${sign}${n}%`;
};
/** Kart borcu etiketi: fiat borçta "−450,00 hTRY", USDC'de "−$9,18" */
export const fmtDebt = (h: { usdc_amount: string; debt_asset?: string; debt_amount?: string }) =>
  h.debt_asset && h.debt_asset !== "USDC" && h.debt_amount ? `−${fmtNum(Number(h.debt_amount) / 1e7)} ${h.debt_asset}` : `−${fmtUsd(Number(h.usdc_amount) / 1e7)}`;
export const short = (s: string, n = 4) => (s ? `${s.slice(0, n)}…${s.slice(-n)}` : "");
export const expertTx = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;
export const expertAcc = (id: string) => `https://stellar.expert/explorer/testnet/${id.startsWith("C") ? "contract" : "account"}/${id}`;

