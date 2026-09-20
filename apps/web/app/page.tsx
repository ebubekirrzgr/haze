"use client";
import { ASSET_META, type AssetCode } from "@haze/stellar/browser";
import Link from "next/link";
import { useState } from "react";
import { Adimlar, DemoRozet, Logo, Sahne, Ust, VarlikLogo, Yukleniyor } from "@/components/ui.tsx";
import { useLiveYield } from "@/components/getiri.tsx";
import { useSession } from "@/lib/session.tsx";
import { expertTx, fmtDebt, fmtNum, fmtPct, fmtTry, fmtUsd } from "@/lib/format.ts";
import { DilSecici, useLang, type Key } from "@/lib/i18n.tsx";

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
  // Yayındaki testnet demosunda anahtar hazır gelir (NEXT_PUBLIC_DEMO_SECRET); yerelde boş başlar.
  const [secret, setSecret] = useState(process.env.NEXT_PUBLIC_DEMO_SECRET ?? "");
  const { t } = useLang();

  const run = async (fn: (onStep: (s: string) => void) => Promise<void>) => {
    setError(undefined);
    setSteps([]);
    setStep(0);
    try {
      await fn((label) => {
        setSteps((x) => [...x, label.startsWith("adim.") ? t(label as Key) : label]);
        setStep((x) => x + 1);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Sahne koyu nav={false}>
      <div className="ust"><DilSecici koyu /><DemoRozet /></div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, padding: "0 6px" }}>
        <Logo width={190} animate />
        <div className="vurgu" style={{ fontSize: 21, color: "#D8CBB2" }}>{t("on.slogan")}</div>
      </div>
      <div style={{ padding: "0 6px" }}>
        <div className="disp" style={{ fontSize: 22, lineHeight: 1.3, color: "var(--krem)" }}>
          {t("on.baslik1")}
          <br />
          {t("on.baslik2")}
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.5, color: "#D8CBB2", marginTop: 8 }}>
          {t("on.aciklama")}
        </div>
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10, fontSize: 14, color: "var(--krem)" }}>
          {[t("on.m1"), t("on.m2"), t("on.m3")].map((m) => (
            <div key={m} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 32, height: 32, borderRadius: 16, background: "rgba(200,162,74,0.18)", color: "var(--altin)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>✓</span>
              {m}
            </div>
          ))}
        </div>
      </div>
      {!s.apiOk && <div className="cam-sicak kart" style={{ marginTop: 16, color: "var(--kiremit)", fontSize: 14 }}>{t("on.apiYok")}</div>}
      {mode === "import" ? (
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          <input className="girdi" placeholder={t("on.gizliAnahtar")} value={secret} onChange={(e) => setSecret(e.target.value)} />
          <button className="btn btn-altin" disabled={!secret.startsWith("S") || steps.length > 0 && !error} onClick={() => run((o) => s.importSecret(secret, o))}>
            {t("on.iceAktar")}
          </button>
          <button className="btn btn-metin" style={{ color: "var(--krem)" }} onClick={() => setMode("idle")}>{t("on.vazgec")}</button>
        </div>
      ) : (
        <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 6 }}>
          <button className="btn btn-altin" disabled={!s.apiOk || (steps.length > 0 && !error)} onClick={() => { setMode("create"); void run((o) => s.createAccount(o)); }}>
            {t("on.passkeyOlustur")}
          </button>
          <button className="btn btn-metin" style={{ color: "var(--krem)" }} onClick={() => setMode("import")}>{t("on.demoIceAktar")}</button>
        </div>
      )}
      {steps.length > 0 && <Adimlar steps={steps} current={error ? step - 1 : step} error={error} />}
      <div className="etiket" style={{ textAlign: "center", padding: "18px 0 26px", color: "#A8997E", fontSize: 11 }}>{t("on.stellar")}</div>
    </Sahne>
  );
}

