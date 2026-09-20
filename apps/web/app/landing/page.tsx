import type { Metadata } from "next";
import { Logo } from "@/components/ui.tsx";
import "./landing.css";

export const metadata: Metadata = {
  title: "HAZE — Spend without selling · Demo",
  description:
    "Collateral-backed spending on Stellar. Your savings earn while they back your card. Testnet demo and a three-minute walkthrough.",
};

const DECK = "https://drive.google.com/file/d/1-r00MhogQUEiFXthk6WQOOD-Hobcn0pa/view?usp=sharing";

const STEPS = [
  {
    no: "01",
    ad: "Salary arrives, splits",
    metin:
      "Salary coming through the anchor is split with a single passkey approval across USDC, tokenized treasuries, gold and equities — all inside a Soroban vault that belongs to you.",
  },
  {
    no: "02",
    ad: "Card pays, assets stay",
    metin:
      "Contactless payments are authorized off-chain in milliseconds. On-chain, a small loan opens against your collateral. Nothing is sold at the point of sale.",
  },
  {
    no: "03",
    ad: "Payday clears it",
    metin: "The rule engine repays the open debt and adds what is left back as collateral. Savings keep earning throughout.",
  },
];

const FEATURES = [
  {
    baslik: "Every asset class",
    metin:
      "Fiat stablecoins for every currency, tokenized treasuries, gold and commodities, hundreds of tokenized equities — anything that can be tokenized can back the card. The testnet demo runs a working subset.",
  },
  {
    baslik: "Passkey accounts",
    metin: "No seed phrase, no XLM in the wallet. Reserves are sponsored and fees are paid by fee-bump.",
  },
  {
    baslik: "A vault of your own",
    metin: "A deterministic HazeVault per user. Collateral never leaves the user's control.",
  },
  {
    baslik: "Real card rails",
    metin: "Visa ASA authorization, clearing and void — over the card network's own protocol.",
  },
];

export default function Landing() {
  return (
    <main className="lp">
      <div className="lp-atmos" aria-hidden>
        <i style={{ width: 460, height: 460, left: "-12%", top: "-10%", background: "rgba(200,162,74,0.30)" }} />
        <i style={{ width: 380, height: 380, right: "-8%", top: "14%", background: "rgba(235,217,207,0.55)" }} />
        <i style={{ width: 520, height: 520, left: "30%", bottom: "-18%", background: "rgba(234,223,200,0.65)" }} />
        <span className="lp-gren" />
      </div>

      <header className="lp-ust">
        <Logo color="#3B3226" width={128} />
        <span className="lp-rozet">TESTNET DEMO</span>
      </header>

      <section className="lp-hero">
        <h1 className="disp">Spend without selling.</h1>
        <p className="lp-alt vurgu">Satmadan harca.</p>
        <p className="lp-giris">
          Collateral-backed spending on Stellar. Your salary and savings sit in a Soroban vault that belongs to you — as USDC, tokenized
          treasuries, gold and equities. Every card purchase is a loan against that collateral, and payday repays it.{" "}
          <strong>The assets are never sold.</strong>
        </p>
        <div className="lp-cta">
          <a className="lp-btn lp-btn-altin" href="/">
            Open the app
          </a>
          <a className="lp-btn lp-btn-cizgi" href="#video">
            Watch the demo
          </a>
        </div>
      </section>

      <section className="lp-bolum lp-video-blok" id="video">
        <p className="etiket">Demo · 3 minutes</p>
        <div className="lp-video">
          <video controls preload="metadata" playsInline poster="/media/haze-demo-poster.jpg">
            <source src="/media/haze-demo.mp4" type="video/mp4" />
            Your browser does not support the video tag. <a href="/media/haze-demo.mp4">Download the video.</a>
          </video>
        </div>
      </section>

      <section className="lp-bolum">
        <p className="etiket">How it works</p>
        <div className="lp-adimlar">
          {STEPS.map((a) => (
            <article key={a.no} className="lp-adim">
              <span className="lp-no disp">{a.no}</span>
              <h3>{a.ad}</h3>
              <p>{a.metin}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-bolum">
        <p className="etiket">What is inside</p>
        <div className="lp-ozellikler">
          {FEATURES.map((o) => (
            <article key={o.baslik} className="lp-ozellik">
              <h3>{o.baslik}</h3>
              <p>{o.metin}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-bolum lp-kapanis">
        <h2 className="disp">Dollar collateral, lira spending.</h2>
        <p>
          A purchase at a POS in Türkiye borrows tokenized lira for exactly the amount on the receipt; the dollar collateral stays where it
          is. On payday the HAZE FX desk clears that debt. Credit runs on a Blend v2 pool and the vault on Soroban — both on Stellar testnet.
        </p>
        <div className="lp-cta">
          <a className="lp-btn lp-btn-sepya" href="/">
            Try the demo
          </a>
          <a className="lp-btn lp-btn-cizgi" href="https://github.com/ebubekirrzgr/haze" target="_blank" rel="noreferrer">
            Source code
          </a>
          <a className="lp-btn lp-btn-cizgi" href={DECK} target="_blank" rel="noreferrer">
            Deck
          </a>
        </div>
      </section>

      <footer className="lp-dip">
        <Logo color="#8A6D2F" width={92} />
        <p>
          A Stellar <strong>testnet</strong> demo — no real money and no real card spending. Assets are tokenized representations.
        </p>
      </footer>
    </main>
  );
}
