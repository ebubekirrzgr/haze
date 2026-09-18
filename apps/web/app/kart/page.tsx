"use client";
/** Kart: HAZE Gold sanal kart, gün içi harcama/limit, dondur, günlük limit, son harcamalar (Lithic durumu + explorer). */
import { useEffect, useState } from "react";
import { toStroops } from "@haze/stellar/browser";
import { Ikon, Sahne, Ust, Yukleniyor } from "@/components/ui.tsx";
import { api } from "@/lib/api.ts";
import { useChain, useSession } from "@/lib/session.tsx";
import { ago, expertTx, fmtNum, fmtUsd, labelHold } from "@/lib/format.ts";

export default function Kart() {
  const s = useSession();
  const { ensure } = useChain();
  const [card, setCard] = useState<{ token: string; last4: string; pan?: string; expMonth?: string; expYear?: string; demo?: boolean } | null>(null);
  const [showPan, setShowPan] = useState(false);
  const [limitInput, setLimitInput] = useState("");
  const [busy, setBusy] = useState(false);
  const c = s.credit;

  useEffect(() => {
    if (!s.wallet) return;
    api.user(s.wallet.publicKey).then((u) => setCard(u.card ? { token: u.card.token, last4: u.card.last4 } : null)).catch(() => {});
  }, [s.wallet]);

  const createCard = async () => {
    setBusy(true);
    try {
      const r = await api.cardCreate(s.wallet!.publicKey);
      setCard(r);
      setShowPan(true);
      s.toast({ title: "Kart hazır", body: r.demo ? "Demo kart (Lithic sandbox bağlı değil)" : "Lithic sandbox sanal Visa" });
    } catch (e) {
      s.toast({ title: "Kart oluşturulamadı", body: String(e), kind: "warn" });
    } finally {
      setBusy(false);
    }
  };
  const toggleFreeze = async () => {
    if (!c || !s.vault) return;
    setBusy(true);
    try {
      const ch = await ensure();
      await ch.setFrozen(s.vault, !c.card.frozen);
      await s.refresh();
      s.toast({ title: c.card.frozen ? "Kart açıldı" : "Kart donduruldu" });
    } catch (e) {
      s.toast({ title: "İşlem başarısız", body: String(e), kind: "warn" });
    } finally {
      setBusy(false);
    }
  };
  const setLimit = async () => {
    if (!s.vault) return;
    setBusy(true);
    try {
      const ch = await ensure();
      await ch.setDailyLimit(s.vault, toStroops(Number(limitInput).toFixed(2)));
      await s.refresh();
      s.toast({ title: "Günlük limit güncellendi", body: `${limitInput} USDC` });
      setLimitInput("");
    } catch (e) {
      s.toast({ title: "İşlem başarısız", body: String(e), kind: "warn" });
    } finally {
      setBusy(false);
    }
  };

  const spent = c?.card.spentTodayFloat ?? 0;
  const daily = c?.card.dailyLimitFloat ?? 0;

  return (
    <Sahne>
      <Ust title="Kart" />
      <div className={`blok gold-kart${c?.card.frozen ? " donuk" : ""}`}>
        <div style={{ position: "absolute", inset: 0, padding: "18px 20px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div className="satir">
            <span className="disp" style={{ fontSize: 15, letterSpacing: "0.08em" }}>HAZE</span>
            <span className="etiket" style={{ color: "inherit", fontSize: 11 }}>GOLD · VISA</span>
          </div>
          <div>
            <div style={{ width: 38, height: 28, borderRadius: 6, background: "linear-gradient(135deg,#E8D08C,#B8933F)", border: "1px solid rgba(60,40,10,0.25)", marginBottom: 10 }} />
            <div className="disp num" style={{ fontSize: 17, letterSpacing: "0.12em" }}>
              {card ? (showPan && card.pan ? card.pan : `•••• •••• •••• ${card.last4}`) : "•••• •••• •••• ••••"}
            </div>
          </div>
          <div className="satir" style={{ fontSize: 12 }}>
            <span style={{ letterSpacing: "0.08em" }}>[AD SOYAD]</span>
            <span className="num">{card?.expMonth ?? "09"}/{(card?.expYear ?? "2029").slice(-2)}</span>
          </div>
        </div>
      </div>

      {!card && <button className="btn btn-altin blok" disabled={busy || !s.vault} onClick={createCard}>Kart oluştur</button>}
      {card?.pan && <button className="btn btn-metin" onClick={() => setShowPan((x) => !x)}>{showPan ? "Numarayı gizle" : "Numarayı göster"}</button>}

      <div className="blok cam kart">
        <div className="satir">
          <div>
            <div className="etiket" style={{ fontSize: 12 }}>Kullanılabilir limit</div>
            <div className="disp num" style={{ fontSize: 26 }}>{c ? fmtUsd(c.credit.availableLimitFloat) : "—"}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 13 }}>
            <div className="ikincil">Bugün</div>
            <div className="num" style={{ fontWeight: 600 }}>{c ? `${fmtNum(spent)} / ${fmtNum(daily, 0)} USDC` : "—"}</div>
          </div>
        </div>
        <div className="olcek" style={{ marginTop: 10 }}><i style={{ width: `${daily > 0 ? Math.min(100, (spent / daily) * 100) : 0}%` }} /></div>
        <div className="ikincil" style={{ fontSize: 12.5, marginTop: 8 }}>Onay off-chain limit hesabıyla saniyenin altında verilir; Blend borcu hemen ardından açılır. Türkiye&apos;deki POS&apos;ta TL çekilir, USD borçlanılır.</div>
      </div>

      <div className="blok" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button className={`btn btn-kucuk ${c?.card.frozen ? "btn-altin" : "btn-cam"}`} disabled={busy || !c} onClick={toggleFreeze}>{c?.card.frozen ? "Kartı aç (set_frozen false)" : "Kartı dondur (set_frozen)"}</button>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="girdi num" style={{ height: 44, borderRadius: 16, fontSize: 15, padding: "0 12px" }} placeholder={`Günlük limit · ${fmtNum(daily, 0)} USDC`} inputMode="decimal" value={limitInput} onChange={(e) => setLimitInput(e.target.value)} />
          <button className="btn btn-kucuk btn-sepya" style={{ width: 110, flexShrink: 0 }} disabled={busy || !(Number(limitInput) >= 0) || !limitInput} onClick={setLimit}>Ayarla</button>
        </div>
      </div>

      <div className="blok">
        <div className="etiket" style={{ fontSize: 12 }}>Son harcamalar</div>
        <div className="cam kart" style={{ marginTop: 8, paddingTop: 4, paddingBottom: 4 }}>
          {!c && <Yukleniyor />}
          {s.holds.length === 0 && c && <div className="ikincil" style={{ padding: "12px 0", fontSize: 14 }}>Henüz kart harcaması yok. haze-terminal&apos;den bir ödeme dene.</div>}
          {s.holds.map((h) => (
            <div key={h.auth_id} className="islem">
              <div className="ikon"><Ikon size={22} /></div>
              <div className="govde">
                <div className="baslik">{h.merchant}{h.merchant_try ? ` · ₺${h.merchant_try}` : ""}</div>
                <div className={`alt${h.status === "DECLINED" || h.status === "FAILED" ? " kiremit" : ""}`}>{labelHold(h.status)} · {ago(h.created_at)}</div>
              </div>
              <div className="tutar num">
                −{fmtUsd(Number(h.usdc_amount) / 1e7)}
                {h.borrow_tx && <div><a href={expertTx(h.borrow_tx)} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>borç işlemi ↗</a></div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Sahne>
  );
}