function Dashboard() {
  const s = useSession();
  const { t, labelHold, ago, notif } = useLang();
  const live = useLiveYield(s.credit, s.prices);
  const c = s.credit;
  const usdTry = s.prices?.USDTRY ?? 0;
  const limit = c?.credit.availableLimitFloat ?? 0;
  const debt = c?.credit.debtValueFloat ?? 0;
  const capacity = limit + debt;
  const hf = c?.credit.healthFactor;
  const txs = [
    ...s.holds.map((h) => ({ key: h.auth_id, ts: h.created_at, title: h.merchant, sub: `${t("ana.kartSatir")} · ${labelHold(h.status)}${h.merchant_try ? ` · ₺${h.merchant_try}` : ""}`, amount: fmtDebt(h), tx: h.borrow_tx, warn: h.status === "DECLINED" || h.status === "FAILED" })),
    ...s.notifications.filter((n) => n.kind === "salary_settled").map((n) => ({ key: `n${n.id}`, ts: n.created_at, title: t("ana.maas"), sub: notif(n).body, amount: "", tx: null as string | null, warn: false })),
  ]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 8);

  return (
    <Sahne>
      <Ust />
      <div style={{ paddingTop: 14 }}>
        <div className="etiket" style={{ fontSize: 12 }}>{t("ana.toplam")}</div>
        {c && live ? (
          <>
            <div className="disp num" style={{ fontSize: 32, lineHeight: 1.15 }}>{fmtUsd(live.liveValue)}</div>
            <div style={{ display: "flex", gap: 10, fontSize: 13, marginTop: 2 }}>
              <span className="num ikincil">≈ {usdTry ? fmtTry(live.liveValue * usdTry) : "…"}</span>
              <span className="zeytin num" style={{ fontWeight: 600 }}>{fmtPct(live.netApy)} {t("genel.yillik")}</span>
              <span className="num ikincil">+{fmtNum(live.earned, 4)} $ {t("ana.buOturum")}</span>
            </div>
          </>
        ) : (
          <div style={{ marginTop: 8 }}><Yukleniyor h={34} w="55%" /></div>
        )}
      </div>

      <div className="blok cam kart">
        <div className="satir">
          <div>
            <div className="etiket" style={{ fontSize: 12 }}>{t("ana.limit")}</div>
            <div className="disp num" style={{ fontSize: 26 }}>{c ? fmtUsd(limit) : "—"}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 13 }}>
            <div className="ikincil">{t("ana.acikBorc")}</div>
            <div className="num" style={{ fontWeight: 600 }}>{c ? fmtUsd(debt) : "—"}</div>
          </div>
        </div>
        <div className={`olcek${hf != null && hf < 1.1 ? " uyari" : ""}`} style={{ marginTop: 10 }}>
          <i style={{ width: `${capacity > 0 ? Math.min(100, (debt / capacity) * 100) : 0}%` }} />
        </div>
        <div className="satir" style={{ fontSize: 12.5, marginTop: 8 }} >
          <span className="ikincil">{t("ana.saglik", { hf: hf == null ? "∞" : fmtNum(hf, 2), hedef: c?.credit.targetHealth ?? 1.25 })}</span>
          <span className="ikincil">{t("ana.satilmadi")}</span>
        </div>
      </div>

      <div className="blok btn-satir">
        <Link href="/kazan" className="btn btn-sepya">{t("ana.kazanaEkle")}</Link>
        <Link href="/nakit" className="btn btn-altin">{t("ana.nakdeCevir")}</Link>
      </div>

      {live && (
        <div className="blok cam kart">
          <div className="satir">
            <span className="etiket" style={{ fontSize: 12 }}>{t("ana.getiri")} · {c?.poolMode === "blend" ? "Blend" : "HazeCredit"}</span>
            <span className="zeytin num" style={{ fontWeight: 600 }}>+{fmtUsd(live.valuePerYear / 12)} / {t("genel.ay")}</span>
          </div>
          <div style={{ marginTop: 8 }}>
            {live.rows.map((r) => (
              <div key={r.code} className="satir" style={{ fontSize: 14 }}>
                <span className="vlogo-satir">
                  <VarlikLogo code={r.code} size={26} />
                  <span>
                    {r.code} <span className="ikincil num">{fmtNum(r.collateralFloat, ASSET_META[r.code as AssetCode]?.displayDecimals ?? 2)}</span>
                  </span>
                </span>
                <span className="num">
                  {fmtUsd(r.value)} <span className={r.apy > 0 ? "zeytin" : "ikincil"}>{r.apy > 0 ? fmtPct(r.apy) : t("genel.degerKoruma")}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="blok">
        <div className="satir"><span className="etiket" style={{ fontSize: 12 }}>{t("ana.sonIslemler")}</span><Link href="/kart" style={{ fontSize: 13 }}>{t("ana.tumu")}</Link></div>
        <div className="cam kart" style={{ marginTop: 8, paddingTop: 4, paddingBottom: 4 }}>
          {txs.length === 0 && <div className="ikincil" style={{ padding: "12px 0", fontSize: 14 }}>{t("ana.islemYok")}</div>}
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
