"use client";
import { ASSET_META, type AssetCode } from "@haze/stellar/browser";
import Link from "next/link";
import { useState } from "react";
import { Adimlar, DemoRozet, Logo, Sahne, Ust, Yukleniyor } from "@/components/ui.tsx";
import { useLiveYield } from "@/components/getiri.tsx";
import { useSession } from "@/lib/session.tsx";
import { ago, expertTx, fmtNum, fmtPct, fmtTry, fmtUsd, labelHold } from "@/lib/format.ts";

export default function Home() {
  const s = useSession();
  if (!s.ready) return <Sahne nav={false}><div style={{ padding: 40 }}><Yukleniyor /></div></Sahne>;
  if (!s.wallet) return <Onboarding />;
  return <Dashboard />;
}

function Onboarding() {
  const s = useSession();
  const [mode, setMode] = useState<"idle" | "create" | "import">("idle");
  const [step, setStep] = useState(0);
  const [steps, setSteps] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [secret, setSecret] = useState("");

  const run = async (fn: (onStep: (s: string) => void) => Promise<void>) => {
    setError(undefined);
    setSteps([]);
    setStep(0);
    try {
      await fn((label) => {
        setSteps((x) => [...x, label]);
        setStep((x) => x + 1);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Sahne koyu nav={false}>
      <div className="ust"><div /><DemoRozet /></div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, padding: "0 6px" }}>
        <Logo width={190} animate />
        <div className="vurgu" style={{ fontSize: 21, color: "#D8CBB2" }}>Arkada akış, önde sakinlik.</div>
      </div>
      <div style={{ padding: "0 6px" }}>
        <div className="disp" style={{ fontSize: 22, lineHeight: 1.3, color: "var(--krem)" }}>
          Birikimin satılmaz,
          <br />
          kartın harcar.
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.5, color: "#D8CBB2", marginTop: 8 }}>
          Maaşın USDC, tokenize bono ve altın olarak getiri üretir; kartla harcadığında teminatına karşı borç açılır, maaş günü kendiliğinden kapanır.
        </div>
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10, fontSize: 14, color: "var(--krem)" }}>
          {["Satmadan harca: teminat yerinde kalır", "Getiri harcarken de işler", "Cüzdanında XLM tutman gerekmez"].map((t) => (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 32, height: 32, borderRadius: 16, background: "rgba(200,162,74,0.18)", color: "var(--altin)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>✓</span>
              {t}
            </div>
          ))}
        </div>
      </div>
      {!s.apiOk && <div className="cam-sicak kart" style={{ marginTop: 16, color: "var(--kiremit)", fontSize: 14 }}>haze-api'ye ulaşılamıyor. `pnpm dev:api` çalışıyor mu?</div>}
      {mode === "import" ? (
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          <input className="girdi" placeholder="Demo hesabı gizli anahtarı (S…)" value={secret} onChange={(e) => setSecret(e.target.value)} />
          <button className="btn btn-altin" disabled={!secret.startsWith("S") || steps.length > 0 && !error} onClick={() => run((o) => s.importSecret(secret, o))}>
            İçe aktar
          </button>
          <button className="btn btn-metin" style={{ color: "var(--krem)" }} onClick={() => setMode("idle")}>Vazgeç</button>
        </div>
      ) : (
        <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 6 }}>
          <button className="btn btn-altin" disabled={!s.apiOk || (steps.length > 0 && !error)} onClick={() => { setMode("create"); void run((o) => s.createAccount(o)); }}>
            Passkey ile hesap oluştur
          </button>
          <button className="btn btn-metin" style={{ color: "var(--krem)" }} onClick={() => setMode("import")}>Demo hesabını içe aktar</button>
        </div>
      )}
      {steps.length > 0 && <Adimlar steps={steps} current={error ? step - 1 : step} error={error} />}
      <div className="etiket" style={{ textAlign: "center", padding: "18px 0 26px", color: "#A8997E", fontSize: 11 }}>Stellar üzerinde çalışır</div>
    </Sahne>
  );
}

