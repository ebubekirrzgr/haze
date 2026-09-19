"use client";
/**
 * Kazan: pozisyonlar, Kazan'a ekle (cüzdandan USDC), dağılım (USDC → RWA'lar path payment + deposit), çek.
 * Kazan'a eklenen her varlık HazeVault üzerinden Blend'e teminat olarak gider; getiri ve limit aynı pozisyondan.
 */
import { useEffect, useState } from "react";
import { ASSET_META, BORROWABLE_CODES, COLLATERAL_CODES, RWA_CODES, toStroops, type AssetCode, type CollateralCode, type FiatCode, type RwaCode } from "@haze/stellar/browser";
import { useLang } from "@/lib/i18n.tsx";
import { Adimlar, Sahne, Ust, VarlikLogo, Yukleniyor } from "@/components/ui.tsx";
import { useLiveYield } from "@/components/getiri.tsx";
import { api } from "@/lib/api.ts";
import { useChain, useSession } from "@/lib/session.tsx";
import { fmtNum, fmtPct, fmtUsd } from "@/lib/format.ts";

type Code = CollateralCode;
const DEFAULT_ALLOC: Record<Code, number> = { USDC: 40, hUSDY: 25, hXAU: 10, hNVDA: 10, hSHEL: 8, hBMW: 7 };

