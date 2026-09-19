"use client";
/**
 * Nakde çevir: "2.000 TL → kayıtlı IBAN, kaynak: altın / borç".
 *  Teminattan çek: 1) vault.withdraw(RWA) 2) SEP-38 teklif + SEP-6 withdraw-exchange 3) hazineye memo'lu PathPaymentStrictReceive (RWA → tam USDC)
 *  Satmadan çek:   1) vault.borrow(USDC)   2) SEP-38 + SEP-6                             3) hazineye memo'lu USDC ödemesi
 * Anchor limiti aşılırsa tutar parçalanır (tek ilerleme çubuğu).
 */
import { useState } from "react";
import { ASSET_META, RWA_CODES, splitTry, toStroops, type RwaCode } from "@haze/stellar/browser";
import { Adimlar, Sahne, Ust } from "@/components/ui.tsx";
import { api } from "@/lib/api.ts";
import { useChain, useSession } from "@/lib/session.tsx";
import { fmtNum, fmtTry, fmtUsd } from "@/lib/format.ts";
import { useLang } from "@/lib/i18n.tsx";

type Source = RwaCode | "borrow";
const SOURCE_LABEL_TR: Record<RwaCode, string> = { hXAU: "Altından (hXAU)", hUSDY: "Bonodan (hUSDY)", hNVDA: "NVIDIA'dan (hNVDA)", hSHEL: "Shell'den (hSHEL)", hBMW: "BMW'den (hBMW)" };

