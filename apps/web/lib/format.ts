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
export const fmtPct = (v: number, digits = 1) => (v >= 0 ? "+" : "") + (locale.startsWith("tr") ? "%" : "") + (v * 100).toLocaleString(locale, { maximumFractionDigits: digits }) + (locale.startsWith("tr") ? "" : "%");
export const short = (s: string, n = 4) => (s ? `${s.slice(0, n)}…${s.slice(-n)}` : "");
export const expertTx = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;
export const expertAcc = (id: string) => `https://stellar.expert/explorer/testnet/${id.startsWith("C") ? "contract" : "account"}/${id}`;

