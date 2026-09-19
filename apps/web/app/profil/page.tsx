"use client";
/** Profil: adresler, maaş kuralı (allowance), işveren paneli (maaş simülasyonu), şeffaflık, çıkış. */
import { useEffect, useState } from "react";
import { toStroops } from "@haze/stellar/browser";
import { Sahne, Ust } from "@/components/ui.tsx";
import { api } from "@/lib/api.ts";
import { useChain, useSession } from "@/lib/session.tsx";
import { expertAcc, fmtNum, short } from "@/lib/format.ts";

export default function Profil() {
  const s = useSession();
  const { ensure } = useChain();
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
      s.toast({ title: "Maaş kuralı yetkilendirildi", body: `10.000 USDC · ledger ${r.expiry}` });
      load();
    } catch (e) {
      s.toast({ title: "Yetki verilemedi", body: String(e), kind: "warn" });
    } finally {
      setBusy(false);
    }
  };
  const anchorLogin = async () => {
    setBusy(true);
    try {
      const ch = await ensure();
      await ch.anchorLogin();
      s.toast({ title: "Anchor kimliği yenilendi (SEP-10)" });
      load();
    } catch (e) {
      s.toast({ title: "SEP-10 başarısız", body: String(e), kind: "warn" });
    } finally {
      setBusy(false);
    }
  };
  const paySalary = async () => {
    if (!s.wallet) return;
    setBusy(true);
    setLog(["İşveren paneli: TRY maaş gönderiliyor…"]);
    try {
      const r = await api.salaryStart(s.wallet.publicKey, Number(salary));
      setLog((l) => [...l, `Anchor: ${r.parts.length} parça tamamlandı`, `Kural motoru: ${JSON.stringify(r.settle).slice(0, 160)}`]);
      await s.refresh();
    } catch (e) {
      setLog((l) => [...l, `Hata: ${e instanceof Error ? e.message : e}`]);
    } finally {
      setBusy(false);
    }
  };
  const settleNow = async () => {
    if (!s.wallet) return;
    setBusy(true);
    try {
      const r = await api.salarySettle(s.wallet.publicKey);
      s.toast({ title: r.ok ? "Maaş günü: borç kapatıldı" : `Kapatılamadı: ${r.reason}`, kind: r.ok ? "ok" : "warn" });
      await s.refresh();
    } finally {
      setBusy(false);
    }
  };

  const w = s.wallet;
  return (
    <Sahne>
      <Ust title="Profil" />
      <div className="blok cam kart">
        <div className="etiket" style={{ fontSize: 12 }}>Hesap</div>
        <div className="satir" style={{ fontSize: 14, marginTop: 6 }}><span className="ikincil">G-hesabı</span><a href={w ? expertAcc(w.publicKey) : "#"} target="_blank" rel="noreferrer" className="num">{short(w?.publicKey ?? "", 6)} ↗</a></div>
        <div className="satir" style={{ fontSize: 14 }}><span className="ikincil">HazeVault</span><a href={s.vault ? expertAcc(s.vault) : "#"} target="_blank" rel="noreferrer" className="num">{short(s.vault ?? "—", 6)} ↗</a></div>
        <div className="satir" style={{ fontSize: 14 }}><span className="ikincil">Kilit</span><span>{w?.mode === "passkey" ? "Passkey (PRF) ile şifreli" : "Düz saklama · demo"}</span></div>
        <div className="satir" style={{ fontSize: 14 }}><span className="ikincil">Havuz</span><span>{s.config?.poolMode === "blend" ? "Blend v2 (kendi dağıtımımız)" : "HazeCredit (yedek)"}</span></div>
        <div className="satir" style={{ fontSize: 14 }}><span className="ikincil">XLM bakiyesi</span><span>0 · sponsorlu</span></div>
      </div>

      <div className="blok cam kart">
        <div className="etiket" style={{ fontSize: 12 }}>Maaş kuralı</div>
        <div style={{ fontSize: 14, marginTop: 6 }}>Maaş USDC olarak gelince borç kapanır, kalan Kazan&apos;a eklenir; RWA dağılımını (bono, altın, hisse) tek passkey onayıyla uygularsın.</div>
        <div className="satir" style={{ fontSize: 14, marginTop: 8 }}><span className="ikincil">Vault USDC izni</span><span className="num">{user ? `${fmtNum(Number(user.allowance.amount) / 1e7, 0)} USDC · ledger ${user.allowance.expiryLedger}` : "—"}</span></div>
        <div className="satir" style={{ fontSize: 14 }}><span className="ikincil">Dağılım</span><span className="num">{user?.rule.allocation ?? "—"}</span></div>
        <div className="btn-satir" style={{ marginTop: 10 }}>
          <button className="btn btn-kucuk btn-sepya" disabled={busy || !s.vault} onClick={approve}>İzni yenile</button>
          <button className="btn btn-kucuk btn-cam" disabled={busy} onClick={anchorLogin}>{user?.hasAnchorToken ? "Anchor: bağlı" : "Anchor'a bağlan"}</button>
        </div>
      </div>

      <div className="blok cam-koyu kart">
        <div className="etiket" style={{ fontSize: 12, color: "#D8CBB2" }}>İşveren paneli · demo</div>
        <div style={{ fontSize: 14, marginTop: 6, color: "#D8CBB2" }}>SEP-38 teklif → SEP-6 deposit-exchange → simulate-bank-transfer → testnet USDC → settle_salary.</div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input className="girdi num" style={{ background: "rgba(255,255,255,0.08)", color: "var(--krem)", borderColor: "rgba(255,255,255,0.2)" }} inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} />
          <button className="btn btn-altin" style={{ width: 150, height: 56 }} disabled={busy || !user?.hasAnchorToken} onClick={paySalary}>₺ Maaş yatır</button>
        </div>
        <button className="btn btn-kucuk btn-cam" style={{ marginTop: 8, background: "rgba(255,255,255,0.08)", color: "var(--krem)" }} disabled={busy} onClick={settleNow}>Maaş günü simülasyonu (settle_salary)</button>
        {log.length > 0 && <div style={{ marginTop: 10, fontSize: 12.5, color: "#D8CBB2", fontFamily: "ui-monospace, monospace" }}>{log.map((l, i) => <div key={i}>{l}</div>)}</div>}
      </div>

      <div className="blok cam-sicak kart" style={{ fontSize: 13.5 }}>
        <div className="etiket" style={{ fontSize: 12 }}>Şeffaflık</div>
        <div style={{ marginTop: 6 }}>Mock olanlar: TR Mock Anchor (testnet USDC gerçek), hUSDY/hXAU/hNVDA/hSHEL/hBMW/hTRY (biz bastık; mainnet karşılıkları Ondo USDY, Matrixdock XAUm, tokenize hisseler), Lithic sandbox kart, hızlandırılmış getiri ({s.prices?.daysPerMinute ?? 1} gün/dk). Hukuki uyum kapsam dışı.</div>
      </div>

      <button className="btn btn-metin blok" onClick={s.logout}>Çıkış yap (cüzdanı bu cihazdan sil)</button>
    </Sahne>
  );
}
