export const fmtUsd = (v: number, digits = 2) =>
  "$" + v.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtTry = (v: number, digits = 0) =>
  "₺" + v.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtNum = (v: number, digits = 2) => v.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtPct = (v: number, digits = 1) => (v >= 0 ? "+" : "") + "%" + (v * 100).toLocaleString("tr-TR", { maximumFractionDigits: digits });
export const short = (s: string, n = 4) => (s ? `${s.slice(0, n)}…${s.slice(-n)}` : "");
export const expertTx = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;
export const expertAcc = (id: string) => `https://stellar.expert/explorer/testnet/${id.startsWith("C") ? "contract" : "account"}/${id}`;
export const ago = (ts: number) => {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return "az önce";
  if (d < 3600) return `${Math.floor(d / 60)} dk önce`;
  if (d < 86400) return `${Math.floor(d / 3600)} sa önce`;
  return new Date(ts).toLocaleDateString("tr-TR");
};
export const labelHold = (s: string): string =>
  ({ PENDING: "onaylandı", BORROWED: "borç açıldı", CLEARED: "kapandı", REFUNDED: "iade", FAILED: "hata", DECLINED: "reddedildi" } as Record<string, string>)[s] ?? s;
