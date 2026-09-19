"use client";
/**
 * Dil desteği: TR (varsayılan, tarayıcı Türkçe ise) ve EN. Seçim localStorage'da (haze.lang) kalır.
 * Kullanım: const { t, lang } = useLang(); t("kart.baslik") · t("x.y", { n: 3 }) → "{n}" yerine 3.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ASSET_META, type AssetCode } from "@haze/stellar/browser";
import { setFormatLocale } from "./format.ts";

export type Lang = "tr" | "en";
type Entry = { tr: string; en: string };

const STR = {
  // genel
  "nav.ana": { tr: "Ana sayfa", en: "Home" },
  "nav.kazan": { tr: "Kazan", en: "Earn" },
  "nav.kart": { tr: "Kart", en: "Card" },
  "nav.profil": { tr: "Profil", en: "Profile" },
  "genel.geri": { tr: "← Geri", en: "← Back" },
  "genel.demo": { tr: "DEMO MODU", en: "DEMO MODE" },
  "genel.tamamlandi": { tr: "Tamamlandı", en: "Done" },
  "genel.islemBasarisiz": { tr: "İşlem başarısız", en: "Transaction failed" },
  "genel.passkeyImzala": { tr: "Passkey ile imzala", en: "Sign with passkey" },
  "genel.onceHesap": { tr: "Önce hesap oluştur.", en: "Create an account first." },
  "genel.dil": { tr: "Dil", en: "Language" },
  "genel.degerKoruma": { tr: "değer koruma", en: "store of value" },
  "genel.yillik": { tr: "yıllık", en: "APY" },
  "genel.ay": { tr: "ay", en: "mo" },
  // onboarding
  "on.slogan": { tr: "Arkada akış, önde sakinlik.", en: "Flow behind, calm in front." },
  "on.baslik1": { tr: "Birikimin satılmaz,", en: "Your savings stay invested," },
  "on.baslik2": { tr: "kartın harcar.", en: "your card spends." },
  "on.aciklama": { tr: "Maaşın USDC, tokenize bono, altın ve hisse olarak getiri üretir; kartla harcadığında teminatına karşı borç açılır, maaş günü kendiliğinden kapanır.", en: "Your salary earns as USDC, tokenized treasuries, gold and stocks; card purchases borrow against that collateral and are repaid automatically on payday." },
  "on.m1": { tr: "Satmadan harca: teminat yerinde kalır", en: "Spend without selling: collateral stays put" },
  "on.m2": { tr: "Getiri harcarken de işler", en: "Yield keeps accruing while you spend" },
  "on.m3": { tr: "Cüzdanında XLM tutman gerekmez", en: "No XLM needed in your wallet" },
  "on.apiYok": { tr: "haze-api'ye ulaşılamıyor. `pnpm dev:api` çalışıyor mu?", en: "Cannot reach haze-api. Is `pnpm dev:api` running?" },
  "on.gizliAnahtar": { tr: "Demo hesabı gizli anahtarı (S…)", en: "Demo account secret key (S…)" },
  "on.iceAktar": { tr: "İçe aktar", en: "Import" },
  "on.vazgec": { tr: "Vazgeç", en: "Cancel" },
  "on.passkeyOlustur": { tr: "Passkey ile hesap oluştur", en: "Create account with passkey" },
  "on.demoIceAktar": { tr: "Demo hesabını içe aktar", en: "Import demo account" },
  "on.stellar": { tr: "Stellar üzerinde çalışır", en: "Runs on Stellar" },
  "adim.sponsorlu": { tr: "Sponsorlu hesap açılıyor", en: "Opening sponsored account" },
  "adim.vault": { tr: "Kasa (vault) kuruluyor", en: "Deploying vault" },
  "adim.sep10": { tr: "Anchor kimliği (SEP-10)", en: "Anchor login (SEP-10)" },
  "adim.kart": { tr: "Kart oluşturuluyor", en: "Issuing card" },
  "adim.passkey": { tr: "Passkey kaydı", en: "Registering passkey" },
  "adim.hesapKontrol": { tr: "Hesap kontrol ediliyor", en: "Checking account" },
  // ana sayfa
  "ana.toplam": { tr: "Kazan · toplam değer", en: "Earn · total value" },
  "ana.buOturum": { tr: "bu oturumda", en: "this session" },
  "ana.limit": { tr: "Harcama limiti", en: "Spending limit" },
  "ana.acikBorc": { tr: "Açık borç", en: "Open debt" },
  "ana.saglik": { tr: "Sağlık faktörü {hf} · hedef {hedef}", en: "Health factor {hf} · target {hedef}" },
  "ana.satilmadi": { tr: "Teminat satılmadı", en: "Nothing sold" },
  "ana.kazanaEkle": { tr: "Kazan'a ekle", en: "Add to Earn" },
  "ana.nakdeCevir": { tr: "Nakde çevir", en: "Cash out" },
  "ana.getiri": { tr: "Getiri", en: "Yield" },
  "ana.sonIslemler": { tr: "Son işlemler", en: "Recent activity" },
  "ana.tumu": { tr: "Tümü", en: "All" },
  "ana.islemYok": { tr: "Henüz işlem yok.", en: "No activity yet." },
  "ana.maas": { tr: "Maaş", en: "Salary" },
  "ana.kartSatir": { tr: "Kart", en: "Card" },
  // kazan
  "kazan.baslik": { tr: "Kazan", en: "Earn" },
  "kazan.teminat": { tr: "Teminat · getiri üretiyor", en: "Collateral · earning" },
  "kazan.demoZaman": { tr: "demo: 1 dk = {n} gün", en: "demo: 1 min = {n} days" },
  "kazan.tabEkle": { tr: "Kazan'a ekle", en: "Add" },
  "kazan.tabDagit": { tr: "Dağılım", en: "Allocate" },
  "kazan.tabCek": { tr: "Çek", en: "Withdraw" },
  "kazan.cuzdanUsdc": { tr: "Cüzdan USDC", en: "Wallet USDC" },
  "kazan.ekleNot": { tr: "1 Soroban işlemi: USDC vault'a geçer ve SupplyCollateral ile teminat olur. Ağ ücretini HAZE karşılar.", en: "One Soroban transaction: USDC moves to your vault and becomes collateral via SupplyCollateral. HAZE pays the network fee." },
  "kazan.ekleBtn": { tr: "Kazan'a ekle", en: "Add to Earn" },
  "kazan.dagitBaslik": { tr: "Cüzdandaki USDC'yi dağıt", en: "Allocate wallet USDC" },
  "kazan.dagitNot": { tr: "Tek passkey onayı: payı olan her RWA için bir PathPaymentStrictReceive (DEX/AMM) + deposit; sponsor hepsine fee-bump uygular.", en: "One passkey approval: a PathPaymentStrictReceive (DEX/AMM) plus a deposit for every asset with a share; the sponsor fee-bumps them all." },
  "kazan.dagitBtn": { tr: "Dağılımı uygula", en: "Apply allocation" },
  "kazan.cekNot": { tr: "WithdrawCollateral → cüzdanına gelir. Havuz, sağlık faktörü bozulursa işlemi reddeder.", en: "WithdrawCollateral → sent to your wallet. The pool rejects it if the health factor would break." },
  "kazan.cekBtn": { tr: "Kazan'dan çek", en: "Withdraw from Earn" },
  "kazan.adimDeposit": { tr: "vault.deposit (USDC → teminat)", en: "vault.deposit (USDC → collateral)" },
  "kazan.adimWithdraw": { tr: "vault.withdraw ({code} → cüzdan)", en: "vault.withdraw ({code} → wallet)" },
  // kart
  "kart.baslik": { tr: "Kart", en: "Card" },
  "kart.hazir": { tr: "Kart hazır", en: "Card ready" },
  "kart.demoKart": { tr: "Demo kart (Lithic sandbox bağlı değil)", en: "Demo card (Lithic sandbox not connected)" },
  "kart.lithicKart": { tr: "Lithic sandbox sanal Visa", en: "Lithic sandbox virtual Visa" },
  "kart.olusturulamadi": { tr: "Kart oluşturulamadı", en: "Could not issue card" },
  "kart.acildi": { tr: "Kart açıldı", en: "Card unfrozen" },
  "kart.donduruldu": { tr: "Kart donduruldu", en: "Card frozen" },
  "kart.limitGuncel": { tr: "Günlük limit güncellendi", en: "Daily limit updated" },
  "kart.adSoyad": { tr: "[AD SOYAD]", en: "[CARDHOLDER]" },
  "kart.olustur": { tr: "Kart oluştur", en: "Issue card" },
  "kart.numaraGizle": { tr: "Numarayı gizle", en: "Hide number" },
  "kart.numaraGoster": { tr: "Numarayı göster", en: "Show number" },
  "kart.kullanilabilir": { tr: "Kullanılabilir limit", en: "Available limit" },
  "kart.bugun": { tr: "Bugün", en: "Today" },
  "kart.not": { tr: "Onay off-chain limit hesabıyla saniyenin altında verilir; Blend borcu hemen ardından açılır. Türkiye'deki POS'ta TL çekilir, USD borçlanılır.", en: "Authorization is decided off-chain in under a second from the credit limit; the Blend borrow follows right after. A POS in Türkiye charges TRY, the debt is in USD." },
  "kart.ac": { tr: "Kartı aç (set_frozen false)", en: "Unfreeze card (set_frozen false)" },
  "kart.dondur": { tr: "Kartı dondur (set_frozen)", en: "Freeze card (set_frozen)" },
  "kart.gunlukLimit": { tr: "Günlük limit · {n} USDC", en: "Daily limit · {n} USDC" },
  "kart.ayarla": { tr: "Ayarla", en: "Set" },
  "kart.sonHarcamalar": { tr: "Son harcamalar", en: "Recent purchases" },
  "kart.harcamaYok": { tr: "Henüz kart harcaması yok. haze-terminal'den bir ödeme dene.", en: "No card purchases yet. Try a payment from haze-terminal." },
  "kart.borcIslemi": { tr: "borç işlemi ↗", en: "borrow tx ↗" },
  // nakit
  "nakit.baslik": { tr: "Nakde çevir", en: "Cash out" },
  "nakit.slogan": { tr: "TL'ye, satmadan ya da satarak.", en: "To TRY, with or without selling." },
  "nakit.aciklama": { tr: "Tek ekran: tutar, kaynak, kayıtlı IBAN. Anchor işlem limiti aşılırsa tutar parçalanır.", en: "One screen: amount, source, saved IBAN. Amounts above the anchor limit are split." },
  "nakit.tutar": { tr: "Tutar", en: "Amount" },
  "nakit.kur": { tr: "Kur (SEP-38)", en: "Rate (SEP-38)" },
  "nakit.gerekliUsdc": { tr: "Gerekli USDC", en: "USDC needed" },
  "nakit.kaynak": { tr: "Kaynak", en: "Source" },
  "nakit.borcla": { tr: "Satmadan · borçla", en: "Without selling · borrow" },
  "nakit.kaynakEtiket": { tr: "{ad}'dan ({code})", en: "From {ad} ({code})" },
  "nakit.borcNot": { tr: "Teminata dokunulmaz; vault USDC borç açar ve hesabına gönderir. Kullanılabilir limit", en: "Collateral is untouched; the vault borrows USDC and sends it to your account. Available limit" },
  "nakit.teminatta": { tr: "Teminatta", en: "In collateral" },
  "nakit.gerekli": { tr: "Gerekli", en: "Needed" },
  "nakit.dexNot": { tr: "Aynı {code} tokenı DEX'te tek atomik işlemle tam USDC'ye dönüşür; anchor TL gönderir.", en: "The same {code} token converts to exact USDC in one atomic DEX transaction; the anchor sends TRY." },
  "nakit.hedef": { tr: "Hedef", en: "Destination" },
  "nakit.iban": { tr: "Kayıtlı IBAN · TR•• •••• 4821 (simüle)", en: "Saved IBAN · TR•• •••• 4821 (simulated)" },
  "nakit.cekBtn": { tr: "{tutar} çek", en: "Cash out {tutar}" },
  "nakit.cevrildi": { tr: "Nakde çevrildi", en: "Cashed out" },
  "nakit.ibanSimule": { tr: "{tutar} → kayıtlı IBAN (simüle)", en: "{tutar} → saved IBAN (simulated)" },
  "nakit.adimTeklif": { tr: "SEP-38 teklif + SEP-6 withdraw", en: "SEP-38 quote + SEP-6 withdraw" },
  "nakit.adimOdeme": { tr: "USDC ödemesi", en: "USDC payment" },
  "nakit.adimAnchor": { tr: "Anchor TL gönderdi", en: "Anchor sent TRY" },
  // profil
  "profil.baslik": { tr: "Profil", en: "Profile" },
  "profil.hesap": { tr: "Hesap", en: "Account" },
  "profil.gHesabi": { tr: "G-hesabı", en: "G-account" },
  "profil.kilit": { tr: "Kilit", en: "Key storage" },
  "profil.passkeyPrf": { tr: "Passkey (PRF) ile şifreli", en: "Encrypted with passkey (PRF)" },
  "profil.duz": { tr: "Düz saklama · demo", en: "Plain storage · demo" },
  "profil.havuz": { tr: "Havuz", en: "Pool" },
  "profil.blend": { tr: "Blend v2 (kendi dağıtımımız)", en: "Blend v2 (self-hosted)" },
  "profil.hazecredit": { tr: "HazeCredit (yedek)", en: "HazeCredit (fallback)" },
  "profil.xlm": { tr: "XLM bakiyesi", en: "XLM balance" },
  "profil.sponsorlu": { tr: "0 · sponsorlu", en: "0 · sponsored" },
  "profil.maasKurali": { tr: "Maaş kuralı", en: "Salary rule" },
  "profil.maasNot": { tr: "Maaş USDC olarak gelince borç kapanır, kalan Kazan'a eklenir; RWA dağılımını (bono, altın, hisse) tek passkey onayıyla uygularsın.", en: "When salary arrives as USDC the debt is repaid and the rest goes to Earn; you apply the RWA allocation (treasuries, gold, stocks) with one passkey approval." },
  "profil.izin": { tr: "Vault USDC izni", en: "Vault USDC allowance" },
  "profil.dagilim": { tr: "Dağılım", en: "Allocation" },
  "profil.izniYenile": { tr: "İzni yenile", en: "Renew allowance" },
  "profil.anchorBagli": { tr: "Anchor: bağlı", en: "Anchor: connected" },
  "profil.anchorBaglan": { tr: "Anchor'a bağlan", en: "Connect anchor" },
  "profil.isveren": { tr: "İşveren paneli · demo", en: "Employer panel · demo" },
  "profil.isverenNot": { tr: "SEP-38 teklif → SEP-6 deposit-exchange → simulate-bank-transfer → testnet USDC → settle_salary.", en: "SEP-38 quote → SEP-6 deposit-exchange → simulate-bank-transfer → testnet USDC → settle_salary." },
  "profil.maasYatir": { tr: "₺ Maaş yatır", en: "₺ Pay salary" },
  "profil.maasGunu": { tr: "Maaş günü simülasyonu (settle_salary)", en: "Simulate payday (settle_salary)" },
  "profil.seffaflik": { tr: "Şeffaflık", en: "Transparency" },
  "profil.seffaflikNot": { tr: "Mock olanlar: TR Mock Anchor (testnet USDC gerçek), hUSDY/hXAU/hNVDA/hSHEL/hBMW/hTRY (biz bastık; mainnet karşılıkları Ondo USDY, Matrixdock XAUm, tokenize hisseler), Lithic sandbox kart, hızlandırılmış getiri ({n} gün/dk). Hukuki uyum kapsam dışı.", en: "What is mocked: TR Mock Anchor (testnet USDC is real), hUSDY/hXAU/hNVDA/hSHEL/hBMW/hTRY (issued by us; mainnet counterparts Ondo USDY, Matrixdock XAUm, tokenized stocks), Lithic sandbox card, accelerated yield ({n} days/min). Regulatory compliance is out of scope." },
  "profil.cikis": { tr: "Çıkış yap (cüzdanı bu cihazdan sil)", en: "Sign out (remove wallet from this device)" },
  "profil.kuralYetki": { tr: "Maaş kuralı yetkilendirildi", en: "Salary rule authorized" },
  "profil.yetkiYok": { tr: "Yetki verilemedi", en: "Authorization failed" },
  "profil.sep10Yenilendi": { tr: "Anchor kimliği yenilendi (SEP-10)", en: "Anchor login renewed (SEP-10)" },
  "profil.sep10Basarisiz": { tr: "SEP-10 başarısız", en: "SEP-10 failed" },
  "profil.logGonder": { tr: "İşveren paneli: TRY maaş gönderiliyor…", en: "Employer panel: sending TRY salary…" },
  "profil.logAnchor": { tr: "Anchor: {n} parça tamamlandı", en: "Anchor: {n} part(s) completed" },
  "profil.logKural": { tr: "Kural motoru", en: "Rule engine" },
  "profil.logHata": { tr: "Hata", en: "Error" },
  "profil.borcKapandi": { tr: "Maaş günü: borç kapatıldı", en: "Payday: debt repaid" },
  "profil.kapatilamadi": { tr: "Kapatılamadı", en: "Could not settle" },
  // hold durumları
  "hold.PENDING": { tr: "onaylandı", en: "approved" },
  "hold.BORROWED": { tr: "borç açıldı", en: "borrowed" },
  "hold.CLEARED": { tr: "kapandı", en: "cleared" },
  "hold.REFUNDED": { tr: "iade", en: "refunded" },
  "hold.FAILED": { tr: "hata", en: "failed" },
  "hold.DECLINED": { tr: "reddedildi", en: "declined" },
  // zaman
  "zaman.azOnce": { tr: "az önce", en: "just now" },
  "zaman.dk": { tr: "{n} dk önce", en: "{n} min ago" },
  "zaman.sa": { tr: "{n} sa önce", en: "{n} h ago" },
  // varlık açıklamaları
  "varlik.stable": { tr: "Blend supply faizi", en: "Blend supply interest" },
  "varlik.treasury": { tr: "Tokenize hazine bonosu · fiyat artar", en: "Tokenized treasuries · price accrues" },
  "varlik.gold": { tr: "Tokenize altın · değer koruma", en: "Tokenized gold · store of value" },
  "varlik.stock": { tr: "Tokenize hisse · {ad}", en: "Tokenized stock · {ad}" },
  // sunucu bildirimleri (kind → başlık; gövde data'dan)
  "bildirim.salary_received": { tr: "Maaş hesabına geçti", en: "Salary received" },
  "bildirim.salary_settled": { tr: "Maaş geldi", en: "Salary settled" },
  "bildirim.salary_settled.body": { tr: "{repaid} USDC borç kapandı, {added} USDC Kazan'a eklendi. RWA dağılımını onayla.", en: "{repaid} USDC debt repaid, {added} USDC added to Earn. Approve your RWA allocation." },
  "bildirim.salary_settled.bodyNoDebt": { tr: "{added} USDC Kazan'a eklendi. RWA dağılımını onayla.", en: "{added} USDC added to Earn. Approve your RWA allocation." },
  "bildirim.card_approved": { tr: "Kart onaylandı", en: "Card approved" },
  "bildirim.card_approved.body": { tr: "{usdc} USDC borç · kalan limit {limit} USDC", en: "{usdc} USDC borrowed · {limit} USDC limit left" },
  "bildirim.card_declined": { tr: "Kart reddedildi", en: "Card declined" },
  "bildirim.card_refunded": { tr: "İade", en: "Refund" },
  "bildirim.hold_failed": { tr: "Borç işlemi başarısız", en: "Borrow transaction failed" },
  "bildirim.allowance_renew": { tr: "Maaş izni yenilenmeli", en: "Salary allowance needs renewal" },
} satisfies Record<string, Entry>;

export type Key = keyof typeof STR;
const EN_NAME: Record<AssetCode, string> = { USDC: "USD Coin", hUSDY: "Treasuries", hXAU: "Gold", hNVDA: "NVIDIA", hSHEL: "Shell", hBMW: "BMW", hTRY: "Turkish lira" };

function fill(s: string, vars?: Record<string, string | number>) {
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? "" : String(vars[k]))) : s;
}

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: Key, vars?: Record<string, string | number>) => string;
  locale: string;
  assetName: (code: string) => string;
  assetBlurb: (code: string) => string;
  labelHold: (s: string) => string;
  ago: (ts: number) => string;
  /** sunucu bildirimini dile göre başlık/gövdeye çevirir */
  notif: (n: { kind: string; title: string; body: string; data: string | null }) => { title: string; body: string };
}
const Ctx = createContext<LangCtx | null>(null);
const KEY = "haze.lang";

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("tr");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY) as Lang | null;
      if (saved === "tr" || saved === "en") setLangState(saved);
      else if (typeof navigator !== "undefined" && !navigator.language.toLowerCase().startsWith("tr")) setLangState("en");
    } catch {
      /* */
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    setFormatLocale(lang === "tr" ? "tr-TR" : "en-US");
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* */
    }
  }, []);
  const value = useMemo<LangCtx>(() => {
    const t = (key: Key, vars?: Record<string, string | number>) => fill(STR[key][lang], vars);
    const locale = lang === "tr" ? "tr-TR" : "en-US";
    setFormatLocale(locale);
    const num = (v: number, d = 2) => v.toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
    const assetName = (code: string) => (lang === "en" ? EN_NAME[code as AssetCode] : ASSET_META[code as AssetCode]?.name) ?? code;
    const assetBlurb = (code: string) => {
      const m = ASSET_META[code as AssetCode];
      if (!m) return "";
      if (m.kind === "stock") return t("varlik.stock", { ad: assetName(code) });
      if (m.kind === "stable" || m.kind === "treasury" || m.kind === "gold") return t(`varlik.${m.kind}` as Key);
      return assetName(code);
    };
    const labelHold = (s: string) => (`hold.${s}` in STR ? t(`hold.${s}` as Key) : s);
    const ago = (ts: number) => {
      const d = (Date.now() - ts) / 1000;
      if (d < 60) return t("zaman.azOnce");
      if (d < 3600) return t("zaman.dk", { n: Math.floor(d / 60) });
      if (d < 86400) return t("zaman.sa", { n: Math.floor(d / 3600) });
      return new Date(ts).toLocaleDateString(locale);
    };
    const notif = (n: { kind: string; title: string; body: string; data: string | null }) => {
      if (lang === "tr") return { title: n.title, body: n.body };
      let data: Record<string, unknown> = {};
      try {
        data = n.data ? (JSON.parse(n.data) as Record<string, unknown>) : {};
      } catch {
        /* */
      }
      const f7 = (v: unknown) => (v == null ? undefined : num(Number(v) / 1e7));
      const titleKey = `bildirim.${n.kind}` as Key;
      const title = STR[titleKey] ? t(titleKey) : n.title;
      if (n.kind === "salary_settled" && data.added != null) {
        const repaid = Number(data.repaid ?? 0);
        return { title, body: repaid > 0 ? t("bildirim.salary_settled.body", { repaid: f7(data.repaid)!, added: f7(data.added)! }) : t("bildirim.salary_settled.bodyNoDebt", { added: f7(data.added)! }) };
      }
      if (n.kind === "card_approved" && data.usdc != null) {
        return { title: `${data.merchant ?? title}${data.merchantTry ? ` · ₺${data.merchantTry}` : ""}`, body: t("bildirim.card_approved.body", { usdc: f7(data.usdc)!, limit: f7(data.remainingLimit) ?? "" }) };
      }
      return { title, body: n.body };
    };
    return { lang, setLang, t, locale, assetName, assetBlurb, labelHold, ago, notif };
  }, [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLang(): LangCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("LangProvider yok");
  return c;
}

/** Dil seçici (TR / EN) */
export function DilSecici({ koyu = false }: { koyu?: boolean }) {
  const { lang, setLang } = useLang();
  return (
    <span className="dil" style={koyu ? { color: "#D8CBB2" } : undefined}>
      {(["tr", "en"] as Lang[]).map((l) => (
        <button key={l} className={`dil-btn${lang === l ? " aktif" : ""}`} onClick={() => setLang(l)} aria-pressed={lang === l}>
          {l.toUpperCase()}
        </button>
      ))}
    </span>
  );
}
