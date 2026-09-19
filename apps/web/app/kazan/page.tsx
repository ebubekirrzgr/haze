"use client";
/**
 * Kazan: pozisyonlar, Kazan'a ekle (cüzdandan USDC), dağılım (USDC → RWA'lar path payment + deposit), çek.
 * Kazan'a eklenen her varlık HazeVault üzerinden Blend'e teminat olarak gider; getiri ve limit aynı pozisyondan.
 */
import { useEffect, useState } from "react";
import { ASSET_META, COLLATERAL_CODES, RWA_CODES, assetBlurb, toStroops, type AssetCode, type CollateralCode, type RwaCode } from "@haze/stellar/browser";
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
  const live = useLiveYield(s.credit, s.prices);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<"ekle" | "dagit" | "cek">("ekle");
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
      s.toast({ title: "Tamamlandı", body: labels[labels.length - 1] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const vault = s.vault!;
  const amt = Number(amount.replace(",", "."));

  const ekle = () =>
    run(["Passkey ile imzala", "vault.deposit (USDC → teminat)"], async (next) => {
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
      ["Passkey ile imzala", ...active.map((c) => `USDC → ${c} (path payment)`), `vault.deposit ×${active.length + 1}`],
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

  const cek = () =>
    run(["Passkey ile imzala", `vault.withdraw (${withdrawCode} → cüzdan)`], async (next) => {
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

  if (!s.vault) return <Sahne><Ust title="Kazan" /><div className="cam kart blok">Önce hesap oluştur.</div></Sahne>;

  return (
    <Sahne>
      <Ust title="Kazan" />
      <div style={{ paddingTop: 14 }}>
        <div className="etiket" style={{ fontSize: 12 }}>Teminat · getiri üretiyor</div>
        {live ? <div className="disp num" style={{ fontSize: 30 }}>{fmtUsd(live.liveValue)}</div> : <Yukleniyor h={34} w="50%" />}
        {live && <div className="zeytin num" style={{ fontSize: 13, fontWeight: 600 }}>{fmtPct(live.netApy)} yıllık · {s.prices?.daysPerMinute ? `demo: 1 dk = ${s.prices.daysPerMinute} gün` : ""}</div>}
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
        {(["ekle", "dagit", "cek"] as const).map((t) => (
          <button key={t} className={`cip${tab === t ? " aktif" : ""}`} onClick={() => setTab(t)}>{{ ekle: "Kazan'a ekle", dagit: "Dağılım", cek: "Çek" }[t]}</button>
        ))}
      </div>

      <div className="blok cam kart">
        {tab === "ekle" && (
          <>
            <div className="satir"><span className="etiket" style={{ fontSize: 12 }}>Cüzdan USDC</span><span className="num">{fmtNum(balances.USDC ?? 0)}</span></div>
            <input className="girdi girdi-buyuk num" style={{ marginTop: 10 }} inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <div className="cipler" style={{ marginTop: 10 }}>
              {[25, 50, 100].map((p) => <button key={p} className="cip" onClick={() => setAmount(((balances.USDC ?? 0) * p / 100).toFixed(2))}>%{p}</button>)}
            </div>
            <div className="ikincil" style={{ fontSize: 13, marginTop: 10 }}>1 Soroban işlemi: USDC vault&apos;a geçer ve SupplyCollateral ile teminat olur. Ağ ücretini HAZE karşılar.</div>
            <button className="btn btn-sepya" style={{ marginTop: 12 }} disabled={busy || !(amt > 0) || amt > (balances.USDC ?? 0)} onClick={ekle}>Kazan&apos;a ekle</button>
          </>
        )}
        {tab === "dagit" && (
          <>
            <div className="etiket" style={{ fontSize: 12 }}>Cüzdandaki USDC&apos;yi dağıt</div>
            <input className="girdi girdi-buyuk num" style={{ marginTop: 10 }} inputMode="decimal" placeholder="USDC" value={amount} onChange={(e) => setAmount(e.target.value)} />
            {codes.map((k) => (
              <div key={k} style={{ marginTop: 12 }}>
                <div className="satir" style={{ fontSize: 14 }}><span className="vlogo-satir"><VarlikLogo code={k} size={22} />{k} <span className="ikincil">{ASSET_META[k].name}</span></span><span className="num">%{alloc[k]} · {fmtUsd((amt || 0) * alloc[k] / 100)}</span></div>
                <input type="range" min={0} max={100} value={alloc[k]} onChange={(e) => setAllocKey(k, Number(e.target.value))} />
              </div>
            ))}
            <div className="ikincil" style={{ fontSize: 13, marginTop: 6 }}>Tek passkey onayı: payı olan her RWA için bir PathPaymentStrictReceive (DEX/AMM) + deposit; sponsor hepsine fee-bump uygular.</div>
            <button className="btn btn-sepya" style={{ marginTop: 12 }} disabled={busy || !(amt > 0) || amt > (balances.USDC ?? 0)} onClick={dagit}>Dağılımı uygula</button>
          </>
        )}
        {tab === "cek" && (
          <>
            <div className="cipler">
              {codes.map((k) => <button key={k} className={`cip${withdrawCode === k ? " aktif" : ""}`} onClick={() => setWithdrawCode(k)}>{k}</button>)}
            </div>
            <input className="girdi girdi-buyuk num" style={{ marginTop: 10 }} inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <div className="ikincil" style={{ fontSize: 13, marginTop: 10 }}>WithdrawCollateral → cüzdanına gelir. Havuz, sağlık faktörü bozulursa işlemi reddeder.</div>
            <button className="btn btn-altin" style={{ marginTop: 12 }} disabled={busy || !(amt > 0)} onClick={cek}>Kazan&apos;dan çek</button>
          </>
        )}
      </div>
      {steps.length > 0 && <Adimlar steps={steps} current={step} error={error} />}
    </Sahne>
  );
}
