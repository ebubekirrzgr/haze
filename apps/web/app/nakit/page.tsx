"use client";
/**
 * Nakde çevir: "2.000 TL → kayıtlı IBAN, kaynak: altın / borç".
 *  Teminattan çek: 1) vault.withdraw(hXAU) 2) SEP-38 teklif + SEP-6 withdraw-exchange 3) hazineye memo'lu PathPaymentStrictReceive (hXAU → tam USDC)
 *  Satmadan çek:   1) vault.borrow(USDC)   2) SEP-38 + SEP-6                             3) hazineye memo'lu USDC ödemesi
 * Anchor limiti aşılırsa tutar parçalanır (tek ilerleme çubuğu).
 */
import { useState } from "react";
import { splitTry, toStroops } from "@haze/stellar/browser";
import { Adimlar, Sahne, Ust } from "@/components/ui.tsx";
import { api } from "@/lib/api.ts";
import { useChain, useSession } from "@/lib/session.tsx";
import { fmtNum, fmtTry, fmtUsd } from "@/lib/format.ts";

type Source = "hXAU" | "hUSDY" | "borrow";

export default function Nakit() {
  const s = useSession();
  const { ensure } = useChain();
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
  const price = source === "hXAU" ? s.prices?.hXAU ?? 0 : source === "hUSDY" ? s.prices?.hUSDY ?? 1 : 1;
  const collateral = s.credit?.reserves.find((r) => r.code === (source === "borrow" ? "USDC" : source));
  const limit = s.credit?.credit.availableLimitFloat ?? 0;

  const run = async () => {
    if (!s.vault) return;
    setBusy(true);
    setError(undefined);
    setResult([]);
    const parts = splitTry(amt);
    const labels = ["Passkey ile imzala", ...parts.flatMap((p, i) => [`${i + 1}. ${source === "borrow" ? "vault.borrow" : `vault.withdraw ${source}`} (${fmtTry(p)})`, `${i + 1}. SEP-38 teklif + SEP-6 withdraw`, `${i + 1}. ${source === "borrow" ? "USDC ödemesi" : "PathPaymentStrictReceive → USDC"} (memo)`, `${i + 1}. Anchor TL gönderdi`])];
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
          const need = (Number(instr.usdcAmount) / price) * 1.01;
          await ch.withdraw(s.vault, source, toStroops(need.toFixed(7)));
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
      s.toast({ title: "Nakde çevrildi", body: `${fmtTry(amt)} → kayıtlı IBAN (simüle)` });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sahne>
      <Ust title="Nakde çevir" back="/" />
      <div style={{ paddingTop: 14 }}>
        <div className="disp" style={{ fontSize: 22, lineHeight: 1.3 }}>TL&apos;ye, satmadan ya da satarak.</div>
        <div className="ikincil" style={{ fontSize: 14, marginTop: 4 }}>Tek ekran: tutar, kaynak, kayıtlı IBAN. Anchor işlem limiti aşılırsa tutar parçalanır.</div>
      </div>

      <div className="blok cam kart">
        <div className="etiket" style={{ fontSize: 12 }}>Tutar</div>
        <input className="girdi girdi-buyuk num" style={{ marginTop: 8 }} inputMode="decimal" value={amountTry} onChange={(e) => setAmountTry(e.target.value)} />
        <div className="cipler" style={{ marginTop: 10 }}>
          {[500, 1000, 2000].map((v) => <button key={v} className={`cip${amt === v ? " aktif" : ""}`} onClick={() => setAmountTry(String(v))}>{fmtTry(v)}</button>)}
        </div>
        <div className="satir" style={{ marginTop: 12, fontSize: 14 }}><span className="ikincil">Kur (SEP-38)</span><span className="num">{usdTry ? `1 USDC = ${fmtTry(usdTry, 2)}` : "…"}</span></div>
        <div className="satir" style={{ fontSize: 14 }}><span className="ikincil">Gerekli USDC</span><span className="num">≈ {fmtUsd(estUsdc)}</span></div>
      </div>

      <div className="blok cam kart">
        <div className="etiket" style={{ fontSize: 12 }}>Kaynak</div>
        <div className="cipler" style={{ marginTop: 8 }}>
          {(["hXAU", "hUSDY", "borrow"] as Source[]).map((k) => (
            <button key={k} className={`cip${source === k ? " aktif" : ""}`} onClick={() => setSource(k)}>{{ hXAU: "Altından (hXAU)", hUSDY: "Bonodan (hUSDY)", borrow: "Satmadan · borçla" }[k]}</button>
          ))}
        </div>
        {source === "borrow" ? (
          <div className="ikincil" style={{ fontSize: 13.5, marginTop: 10 }}>
            Teminata dokunulmaz; vault USDC borç açar ve hesabına gönderir. Kullanılabilir limit <b className="num" style={{ color: "var(--sepya)" }}>{fmtUsd(limit)}</b>.
          </div>
        ) : (
          <div className="ikincil" style={{ fontSize: 13.5, marginTop: 10 }}>
            Teminatta <b className="num" style={{ color: "var(--sepya)" }}>{fmtNum(collateral?.collateralFloat ?? 0, source === "hXAU" ? 4 : 2)} {source}</b>. Gerekli: ≈ {fmtNum(price ? estUsdc / price : 0, 4)} {source}. Aynı {source} tokenı DEX&apos;te tek atomik işlemle tam USDC&apos;ye dönüşür; anchor TL gönderir.
          </div>
        )}
        <div className="satir" style={{ fontSize: 14, marginTop: 10 }}><span className="ikincil">Hedef</span><span>Kayıtlı IBAN · TR•• •••• 4821 (simüle)</span></div>
      </div>

      <button className="btn btn-altin blok" disabled={busy || !(amt >= 50) || !s.vault || (source === "borrow" && estUsdc > limit)} onClick={run}>{fmtTry(amt || 0)} çek</button>
      {steps.length > 0 && <Adimlar steps={steps} current={step} error={error} />}
      {result.length > 0 && (
        <div className="cam kart" style={{ marginTop: 12 }}>
          {result.map((r, i) => <div key={i} className="satir" style={{ fontSize: 14 }}><span>{fmtUsd(r.usdc)} → {fmtTry(r.tryOut, 2)}</span><span className={r.status === "completed" ? "zeytin" : "ikincil"}>{r.status}</span></div>)}
        </div>
      )}
    </Sahne>
  );
}