export default function Nakit() {
  const s = useSession();
  const { ensure } = useChain();
  const { t, lang, assetName } = useLang();
  const [amountTry, setAmountTry] = useState("500");
  const [source, setSource] = useState<Source>("hXAU");
  const [steps, setSteps] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tryOut: number; usdc: number; status: string }[]>([]);

  const usdTry = s.prices?.USDTRY ?? 0;
  const amt = Number(amountTry.replace(",", "."));
  const estUsdc = usdTry ? amt / usdTry : 0;
  const price = source === "borrow" ? 1 : s.prices?.[source] ?? ASSET_META[source].baseUsd;
  const sources: Source[] = [...RWA_CODES.filter((c) => s.config?.assets?.[c]?.issuer), "borrow"];
  const collateral = s.credit?.reserves.find((r) => r.code === (source === "borrow" ? "USDC" : source));
  const limit = s.credit?.credit.availableLimitFloat ?? 0;

  const run = async () => {
    if (!s.vault) return;
    setBusy(true);
    setError(undefined);
    setResult([]);
    const parts = splitTry(amt);
    const labels = [t("genel.passkeyImzala"), ...parts.flatMap((p, i) => [`${i + 1}. ${source === "borrow" ? "vault.borrow" : `vault.withdraw ${source}`} (${fmtTry(p)})`, `${i + 1}. ${t("nakit.adimTeklif")}`, `${i + 1}. ${source === "borrow" ? t("nakit.adimOdeme") : "PathPaymentStrictReceive → USDC"} (memo)`, `${i + 1}. ${t("nakit.adimAnchor")}`])];
    setSteps(labels);
    setStep(0);
    let cur = 0;
    const next = () => setStep(++cur);
    try {
      const ch = await ensure();
      next();
      for (const p of parts) {
        // 1) kaynak
        const instr = await api.cashoutStart(ch.pub, p); // teklifi önce al ki gerekli USDC belli olsun
        const usdc = toStroops(Number(instr.usdcAmount).toFixed(7));
        if (source === "borrow") {
          await ch.borrow(s.vault, usdc);
        } else {
          // Çekilecek miktar DEX yolundan: AMM fiyatı oracle'dan sapmış olabilir; %2 pay, artan cüzdanda kalır
          const est = await ch.sendAmountFor(source, usdc);
          const need = (est * 102n) / 100n + 1n;
          await ch.withdraw(s.vault, source, need);
        }
        next();
        next(); // teklif zaten alındı
        // 3) hazineye ödeme
        if (source === "borrow") await ch.payAnchor(usdc, instr.treasury, instr.memo);
        else await ch.pathPayToAnchor(source, usdc, instr.treasury, instr.memo);
        next();
        // 4) durum
        let st = "pending";
        for (let i = 0; i < 20; i++) {
          const r = await api.cashoutStatus(ch.pub, instr.id);
          st = r.status;
          if (st === "completed" || st === "error") break;
          await new Promise((r) => setTimeout(r, 2000));
        }
        next();
        setResult((x) => [...x, { tryOut: Number(instr.tryAmount), usdc: Number(instr.usdcAmount), status: st }]);
      }
      await s.refresh();
      s.toast({ title: t("nakit.cevrildi"), body: t("nakit.ibanSimule", { tutar: fmtTry(amt) }) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sahne>
      <Ust title={t("nakit.baslik")} back="/" />
      <div style={{ paddingTop: 14 }}>
        <div className="disp" style={{ fontSize: 22, lineHeight: 1.3 }}>{t("nakit.slogan")}</div>
        <div className="ikincil" style={{ fontSize: 14, marginTop: 4 }}>{t("nakit.aciklama")}</div>
      </div>

      <div className="blok cam kart">
        <div className="etiket" style={{ fontSize: 12 }}>{t("nakit.tutar")}</div>
        <input className="girdi girdi-buyuk num" style={{ marginTop: 8 }} inputMode="decimal" value={amountTry} onChange={(e) => setAmountTry(e.target.value)} />
        <div className="cipler" style={{ marginTop: 10 }}>
          {[500, 1000, 2000].map((v) => <button key={v} className={`cip${amt === v ? " aktif" : ""}`} onClick={() => setAmountTry(String(v))}>{fmtTry(v)}</button>)}
        </div>
        <div className="satir" style={{ marginTop: 12, fontSize: 14 }}><span className="ikincil">{t("nakit.kur")}</span><span className="num">{usdTry ? `1 USDC = ${fmtTry(usdTry, 2)}` : "…"}</span></div>
        <div className="satir" style={{ fontSize: 14 }}><span className="ikincil">{t("nakit.gerekliUsdc")}</span><span className="num">≈ {fmtUsd(estUsdc)}</span></div>
      </div>

      <div className="blok cam kart">
        <div className="etiket" style={{ fontSize: 12 }}>{t("nakit.kaynak")}</div>
        <div className="cipler" style={{ marginTop: 8 }}>
          {sources.map((k) => (
            <button key={k} className={`cip${source === k ? " aktif" : ""}`} onClick={() => setSource(k)}>{k === "borrow" ? t("nakit.borcla") : lang === "tr" ? SOURCE_LABEL_TR[k] : t("nakit.kaynakEtiket", { ad: assetName(k), code: k })}</button>
          ))}
        </div>
        {source === "borrow" ? (
          <div className="ikincil" style={{ fontSize: 13.5, marginTop: 10 }}>
            {t("nakit.borcNot")} <b className="num" style={{ color: "var(--sepya)" }}>{fmtUsd(limit)}</b>.
          </div>
        ) : (
          <div className="ikincil" style={{ fontSize: 13.5, marginTop: 10 }}>
            {t("nakit.teminatta")} <b className="num" style={{ color: "var(--sepya)" }}>{fmtNum(collateral?.collateralFloat ?? 0, ASSET_META[source].displayDecimals)} {source}</b>. {t("nakit.gerekli")}: ≈ {fmtNum(price ? estUsdc / price : 0, 4)} {source}. {t("nakit.dexNot", { code: source })}
          </div>
        )}
        <div className="satir" style={{ fontSize: 14, marginTop: 10 }}><span className="ikincil">{t("nakit.hedef")}</span><span>{t("nakit.iban")}</span></div>
      </div>

      <button className="btn btn-altin blok" disabled={busy || !(amt >= 50) || !s.vault || (source === "borrow" && estUsdc > limit)} onClick={run}>{t("nakit.cekBtn", { tutar: fmtTry(amt || 0) })}</button>
      {steps.length > 0 && <Adimlar steps={steps} current={step} error={error} />}
      {result.length > 0 && (
        <div className="cam kart" style={{ marginTop: 12 }}>
          {result.map((r, i) => <div key={i} className="satir" style={{ fontSize: 14 }}><span>{fmtUsd(r.usdc)} → {fmtTry(r.tryOut, 2)}</span><span className={r.status === "completed" ? "zeytin" : "ikincil"}>{r.status}</span></div>)}
        </div>
      )}
    </Sahne>
  );
}