export default function Kazan() {
  const s = useSession();
  const { ensure } = useChain();
  const { t, assetName, assetBlurb } = useLang();
  const live = useLiveYield(s.credit, s.prices);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<"ekle" | "dagit" | "cek" | "borc">("ekle");
  const [borrowCode, setBorrowCode] = useState<"USDC" | FiatCode>("hTRY");
  const [amount, setAmount] = useState("");
  const [alloc, setAlloc] = useState<Record<Code, number>>(DEFAULT_ALLOC);
  const [withdrawCode, setWithdrawCode] = useState<Code>("hXAU");
  const [steps, setSteps] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const loadBalances = async () => {
    try {
      const ch = s.chain;
      if (!ch) return;
      const b = await ch.balances();
      setBalances(Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Number(v) / 1e7])));
    } catch {
      /* */
    }
  };
  useEffect(() => {
    void loadBalances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.chain]);
  useEffect(() => {
    if (s.credit && !s.prices) return;
    try {
      const r = JSON.parse((s.notifications.find((n) => n.kind === "salary_settled")?.data ?? "{}") as string) as { allocation?: Partial<Record<Code, number>> };
      if (r.allocation) setAlloc({ ...Object.fromEntries(COLLATERAL_CODES.map((c) => [c, 0])), ...r.allocation } as Record<Code, number>);
    } catch {
      /* */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (labels: string[], fn: (next: () => void) => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    setSteps(labels);
    setStep(0);
    try {
      await fn(() => setStep((x) => x + 1));
      setStep(labels.length);
      await s.refresh();
      await loadBalances();
      s.toast({ title: t("genel.tamamlandi"), body: labels[labels.length - 1] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const vault = s.vault!;
  const amt = Number(amount.replace(",", "."));

  const ekle = () =>
    run([t("genel.passkeyImzala"), t("kazan.adimDeposit")], async (next) => {
      const ch = await ensure();
      next();
      await ch.deposit(vault, "USDC", toStroops(amt.toFixed(7)));
    });

  /** Kullanılabilir RWA'lar: API config'de ihraç edilmiş olanlar */
  const rwas: RwaCode[] = RWA_CODES.filter((c) => s.config?.assets?.[c]?.issuer);
  const codes: Code[] = ["USDC", ...rwas];

  /** Dağılım: cüzdandaki USDC'nin %'lerine göre RWA'ları al (path payment), sonra hepsini deposit et */
  const dagit = () => {
    const active = rwas.filter((c) => alloc[c] > 0);
    return run(
      [t("genel.passkeyImzala"), ...active.map((c) => `USDC → ${c} (path payment)`), `vault.deposit ×${active.length + 1}`],
      async (next) => {
        const ch = await ensure();
        next();
        const total = amt;
        const targets: Partial<Record<RwaCode, number>> = {};
        for (const c of active) {
          const price = s.prices?.[c] ?? ASSET_META[c].baseUsd;
          const units = ((total * alloc[c]) / 100) / price;
          targets[c] = units;
          if (units > 0.0000001) await ch.swapUsdcTo(c, toStroops(units.toFixed(7)));
          next();
        }
        const b = await ch.balances();
        const usdcLeft = Math.min((total * alloc.USDC) / 100, Number(b.USDC ?? 0n) / 1e7);
        if (usdcLeft > 0.0000001) await ch.deposit(vault, "USDC", toStroops(usdcLeft.toFixed(7)));
        for (const c of active) {
          const units = Math.min(targets[c] ?? 0, Number(b[c] ?? 0n) / 1e7);
          if (units > 0.0000001) await ch.deposit(vault, c, toStroops(units.toFixed(7)));
        }
        await api.rules(ch.pub, alloc).catch(() => {});
      },
    );
  };

  /** Borç al: USDC ise vault.borrow, fiat ise vault.borrow_asset — seçilen para birimi cüzdana gelir */
  const borc = () =>
    run([t("genel.passkeyImzala"), t("kazan.adimBorrow", { code: borrowCode })], async (next) => {
      const ch = await ensure();
      next();
      if (borrowCode === "USDC") await ch.borrow(vault, toStroops(amt.toFixed(7)));
      else await ch.borrowAsset(vault, borrowCode, toStroops(amt.toFixed(7)));
      await s.refresh();
      await loadBalances();
    });
  const ode = () =>
    run([t("genel.passkeyImzala"), t("kazan.adimRepay", { code: borrowCode })], async (next) => {
      const ch = await ensure();
      next();
      if (borrowCode === "USDC") await ch.repay(vault, toStroops(amt.toFixed(7)));
      else await ch.repayAsset(vault, borrowCode, toStroops(amt.toFixed(7)));
      await s.refresh();
      await loadBalances();
    });
  const borrowables = BORROWABLE_CODES.filter((c) => c === "USDC" || s.config?.assets?.[c]?.issuer);
  const debts = (s.credit?.reserves ?? []).filter((r) => r.liabilitiesFloat > 0);
  const borrowPrice = s.prices?.[borrowCode] ?? ASSET_META[borrowCode].baseUsd;
  const limitUsd = s.credit?.credit.availableLimitFloat ?? 0;

  const cek = () =>
    run([t("genel.passkeyImzala"), t("kazan.adimWithdraw", { code: withdrawCode })], async (next) => {
      const ch = await ensure();
      next();
      await ch.withdraw(vault, withdrawCode, toStroops(amt.toFixed(7)));
    });

  /** Bir varlığın payı değişince kalan pay diğerlerine mevcut oranlarıyla dağıtılır; toplam 100 kalır. */
  const setAllocKey = (k: Code, v: number) => {
    const others = codes.filter((x) => x !== k);
    const rest = 100 - v;
    const otherSum = others.reduce((a, o) => a + alloc[o], 0);
    const next = { ...alloc, [k]: v } as Record<Code, number>;
    let assigned = 0;
    others.forEach((o, i) => {
      const share = i === others.length - 1 ? rest - assigned : otherSum > 0 ? Math.round((alloc[o] / otherSum) * rest) : Math.round(rest / others.length);
      next[o] = Math.max(0, share);
      assigned += next[o];
    });
    setAlloc(next);
  };

  if (!s.vault) return <Sahne><Ust title={t("kazan.baslik")} /><div className="cam kart blok">{t("genel.onceHesap")}</div></Sahne>;

  return (
    <Sahne>
      <Ust title={t("kazan.baslik")} />
      <div style={{ paddingTop: 14 }}>
        <div className="etiket" style={{ fontSize: 12 }}>{t("kazan.teminat")}</div>
        {live ? <div className="disp num" style={{ fontSize: 30 }}>{fmtUsd(live.liveValue)}</div> : <Yukleniyor h={34} w="50%" />}
        {live && <div className="zeytin num" style={{ fontSize: 13, fontWeight: 600 }}>{fmtPct(live.netApy)} {t("genel.yillik")} · {s.prices?.daysPerMinute ? t("kazan.demoZaman", { n: s.prices.daysPerMinute }) : ""}</div>}
      </div>

      <div className="blok cam kart">
        {live?.rows.map((r) => (
          <div key={r.code} className="satir" style={{ padding: "6px 0" }}>
            <div className="vlogo-satir">
              <VarlikLogo code={r.code} size={32} />
              <div>
                <div style={{ fontWeight: 500 }}>{r.code}</div>
                <div className="ikincil" style={{ fontSize: 12.5 }}>{assetBlurb(r.code)} · c {r.c_factor}</div>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="num" style={{ fontWeight: 500 }}>{fmtUsd(r.value)}</div>
              <div className={`num ${r.apy > 0 ? "zeytin" : "ikincil"}`} style={{ fontSize: 12.5 }}>{fmtNum(r.collateralFloat, ASSET_META[r.code as AssetCode]?.displayDecimals ?? 2)} · {r.apy > 0 ? fmtPct(r.apy) : "APY —"}</div>
            </div>
          </div>
        ))}
        {!live && <Yukleniyor />}
      </div>

      <div className="blok cipler">
        {(["ekle", "dagit", "cek", "borc"] as const).map((tb) => (
          <button key={tb} className={`cip${tab === tb ? " aktif" : ""}`} onClick={() => setTab(tb)}>{{ ekle: t("kazan.tabEkle"), dagit: t("kazan.tabDagit"), cek: t("kazan.tabCek"), borc: t("kazan.tabBorc") }[tb]}</button>
        ))}
      </div>

      <div className="blok cam kart">
        {tab === "ekle" && (
          <>
            <div className="satir"><span className="etiket" style={{ fontSize: 12 }}>{t("kazan.cuzdanUsdc")}</span><span className="num">{fmtNum(balances.USDC ?? 0)}</span></div>
            <input className="girdi girdi-buyuk num" style={{ marginTop: 10 }} inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <div className="cipler" style={{ marginTop: 10 }}>
              {[25, 50, 100].map((p) => <button key={p} className="cip" onClick={() => setAmount(((balances.USDC ?? 0) * p / 100).toFixed(2))}>%{p}</button>)}
            </div>
            <div className="ikincil" style={{ fontSize: 13, marginTop: 10 }}>{t("kazan.ekleNot")}</div>
            <button className="btn btn-sepya" style={{ marginTop: 12 }} disabled={busy || !(amt > 0) || amt > (balances.USDC ?? 0)} onClick={ekle}>{t("kazan.ekleBtn")}</button>
          </>
        )}
        {tab === "dagit" && (
          <>
            <div className="etiket" style={{ fontSize: 12 }}>{t("kazan.dagitBaslik")}</div>
            <input className="girdi girdi-buyuk num" style={{ marginTop: 10 }} inputMode="decimal" placeholder="USDC" value={amount} onChange={(e) => setAmount(e.target.value)} />
            {codes.map((k) => (
              <div key={k} style={{ marginTop: 12 }}>
                <div className="satir" style={{ fontSize: 14 }}><span className="vlogo-satir"><VarlikLogo code={k} size={22} />{k} <span className="ikincil">{assetName(k)}</span></span><span className="num">%{alloc[k]} · {fmtUsd((amt || 0) * alloc[k] / 100)}</span></div>
                <input type="range" min={0} max={100} value={alloc[k]} onChange={(e) => setAllocKey(k, Number(e.target.value))} />
              </div>
            ))}
            <div className="ikincil" style={{ fontSize: 13, marginTop: 6 }}>{t("kazan.dagitNot")}</div>
            <button className="btn btn-sepya" style={{ marginTop: 12 }} disabled={busy || !(amt > 0) || amt > (balances.USDC ?? 0)} onClick={dagit}>{t("kazan.dagitBtn")}</button>
          </>
        )}
        {tab === "cek" && (
          <>
            <div className="cipler">
              {codes.map((k) => <button key={k} className={`cip${withdrawCode === k ? " aktif" : ""}`} onClick={() => setWithdrawCode(k)}>{k}</button>)}
            </div>
            <input className="girdi girdi-buyuk num" style={{ marginTop: 10 }} inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <div className="ikincil" style={{ fontSize: 13, marginTop: 10 }}>{t("kazan.cekNot")}</div>
            <button className="btn btn-altin" style={{ marginTop: 12 }} disabled={busy || !(amt > 0)} onClick={cek}>{t("kazan.cekBtn")}</button>
          </>
        )}
      </div>
      {tab === "borc" && (
        <div className="blok cam kart">
          <div className="etiket" style={{ fontSize: 12 }}>{t("kazan.borcBaslik")}</div>
          <div className="cipler" style={{ marginTop: 8 }}>
            {borrowables.map((k) => <button key={k} className={`cip${borrowCode === k ? " aktif" : ""}`} onClick={() => setBorrowCode(k)}>{k}</button>)}
          </div>
          <div className="satir" style={{ fontSize: 14, marginTop: 10 }}><span className="ikincil">{assetName(borrowCode)}</span><span className="num">1 {borrowCode} ≈ {fmtUsd(borrowPrice, borrowPrice < 0.01 ? 4 : 2)}</span></div>
          <div className="satir" style={{ fontSize: 14 }}><span className="ikincil">{t("kazan.cuzdan")}</span><span className="num">{fmtNum(balances[borrowCode] ?? 0, ASSET_META[borrowCode].displayDecimals)} {borrowCode}</span></div>
          <input className="girdi girdi-buyuk num" style={{ marginTop: 10 }} inputMode="decimal" placeholder={borrowCode} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <div className="ikincil" style={{ fontSize: 13, marginTop: 8 }}>≈ {fmtUsd((amt || 0) * borrowPrice)} · {t("kazan.borcNot", { limit: fmtUsd(limitUsd) })}</div>
          <div className="btn-satir" style={{ marginTop: 12 }}>
            <button className="btn btn-kucuk btn-altin" disabled={busy || !(amt > 0) || amt * borrowPrice > limitUsd} onClick={borc}>{t("kazan.borcBtn", { code: borrowCode })}</button>
            <button className="btn btn-kucuk btn-sepya" disabled={busy || !(amt > 0) || amt > (balances[borrowCode] ?? 0)} onClick={ode}>{t("kazan.odeBtn", { code: borrowCode })}</button>
          </div>
          <div className="etiket" style={{ fontSize: 12, marginTop: 16 }}>{t("kazan.borclar")}</div>
          {debts.length === 0 && <div className="ikincil" style={{ fontSize: 13, marginTop: 6 }}>{t("kazan.borcYok")}</div>}
          {debts.map((r) => (
            <div key={r.code} className="satir" style={{ fontSize: 14, marginTop: 6 }}>
              <span className="vlogo-satir"><VarlikLogo code={r.code} size={22} />{r.code} <span className="ikincil">{assetName(r.code)}</span></span>
              <span className="num">{fmtNum(r.liabilitiesFloat, ASSET_META[r.code as AssetCode]?.displayDecimals ?? 2)} · {fmtUsd(r.liabilitiesFloat * r.priceFloat)}</span>
            </div>
          ))}
        </div>
      )}
      {steps.length > 0 && <Adimlar steps={steps} current={step} error={error} />}
    </Sahne>
  );
}
