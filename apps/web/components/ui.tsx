"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useSession } from "@/lib/session.tsx";

/** Zemin lekeleri (kit §4) */
export function Atmos({ koyu = false }: { koyu?: boolean }) {
  return koyu ? (
    <div className="atmos" aria-hidden>
      <i style={{ left: "-10%", top: "-10%", width: "60%", height: "35%", background: "rgba(200,162,74,0.45)" }} />
      <i style={{ left: "60%", top: "40%", width: "70%", height: "40%", background: "rgba(138,109,47,0.55)" }} />
      <i style={{ left: "25%", top: "70%", width: "45%", height: "28%", background: "rgba(235,217,207,0.18)" }} />
      <i className="gren" />
    </div>
  ) : (
    <div className="atmos" aria-hidden>
      <i style={{ left: "-8%", top: "-12%", width: "65%", height: "38%", background: "rgba(200,162,74,0.55)" }} />
      <i style={{ left: "62%", top: "-18%", width: "58%", height: "34%", background: "rgba(235,217,207,0.95)" }} />
      <i style={{ left: "70%", top: "52%", width: "66%", height: "38%", background: "rgba(200,162,74,0.35)" }} />
      <i style={{ left: "8%", top: "60%", width: "54%", height: "32%", background: "rgba(241,230,207,1)" }} />
      <i style={{ left: "40%", top: "30%", width: "34%", height: "20%", background: "rgba(235,217,207,0.7)" }} />
      <i className="gren" />
    </div>
  );
}

export function DemoRozet() {
  return <span className="demo-rozet">DEMO MODU</span>;
}

/** Yükselen H logo — kitteki geometriyle (logo/haze-logo-*.svg). animate: çizgi bir kez çizilir. */
export function Logo({ color = "#C8A24A", width = 160, animate = false }: { color?: string; width?: number; animate?: boolean }) {
  return (
    <svg width={width} viewBox="-102 -1638 12988 1741" aria-label="HAZE" role="img" style={{ display: "block" }}>
      <g fill="none" stroke={color} strokeWidth="192" strokeLinecap="butt">
        <path className={animate ? "logo-govde" : undefined} d="M292.0 -1536.0 V-768.0" />
        <path className={animate ? "logo-cizgi" : undefined} d="M292.0 0.0 V-291.8 A476.2 476.2 0 0 1 768.2 -768.0 H5755.0 A476.2 476.2 0 0 0 6231.2 -1244.2 V-1536.0" pathLength="1" />
        <path className={animate ? "logo-govde" : undefined} d="M6231.2 -768.0 V0.0" />
      </g>
      <g fill={color} className={animate ? "logo-harf" : undefined}>
        <path d="M6669.1 0.0 L7565.1 -1536.0 L7821.1 -1536.0 L8717.1 0.0 L8493.1 0.0 L8301.1 -352.0 L7085.1 -352.0 L6893.1 0.0 Z M7181.1 -512.0 L8205.1 -512.0 L7693.1 -1408.0 Z" />
        <path d="M8997.1 0.0 V-160.0 L10133.1 -1376.0 H9061.1 V-1536.0 H10389.1 V-1376.0 L9253.1 -160.0 H10389.1 V0.0 Z" />
        <path d="M10693.1 0.0 V-1536.0 H11829.1 V-1376.0 H10885.1 V-864.0 H11765.1 V-704.0 H10885.1 V-160.0 H11829.1 V0.0 Z" />
      </g>
    </svg>
  );
}

export function Ikon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-342 -2202 2867 2867" aria-hidden>
      <rect x="-342" y="-2202" width="2867" height="2867" rx="631" fill="#C8A24A" />
      <g fill="none" stroke="#FBF8F1" strokeWidth="240">
        <path d="M292.0 -1536.0 V-768.0" />
        <path d="M292.0 0.0 V-291.8 A476.2 476.2 0 0 1 768.2 -768.0 H1415.8 A476.2 476.2 0 0 0 1892.0 -1244.2 V-1536.0" />
        <path d="M1892.0 -768.0 V0.0" />
      </g>
    </svg>
  );
}

const NAV = [
  { href: "/", label: "Ana sayfa", d: "M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { href: "/kazan", label: "Kazan", d: "M4 18c4-1 6-6 8-9s5-4 8-4M4 18h16" },
  { href: "/kart", label: "Kart", d: "M3 7h18v10H3zM3 11h18" },
  { href: "/profil", label: "Profil", d: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0" },
];

export function AltNav() {
  const p = usePathname();
  return (
    <nav className="alt-nav">
      {NAV.map((n) => (
        <Link key={n.href} href={n.href} className={p === n.href ? "aktif" : ""}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d={n.d} />
          </svg>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

export function Sahne({ children, koyu = false, nav = true }: { children: ReactNode; koyu?: boolean; nav?: boolean }) {
  return (
    <div className={`sahne${koyu ? " koyu" : ""}`}>
      <Atmos koyu={koyu} />
      <div className="icerik">{children}</div>
      {nav && <AltNav />}
      <Toasts />
    </div>
  );
}

export function Ust({ title, back }: { title?: string; back?: string }) {
  return (
    <div className="ust">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {back ? (
          <Link href={back} className="btn-metin" style={{ padding: 0, height: "auto" }}>
            ← Geri
          </Link>
        ) : (
          <Ikon />
        )}
        {title && <span style={{ fontWeight: 500 }}>{title}</span>}
      </div>
      <DemoRozet />
    </div>
  );
}

export function Toasts() {
  const { toasts } = useSession();
  if (!toasts.length) return null;
  return (
    <div className="toastlar">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind === "warn" ? "cam-sicak" : "cam-koyu"}`} style={t.kind === "warn" ? { color: "var(--kiremit)" } : undefined}>
          <div className="b">{t.title}</div>
          {t.body && <div>{t.body}</div>}
        </div>
      ))}
    </div>
  );
}

export function Yukleniyor({ h = 20, w = "60%" }: { h?: number; w?: string }) {
  return <div className="skeleton" style={{ height: h, width: w }} />;
}

/** Çok adımlı işlem ilerlemesi */
export function Adimlar({ steps, current, error }: { steps: string[]; current: number; error?: string }) {
  return (
    <div className="cam kart" style={{ marginTop: 16 }}>
      {steps.map((s, i) => (
        <div key={s} className="satir" style={{ opacity: i > current ? 0.45 : 1 }}>
          <span>{s}</span>
          <span className="num">{i < current ? "✓" : i === current ? (error ? "✕" : "…") : ""}</span>
        </div>
      ))}
      {error && <div className="kiremit" style={{ marginTop: 8, fontSize: 14 }}>{error}</div>}
    </div>
  );
}