function Dashboard() {
  const s = useSession();
  const live = useLiveYield(s.credit, s.prices);
  const c = s.credit;
  const usdTry = s.prices?.USDTRY ?? 0;
  const limit = c?.credit.availableLimitFloat ?? 0;
  const debt = c?.credit.debtValueFloat ?? 0;
  const capacity = limit + debt;
  const hf = c?.credit.healthFactor;
  const txs = [
    ...s.holds.map((h) => ({ key: h.auth_id, ts: h.created_at, title: h.merchant, sub: `Kart · ${labelHold(h.status)}${h.merchant_try ? ` · ₺${h.merchant_try}` : ""}`, amount: `−${fmtUsd(Number(h.usdc_amount) / 1e7)}`, tx: h.borrow_tx, warn: h.status === "DECLINED" || h.status === "FAILED" })),
    ...s.notifications.filter((n) => n.kind === "salary_settled").map((n) => ({ key: `n${n.id}`, ts: n.created_at, title: "Maaş", sub: n.body, amount: "", tx: null as string | null, warn: false })),
  ]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 8);

  return (
    <Sahne>
      <Ust />
      <div style={{ paddingTop: 14 }}>
        <div className="etiket" style={{ fontSize: 12 }}>Kazan · toplam değer</div>
        {c && live ? (
          <>
            <div className="disp num" style={{ fontSize: 32, lineHeight: 1.15 }}>{fmtUsd(live.liveValue)}</div>
            <div style={{ display: "flex", gap: 10, fontSize: 13, marginTop: 2 }}>
              <span className="num ikincil">≈ {usdTry ? fmtTry(live.liveValue * usdTry) : "…"}</span>
              <span className="zeytin num" style={{ fontWeight: 600 }}>{fmtPct(live.netApy)} yıllık</span>
              <span className="num ikincil">+{fmtNum(live.earned, 4)} $ bu oturumda</span>
            </div>
          </>
        ) : (
          <div style={{ marginTop: 8 }}><Yukleniyor h={34} w="55%" /></div>
        )}
      </div>

      <div className="blok cam kart">
        <div className="satir">
          <div>
            <div className="etiket" style={{ fontSize: 12 }}>Harcama limiti</div>
            <div className="disp num" style={{ fontSize: 26 }}>{c ? fmtUsd(limit) : "—"}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 13 }}>
            <div className="ikincil">Açık borç</div>
            <div className="num" style={{ fontWeight: 600 }}>{c ? fmtUsd(debt) : "—"}</div>
          </div>
        </div>
        <div className={`olcek${hf != null && hf < 1.1 ? " uyari" : ""}`} style={{ marginTop: 10 }}>
          <i style={{ width: `${capacity > 0 ? Math.min(100, (debt / capacity) * 100) : 0}%` }} />
        </div>
        <div className="satir" style={{ fontSize: 12.5, marginTop: 8 }} >
          <span className="ikincil">Sağlık faktörü {hf == null ? "∞" : fmtNum(hf, 2)} · hedef {c?.credit.targetHealth ?? 1.25}</span>
          <span className="ikincil">Teminat satılmadı</span>
        </div>
      </div>

      <div className="blok btn-satir">
        <Link href="/kazan" className="btn btn-sepya">Kazan&apos;a ekle</Link>
        <Link href="/nakit" className="btn btn-altin">Nakde çevir</Link>
      </div>

      {live && (
        <div className="blok cam kart">
          <div className="satir">
            <span className="etiket" style={{ fontSize: 12 }}>Getiri · {c?.poolMode === "blend" ? "Blend" : "HazeCredit"}</span>
            <span className="zeytin num" style={{ fontWeight: 600 }}>+{fmtUsd(live.valuePerYear / 12)} / ay</span>
          </div>
          <div style={{ marginTop: 8 }}>
            {live.rows.map((r) => (
              <div key={r.code} className="satir" style={{ fontSize: 14 }}>
                <span>
                  {r.code} <span className="ikincil num">{fmtNum(r.collateralFloat, ASSET_META[r.code as AssetCode]?.displayDecimals ?? 2)}</span>
                </span>
                <span className="num">
                  {fmtUsd(r.value)} <span className={r.apy > 0 ? "zeytin" : "ikincil"}>{r.apy > 0 ? fmtPct(r.apy) : "değer koruma"}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="blok">
        <div className="satir"><span className="etiket" style={{ fontSize: 12 }}>Son işlemler</span><Link href="/kart" style={{ fontSize: 13 }}>Tümü</Link></div>
        <div className="cam kart" style={{ marginTop: 8, paddingTop: 4, paddingBottom: 4 }}>
          {txs.length === 0 && <div className="ikincil" style={{ padding: "12px 0", fontSize: 14 }}>Henüz işlem yok.</div>}
          {txs.map((t) => (
            <div key={t.key} className="islem">
              <div className="ikon">{t.title.slice(0, 1)}</div>
              <div className="govde">
                <div className="baslik">{t.title}</div>
                <div className={`alt${t.warn ? " kiremit" : ""}`}>{t.sub} · {ago(t.ts)}</div>
              </div>
              <div className="tutar num">
                {t.amount}
                {t.tx && <div><a href={expertTx(t.tx)} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>explorer ↗</a></div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Sahne>
  );
}
