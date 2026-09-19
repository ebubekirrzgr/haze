"use client";
/** Profil: adresler, maaş kuralı (allowance), işveren paneli (maaş simülasyonu), şeffaflık, çıkış. */
import { useEffect, useState } from "react";
import { toStroops } from "@haze/stellar/browser";
import { Sahne, Ust } from "@/components/ui.tsx";
import { api } from "@/lib/api.ts";
import { useChain, useSession } from "@/lib/session.tsx";
import { expertAcc, fmtNum, short } from "@/lib/format.ts";
import { DilSecici, useLang } from "@/lib/i18n.tsx";

export default function Profil() {
  const s = useSession();
  const { ensure } = useChain();
  const { t } = useLang();
  const [user, setUser] = useState<{ allowance: { amount: string; expiryLedger: number }; hasAnchorToken: boolean; rule: { allocation: string } }>();
  const [busy, setBusy] = useState(false);
  const [salary, setSalary] = useState("2500");
  const [log, setLog] = useState<string[]>([]);

  const load = () => {
    if (!s.wallet) return;
    api.user(s.wallet.publicKey).then(setUser).catch(() => {});
  };
  useEffect(load, [s.wallet]);

  const approve = async () => {
    if (!s.vault) return;
    setBusy(true);
    try {
      const ch = await ensure();
      const r = await ch.approveSalary(s.vault, toStroops("10000"), 30);
      s.toast({ title: t("profil.kuralYetki"), body: `10.000 USDC · ledger ${r.expiry}` });
      load();
    } catch (e) {
      s.toast({ title: t("profil.yetkiYok"), body: String(e), kind: "warn" });
    } finally {
      setBusy(false);
    }
  };
  const anchorLogin = async () => {
    setBusy(true);
    try {
      const ch = await ensure();
      await ch.anchorLogin();
      s.toast({ title: t("profil.sep10Yenilendi") });
      load();
    } catch (e) {
      s.toast({ title: t("profil.sep10Basarisiz"), body: String(e), kind: "warn" });
    } finally {
      setBusy(false);
    }
  };
  const paySalary = async () => {
    if (!s.wallet) return;
    setBusy(true);
    setLog([t("profil.logGonder")]);
    try {
      const r = await api.salaryStart(s.wallet.publicKey, Number(salary));
      setLog((l) => [...l, t("profil.logAnchor", { n: r.parts.length }), `${t("profil.logKural")}: ${JSON.stringify(r.settle).slice(0, 160)}`]);
      await s.refresh();
    } catch (e) {
      setLog((l) => [...l, `${t("profil.logHata")}: ${e instanceof Error ? e.message : e}`]);
    } finally {
      setBusy(false);
    }
  };
  const settleNow = async () => {
    if (!s.wallet) return;
    setBusy(true);
    try {
      const r = await api.salarySettle(s.wallet.publicKey);
      s.toast({ title: r.ok ? t("profil.borcKapandi") : `${t("profil.kapatilamadi")}: ${r.reason}`, kind: r.ok ? "ok" : "warn" });
      await s.refresh();
    } finally {
      setBusy(false);
    }
  };

  const w = s.wallet;
  return (
    <Sahne>
      <Ust title={t("profil.baslik")} />
      <div className="blok cam kart satir"><span className="etiket" style={{ fontSize: 12 }}>{t("genel.dil")}</span><DilSecici /></div>
      <div className="blok cam kart">
        <div className="etiket" style={{ fontSize: 12 }}>{t("profil.hesap")}</div>
        <div className="satir" style={{ fontSize: 14, marginTop: 6 }}><span className="ikincil">{t("profil.gHesabi")}</span><a href={w ? expertAcc(w.publicKey) : "#"} target="_blank" rel="noreferrer" className="num">{short(w?.publicKey ?? "", 6)} ↗</a></div>
        <div className="satir" style={{ fontSize: 14 }}><span className="ikincil">HazeVault</span><a href={s.vault ? expertAcc(s.vault) : "#"} target="_blank" rel="noreferrer" className="num">{short(s.vault ?? "—", 6)} ↗</a></div>
        <div className="satir" style={{ fontSize: 14 }}><span className="ikincil">{t("profil.kilit")}</span><span>{w?.mode === "passkey" ? t("profil.passkeyPrf") : t("profil.duz")}</span></div>
        <div className="satir" style={{ fontSize: 14 }}><span className="ikincil">{t("profil.havuz")}</span><span>{s.config?.poolMode === "blend" ? t("profil.blend") : t("profil.hazecredit")}</span></div>
        <div className="satir" style={{ fontSize: 14 }}><span className="ikincil">{t("profil.xlm")}</span><span>{t("profil.sponsorlu")}</span></div>
      </div>

      <div className="blok cam kart">
        <div className="etiket" style={{ fontSize: 12 }}>{t("profil.maasKurali")}</div>
        <div style={{ fontSize: 14, marginTop: 6 }}>{t("profil.maasNot")}</div>
        <div className="satir" style={{ fontSize: 14, marginTop: 8 }}><span className="ikincil">{t("profil.izin")}</span><span className="num">{user ? `${fmtNum(Number(user.allowance.amount) / 1e7, 0)} USDC · ledger ${user.allowance.expiryLedger}` : "—"}</span></div>
        <div className="satir" style={{ fontSize: 14 }}><span className="ikincil">{t("profil.dagilim")}</span><span className="num">{user?.rule.allocation ?? "—"}</span></div>
        <div className="btn-satir" style={{ marginTop: 10 }}>
          <button className="btn btn-kucuk btn-sepya" disabled={busy || !s.vault} onClick={approve}>{t("profil.izniYenile")}</button>
          <button className="btn btn-kucuk btn-cam" disabled={busy} onClick={anchorLogin}>{user?.hasAnchorToken ? t("profil.anchorBagli") : t("profil.anchorBaglan")}</button>
        </div>
      </div>

      <div className="blok cam-koyu kart">
        <div className="etiket" style={{ fontSize: 12, color: "#D8CBB2" }}>{t("profil.isveren")}</div>
        <div style={{ fontSize: 14, marginTop: 6, color: "#D8CBB2" }}>{t("profil.isverenNot")}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input className="girdi num" style={{ background: "rgba(255,255,255,0.08)", color: "var(--krem)", borderColor: "rgba(255,255,255,0.2)" }} inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} />
          <button className="btn btn-altin" style={{ width: 150, height: 56 }} disabled={busy || !user?.hasAnchorToken} onClick={paySalary}>{t("profil.maasYatir")}</button>
        </div>
        <button className="btn btn-kucuk btn-cam" style={{ marginTop: 8, background: "rgba(255,255,255,0.08)", color: "var(--krem)" }} disabled={busy} onClick={settleNow}>{t("profil.maasGunu")}</button>
        {log.length > 0 && <div style={{ marginTop: 10, fontSize: 12.5, color: "#D8CBB2", fontFamily: "ui-monospace, monospace" }}>{log.map((l, i) => <div key={i}>{l}</div>)}</div>}
      </div>

      <div className="blok cam-sicak kart" style={{ fontSize: 13.5 }}>
        <div className="etiket" style={{ fontSize: 12 }}>{t("profil.seffaflik")}</div>
        <div style={{ marginTop: 6 }}>{t("profil.seffaflikNot", { n: s.prices?.daysPerMinute ?? 1 })}</div>
      </div>

      <button className="btn btn-metin blok" onClick={s.logout}>{t("profil.cikis")}</button>
    </Sahne>
  );
}
