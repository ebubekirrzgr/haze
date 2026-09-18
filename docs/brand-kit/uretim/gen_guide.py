#!/usr/bin/env python3
# HAZE — Marka rehberi: logo, renk, tipografi, web ve mobil kullanım (R4 · Michroma).
import json
OUT = "/home/claude/haze-brand"
src = open(f"{OUT}/gen_r.py").read().split("HEAD = ")[0]
exec(src)  # brings build, build_icon, logo, icon_svg, measure_H, P ...

REL = "michroma/files/michroma-latin-400-normal.woff2"
B = build(REL)

C = dict(P)
C.update(metin="#3B3226", ikincil="#6B5B45", zeytin="#5E7F4F", kiremit="#B5523B", cizgi="#E2D7C1")

GLASS = ("background: rgba(251,248,241,0.46); backdrop-filter: blur(22px) saturate(140%); "
         "-webkit-backdrop-filter: blur(22px) saturate(140%); border: 1px solid rgba(255,255,255,0.65); "
         "box-shadow: 0 10px 36px rgba(59,50,38,0.08), inset 0 1px 0 rgba(255,255,255,0.7);")
GLASS_DARK = ("background: rgba(59,50,38,0.86); backdrop-filter: blur(24px) saturate(130%); "
              "-webkit-backdrop-filter: blur(24px) saturate(130%); border: 1px solid rgba(255,255,255,0.14); "
              "box-shadow: 0 12px 40px rgba(30,24,16,0.25), inset 0 1px 0 rgba(255,255,255,0.08);")
GLASS_WARM = ("background: rgba(234,223,200,0.55); backdrop-filter: blur(22px) saturate(140%); "
              "-webkit-backdrop-filter: blur(22px) saturate(140%); border: 1px solid rgba(255,255,255,0.55); "
              "box-shadow: 0 10px 36px rgba(59,50,38,0.08), inset 0 1px 0 rgba(255,255,255,0.6);")

BLOBS = {
    "light": [(-8, -12, 58, "rgba(200,162,74,0.55)"), (62, -18, 50, "rgba(235,217,207,0.95)"),
              (78, 52, 56, "rgba(200,162,74,0.35)"), (8, 60, 46, "rgba(241,230,207,1)"), (40, 30, 30, "rgba(235,217,207,0.7)")],
    "dark": [(-10, -10, 55, "rgba(200,162,74,0.45)"), (70, 40, 60, "rgba(138,109,47,0.55)"), (30, 70, 40, "rgba(235,217,207,0.18)")],
}
def atmos(kind="light", scale=1.0):
    base = "#F3EBDC" if kind == "light" else "#2E271F"
    dots = "".join(
        f'<div style="position: absolute; left: {x}%; top: {y}%; width: {w*scale:.0f}vmax; height: {w*scale:.0f}vmax; '
        f'border-radius: 50%; background: {c}; filter: blur(70px);"></div>' for x, y, w, c in BLOBS[kind])
    grain = ('<div style="position: absolute; inset: 0; opacity: 0.05; background-image: '
             'radial-gradient(rgba(59,50,38,0.9) 0.6px, transparent 0.6px); background-size: 3px 3px;"></div>')
    return (f'<div class="atmos" style="position: absolute; inset: 0; overflow: hidden; pointer-events: none; '
            f'z-index: 0; background: {base};">{dots}{grain}</div>')

def lum(h):
    r, g, b = [int(h[i:i+2], 16) / 255 for i in (1, 3, 5)]
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
def cr(a, b):
    la, lb = sorted([lum(a), lum(b)], reverse=True)
    return (la + 0.05) / (lb + 0.05)

HEAD = """<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Michroma&amp;family=Space+Grotesk:wght@300;400;500;600&amp;family=Cormorant+Garamond:ital,wght@0,500;1,500&amp;display=swap">
  <style>
    body { margin: 0; font-family: 'Space Grotesk', 'Helvetica Neue', Arial, sans-serif; color: #3B3226; }
    a { color: #6B5B45; } a:hover { color: #3B3226; }
    .num { font-variant-numeric: tabular-nums; }
    .gl > *:not(.atmos) { position: relative; z-index: 1; }
    .disp { font-family: 'Michroma', 'Eurostile', 'Helvetica Neue', Arial, sans-serif; font-weight: 400; }
  </style>
</helmet>
"""
TAIL = "\n</x-dc>\n</body>\n</html>\n"

def eyebrow(t, c="#6B5B45"):
    return f'<div style="font-size: 13px; font-weight: 500; letter-spacing: 0.16em; text-transform: uppercase; color: {c};">{t}</div>'

def sheet(w, h, bg, num, title, lead, body):
    return HEAD + f"""<div class="gl" style="width: {w}px; height: {h}px; box-sizing: border-box; padding: 64px 80px; background: {bg}; display: flex; flex-direction: column; gap: 48px; position: relative; overflow: hidden;">
  {atmos()}
  <div style="display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1px solid rgba(59,50,38,0.12); padding-bottom: 28px;">
    <div style="display: flex; flex-direction: column; gap: 12px;">
      {eyebrow("HAZE · Marka rehberi · " + num)}
      <div class="disp" style="font-size: 40px; line-height: 1.1;">{title}</div>
    </div>
    <div style="font-size: 16px; line-height: 1.55; color: {C['ikincil']}; max-width: 460px; text-align: right; text-wrap: pretty;">{lead}</div>
  </div>
  {body}
</div>""" + TAIL

def static_logo(color, width):
    return logo(B, color, width, anim=False)

# ---------- 01 LOGO ----------
def tile(bg, fg, label, border=False):
    r, g, b = [int(bg[i:i+2], 16) for i in (1, 3, 5)]
    a = 0.9 if (r + g + b) < 300 else 0.62
    bd = (f"background: rgba({r},{g},{b},{a}); backdrop-filter: blur(22px) saturate(140%); -webkit-backdrop-filter: blur(22px) saturate(140%); "
          "border: 1px solid rgba(255,255,255,0.45); box-shadow: 0 10px 36px rgba(59,50,38,0.10), inset 0 1px 0 rgba(255,255,255,0.35);")
    return f"""<div style="display: flex; flex-direction: column; gap: 10px;">
      <div style="height: 150px; {bd} border-radius: 14px; display: flex; align-items: center; justify-content: center;">{static_logo(fg, 300)}</div>
      <div style="font-size: 14px; color: {C['ikincil']};">{label}</div></div>"""

logo_body = f"""
  <div style="display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 32px; flex-grow: 1;">
    <div style="grid-column: span 8; {GLASS} border-radius: 16px; position: relative; display: flex; align-items: center; justify-content: center;">
      <div style="position: absolute; inset: 48px; border: 1px dashed #D8C9A8;"></div>
      {static_logo(C['metin'], 620)}
      <div style="position: absolute; left: 16px; bottom: 12px; font-size: 13px; color: {C['ikincil']};">Kesik çizgi: güvenli alan, en az bir "A" yüksekliği kadar boşluk</div>
    </div>
    <div style="grid-column: span 4; display: flex; flex-direction: column; gap: 22px; font-size: 16px; line-height: 1.55;">
      <div style="display: flex; flex-direction: column; gap: 6px;"><div style="font-weight: 600;">Fikir</div><div style="color: {C['ikincil']};">H'nin orta çizgisi bir büyüme grafiği: önce yatay seyir, sonra yükseliş. Gövde kalınlığı, çizgi yüksekliği ve kıvrımlar Michroma'nın kendi H harfinden türetildi.</div></div>
      <div style="display: flex; flex-direction: column; gap: 6px;"><div style="font-weight: 600;">En küçük boy</div><div style="color: {C['ikincil']};">Yazı logosu en az 110px genişlikte (baskıda 28mm). Daha küçük alanlarda yalnız ikon kullanılır.</div></div>
      <div style="display: flex; flex-direction: column; gap: 6px;"><div style="font-weight: 600;">Yapılmayacaklar</div><div style="color: {C['ikincil']};">Çizgiyi kısaltıp uzatmak, eğmek, gölge ya da gradyan eklemek, harfleri başka fontla değiştirmek.</div></div>
      <div style="display: flex; gap: 16px; align-items: center; margin-top: auto;">
        {icon_svg(REL, 96, C['metin'], C['altin'])}{icon_svg(REL, 64, C['altin'], C['fildisi'])}{icon_svg(REL, 40, C['kum'], C['metin'])}{icon_svg(REL, 24, C['metin'], C['altin'])}
      </div>
      <div style="font-size: 13px; color: {C['ikincil']};">Uygulama ikonu · 96 / 64 / 40 / 24</div>
    </div>
  </div>
  <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 24px;">
    {tile(C['kum'], C['metin'], "Birincil · sepya, kum zemin")}
    {tile(C['metin'], C['altin'], "Ters · altın, sepya zemin")}
    {tile(C['altin'], C['fildisi'], "Vurgu · fildişi, altın zemin")}
    {tile(C['fildisi'], C['altin'], "Açık · altın, fildişi zemin (yalnız büyük boy)", True)}
  </div>"""
open(f"{OUT}/RehberLogo.dc.html", "w").write(sheet(1440, 1000, C["krem"], "01", "Logo",
    "Tek bir çizgi, tek bir hikâye: paran yatay seyirden yükselişe geçiyor.", logo_body))

# ---------- 02 RENK ----------
def swatch(name, hexv, role, text_on, span=1, h=180):
    return f"""<div style="grid-column: span {span}; display: flex; flex-direction: column; {GLASS} border-radius: 14px; overflow: hidden;">
      <div style="height: {h}px; background: {hexv}; display: flex; align-items: flex-end; padding: 16px; box-sizing: border-box; color: {text_on}; font-size: 30px; font-weight: 400;">Aa</div>
      <div style="padding: 14px 16px; display: flex; flex-direction: column; gap: 4px;">
        <div style="display: flex; justify-content: space-between;"><div style="font-weight: 600; font-size: 16px;">{name}</div><div class="num" style="font-size: 14px; color: {C['ikincil']};">{hexv}</div></div>
        <div style="font-size: 14px; color: {C['ikincil']};">{role}</div>
      </div></div>"""

ratio_row = [("Kum / krem zeminler", 60, C["kum"]), ("Sepya metin", 25, C["metin"]), ("Altın vurgu", 10, C["altin"]), ("İşlev renkleri", 5, C["zeytin"])]
bar = "".join(f'<div style="flex-grow: {v}; background: {c}; height: 28px;"></div>' for _, v, c in ratio_row)
bar_lab = "".join(f'<div style="display: flex; gap: 8px; align-items: center;"><div style="width: 12px; height: 12px; border-radius: 2px; background: {c};"></div>{n} · %{v}</div>' for n, v, c in ratio_row)
pairs = [("Sepya", C["metin"], "Krem", C["krem"]), ("İkincil metin", C["ikincil"], "Krem", C["krem"]),
         ("Altın", C["altin"], "Sepya", C["metin"]), ("Sepya", C["metin"], "Altın", C["altin"]),
         ("Altın", C["altin"], "Krem", C["krem"])]
def verdict(r):
    return "AA ✓ her metin" if r >= 4.5 else ("Yalnız büyük başlık ve logo" if r >= 3 else "Metinde kullanma")
contrast = "".join(f"""<div style="display: flex; align-items: center; gap: 14px; padding: 10px 0; border-bottom: 1px solid {C['cizgi']};">
      <div style="width: 64px; height: 36px; border-radius: 4px; background: {b}; color: {f}; display: flex; align-items: center; justify-content: center; font-weight: 600;">Aa</div>
      <div style="flex-grow: 1; font-size: 15px;">{fn} / {bn}</div>
      <div class="num" style="font-size: 15px; font-weight: 600; width: 64px;">{cr(f, b):.1f}:1</div>
      <div style="font-size: 14px; color: {C['ikincil']}; width: 200px;">{verdict(cr(f, b))}</div></div>""" for fn, f, bn, b in pairs)

renk_body = f"""
  <div style="display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 20px;">
    {swatch("Altın", C['altin'], "Ana marka rengi · logo, vurgu, grafik çizgisi", C['metin'], 2, 220)}
    {swatch("Sepya", C['metin'], "Metin, koyu zemin, birincil buton", C['altin'], 2, 220)}
    {swatch("Kum", C['kum'], "Kartlar, ikincil yüzeyler", C['metin'], 2, 220)}
    {swatch("Fildişi", C['fildisi'], "En açık yüzey", C['metin'])}
    {swatch("Krem", C['krem'], "Sayfa zemini", C['metin'])}
    {swatch("Şampanya", C['sampanya'], "Vurgulu alanlar", C['metin'])}
    {swatch("Pudra", C['pudra'], "Sıcak vurgu, rozetler", C['metin'])}
    {swatch("Bronz", C['bronz'], "İkonlar, ince detaylar", C['fildisi'])}
    {swatch("İkincil metin", C['ikincil'], "Açıklamalar, etiketler", C['fildisi'])}
  </div>
  <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 48px;">
    <div style="display: flex; flex-direction: column; gap: 16px;">
      <div style="font-weight: 600; font-size: 18px;">Kullanım oranı</div>
      <div style="display: flex; border-radius: 4px; overflow: hidden;">{bar}</div>
      <div style="display: flex; flex-wrap: wrap; gap: 20px; font-size: 14px; color: {C['ikincil']};">{bar_lab}</div>
      <div style="font-weight: 600; font-size: 18px; margin-top: 16px;">İşlev renkleri</div>
      <div style="display: flex; gap: 16px;">
        <div style="flex-grow: 1; padding: 14px 16px; border-radius: 6px; background: rgba(94,127,79,0.14); backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.5); color: {C['zeytin']}; font-weight: 600;">Getiri · kazanç {C['zeytin']}</div>
        <div style="flex-grow: 1; padding: 14px 16px; border-radius: 6px; background: rgba(181,82,59,0.12); backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.5); color: {C['kiremit']}; font-weight: 600;">Uyarı · hata {C['kiremit']}</div>
      </div>
    </div>
    <div style="display: flex; flex-direction: column; gap: 4px;">
      <div style="font-weight: 600; font-size: 18px; margin-bottom: 8px;">Kontrast (WCAG)</div>
      {contrast}
    </div>
  </div>"""
open(f"{OUT}/RehberRenk.dc.html", "w").write(sheet(1440, 1180, C["krem"], "02", "Renk",
    "Altın vurgular, krem nefes aldırır, sepya okutur. Altın asla küçük metin rengi olmaz.", renk_body))

# ---------- 03 TİPOGRAFİ ----------
scale = [("Display", "Michroma 40 / 1.15", "40px", "400", "0", "Maaşın dolarda.", True),
         ("Başlık 1", "Michroma 28 / 1.2", "28px", "400", "0", "Paran çalışıyor", True),
         ("Bakiye", "Michroma 32 / rakam", "32px", "400", "0", "$1.284,50", True),
         ("Başlık 2", "Space Grotesk 26 / 500", "26px", "500", "0", "Son işlemler", False),
         ("Gövde", "Space Grotesk 17 / 1.55", "17px", "400", "0", "Maaşın yattığı an USDC'ye çevrilir, boşta kalan bakiye getiri üretir.", False),
         ("Etiket", "Space Grotesk 13 / 500 / +16%", "13px", "500", "0.16em", "TOPLAM BAKİYE", False)]
rows = "".join(f"""<div style="display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 24px; align-items: baseline; padding: 14px 0; border-bottom: 1px solid rgba(59,50,38,0.12);">
      <div style="display: flex; flex-direction: column; gap: 2px;"><div style="font-weight: 600; font-size: 15px;">{n}</div><div class="num" style="font-size: 13px; color: {C['ikincil']};">{spec}</div></div>
      <div class="{'disp num' if dsp else ''}" style="font-size: {fs}; font-weight: {fw}; letter-spacing: {ls}; line-height: 1.15; {'text-transform: uppercase;' if n == 'Etiket' else ''}">{ex}</div></div>""" for n, spec, fs, fw, ls, ex, dsp in scale)
tipo_body = f"""
  <div style="display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 48px;">
    <div style="grid-column: span 5; display: flex; flex-direction: column; gap: 28px;">
      <div style="{GLASS_DARK} color: {C['krem']}; border-radius: 14px; padding: 28px; display: flex; flex-direction: column; gap: 10px;">
        {eyebrow("Marka fontu · logo, başlık, büyük rakam", C['altin'])}
        <div class="disp" style="font-size: 48px; line-height: 1.05;">Michroma</div>
        <div class="disp" style="font-size: 20px;">Aa Bb Çç Ğğ İı Öö Şş Üü</div>
        <div class="disp num" style="font-size: 20px; color: {C['altin']};">0123456789 ₺ $ %</div>
        <div style="font-size: 15px; line-height: 1.5; color: #D8CBB2;">Geniş ve teknik; tek ağırlık. Uzun metinde ve 16px altında kullanılmaz.</div>
      </div>
      <div style="{GLASS_WARM} border-radius: 14px; padding: 28px; display: flex; flex-direction: column; gap: 10px;">
        {eyebrow("Arayüz fontu · metin, buton, etiket")}
        <div style="font-size: 44px; font-weight: 300; letter-spacing: -0.02em; line-height: 1;">Space Grotesk</div>
        <div style="font-size: 20px;">Aa Bb Çç Ğğ İı Öö Şş Üü · <span class="num">0123456789</span></div>
        <div style="font-size: 15px; line-height: 1.5; color: {C['ikincil']};">Michroma'nın geometrisine uyan sade grotesk. Ağırlıklar 300 / 400 / 500.</div>
      </div>
      <div style="{GLASS} border-radius: 6px; padding: 28px; display: flex; flex-direction: column; gap: 10px;">
        {eyebrow("Eşlik eden font · yalnız pazarlama")}
        <div style="font-family: 'Cormorant Garamond', Georgia, serif; font-size: 44px; font-weight: 500; line-height: 1;">Cormorant <span style="font-style: italic;">Garamond</span></div>
        <div style="font-family: 'Cormorant Garamond', Georgia, serif; font-style: italic; font-size: 24px; color: {C['bronz']};">"Arkada akış, önde sakinlik."</div>
        <div style="font-size: 15px; line-height: 1.55; color: {C['ikincil']};">Web sitesinde, sunumda ve sosyal medyada alıntı ve vurgu için. Uygulama arayüzünde kullanılmaz.</div>
      </div>
    </div>
    <div style="grid-column: span 7; display: flex; flex-direction: column;">
      <div style="font-weight: 600; font-size: 18px; margin-bottom: 8px;">Tip ölçeği</div>
      {rows}
      <div style="font-size: 14px; line-height: 1.55; color: {C['ikincil']}; margin-top: 16px;">Uygulama içi taban 17px, web taban 18px. Satır uzunluğu 60–75 karakter. Üç fontta da Türkçe karakterlerin tamamı var. Michroma başlıklar kısa tutulur (en fazla 4-5 kelime).</div>
    </div>
  </div>"""
open(f"{OUT}/RehberTipo.dc.html", "w").write(sheet(1440, 1080, C["krem"], "03", "Tipografi",
    "Karakteri Michroma verir, okunurluğu Space Grotesk taşır, Cormorant pazarlamada şiir katar.", tipo_body))

# ---------- shared UI bits ----------
def chart_svg(w, h, color, fill):
    # logo-shaped growth line: flat, quarter-curve, rise
    y0, y1 = h * 0.78, h * 0.12
    x1 = w * 0.62
    r = min(w - x1, y0 - y1) * 0.9
    d = f"M0 {y0:.0f} H{x1:.0f} A{r:.0f} {r:.0f} 0 0 0 {x1 + r:.0f} {y0 - r:.0f} L{w - 4:.0f} {y1:.0f}"
    area = d + f" V{h} H0 Z"
    return (f'<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}"><path d="{area}" fill="{fill}"></path>'
            f'<path d="{d}" fill="none" stroke="{color}" stroke-width="3"></path>'
            f'<circle cx="{w - 4}" cy="{y1:.0f}" r="6" fill="{color}"></circle></svg>')

ICON_SWAP = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h14l-4-4"></path><path d="M20 16H6l4 4"></path></svg>'
ICON_CARD = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"></rect><path d="M3 10h18"></path><path d="M7 15h3"></path></svg>'
ICON_ARROW = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path><path d="M13 6l6 6-6 6"></path></svg>'
ICON_DOWN = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"></path><path d="M6 13l6 6 6-6"></path></svg>'
DEMO = f'<div style="height: 26px; padding: 0 10px; border-radius: 13px; background: {C["pudra"]}; color: {C["kiremit"]}; display: flex; align-items: center; font-size: 11px; font-weight: 600; letter-spacing: 0.1em;">DEMO MODU</div>'

# ---------- 04 WEB ----------
steps = [("01", "Maaşın yatar", "TL maaşın hesaba düştüğü an USDC'ye çevrilir. Tek işlem, tek onay."),
         ("02", "Paran çalışır", "Boşta kalan bakiye Blend ve DeFindex'te getiri üretir."),
         ("03", "TL ile harcarsın", "Kartla ödediğinde USDC, anında TL'ye döner. Satıcı TL görür.")]
step_html = "".join(f"""<div style="display: flex; flex-direction: column; gap: 14px; padding: 32px; {GLASS} border-radius: 8px;">
      <div class="num" style="font-size: 15px; color: {C['bronz']}; font-weight: 500;">{n}</div>
      <div class="disp" style="font-size: 22px; line-height: 1.25;">{t}</div>
      <div style="font-size: 17px; line-height: 1.55; color: {C['ikincil']};">{d}</div></div>""" for n, t, d in steps)
web = HEAD + f"""<div class="gl" style="width: 1440px; min-height: 2000px; background: {C['krem']}; display: flex; flex-direction: column; position: relative; overflow: hidden;">
  {atmos("light", 0.9)}
  <div style="height: 76px; margin: 16px 24px 0; padding: 0 56px; border-radius: 38px; display: flex; align-items: center; justify-content: space-between; {GLASS}">
    {static_logo(C['metin'], 150)}
    <div style="display: flex; gap: 40px; font-size: 16px; color: {C['ikincil']};"><div>Nasıl çalışır</div><div>Getiri</div><div>Güvenlik</div><div>SSS</div></div>
    <div style="height: 48px; padding: 0 22px; border-radius: 24px; background: {C['metin']}; color: {C['krem']}; display: flex; align-items: center; font-size: 16px; font-weight: 500;">Erken erişim</div>
  </div>
  <div style="padding: 96px 80px 56px; display: flex; flex-direction: column; gap: 40px;">
    {eyebrow("Stellar üzerinde · TL ve USDC")}
    <div style="display: flex; justify-content: space-between; align-items: flex-end; gap: 64px;">
      <div class="disp" style="font-size: 48px; line-height: 1.2; max-width: 900px;">Maaşın TL gelir.<br><span style="color: {C['bronz']};">Değeri dolarda kalır.</span></div>
      <div style="display: flex; flex-direction: column; gap: 24px; max-width: 380px;">
        <div style="font-size: 18px; line-height: 1.55; color: {C['ikincil']};">HAZE maaşını yattığı an USDC'ye çevirir, boşta kalan bakiyeni getiriye yönlendirir, kartla öderken TL'ye döner.</div>
        <div style="display: flex; gap: 12px;">
          <div style="height: 56px; padding: 0 26px; border-radius: 28px; background: {C['metin']}; color: {C['krem']}; display: flex; align-items: center; gap: 10px; font-size: 17px; font-weight: 500;">Erken erişime katıl {ICON_ARROW}</div>
          <div style="height: 56px; padding: 0 22px; border-radius: 28px; border: 1.5px solid {C['metin']}; display: flex; align-items: center; font-size: 17px; font-weight: 500;">Nasıl çalışır</div>
        </div>
      </div>
    </div>
    <div style="padding-top: 40px;">{logo(B, C['altin'], 1280, anim=True, uid="w")}</div>
  </div>
  <div style="padding: 56px 80px 96px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px;">{step_html}</div>
  <div style="margin: 0 80px; padding: 56px; {GLASS_DARK} color: {C['krem']}; border-radius: 24px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 56px; align-items: center;">
    <div style="display: flex; flex-direction: column; gap: 20px;">
      {eyebrow("Bugün TL'de kalsaydın", C['altin'])}
      <div style="font-family: 'Cormorant Garamond', Georgia, serif; font-size: 54px; line-height: 1.05; font-weight: 500;">Aynı maaş, <span style="font-style: italic; color: {C['altin']};">iki farklı gelecek.</span></div>
      <div style="font-size: 17px; line-height: 1.55; color: #D8CBB2;">Uygulama her gün, maaşın TL'de kalsaydı ne kadar edeceğini ve HAZE'de ne kadar ettiğini yan yana gösterir.</div>
    </div>
    <div style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 18px; padding: 28px; display: flex; flex-direction: column; gap: 16px;">
      <div style="display: flex; justify-content: space-between; font-size: 15px; color: #D8CBB2;"><div>HAZE bakiyesi</div><div class="num">[ÖRNEK DÖNEM]</div></div>
      {chart_svg(480, 200, C['altin'], "rgba(200,162,74,0.14)")}
      <div style="display: flex; justify-content: space-between; font-size: 15px;"><div style="color: #D8CBB2;">TL'de kalsaydı</div><div class="num" style="color: {C['altin']};">[FARK %]</div></div>
    </div>
  </div>
  <div style="padding: 96px 80px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 48px;">
    <div style="display: flex; flex-direction: column; gap: 10px;"><div class="disp" style="font-size: 19px; line-height: 1.3;">Tek işlemde çeviri</div><div style="font-size: 17px; line-height: 1.55; color: {C['ikincil']};">Stellar'ın yol ödemesi (path payment) kur çevirisini tek adımda yapar; ek onay ya da aracı yok.</div></div>
    <div style="display: flex; flex-direction: column; gap: 10px;"><div class="disp" style="font-size: 19px; line-height: 1.3;">Cüzdanda XLM gerekmez</div><div style="font-size: 17px; line-height: 1.55; color: {C['ikincil']};">Hesap rezervleri HAZE tarafından karşılanır; kullanıcı yalnız kendi parasını görür.</div></div>
    <div style="display: flex; flex-direction: column; gap: 10px;"><div class="disp" style="font-size: 19px; line-height: 1.3;">Şeffaf kur</div><div style="font-size: 17px; line-height: 1.55; color: {C['ikincil']};">Her çeviriden önce kur ve alacağın tutar net olarak gösterilir.</div></div>
  </div>
  <div style="padding: 40px 80px; border-top: 1px solid rgba(59,50,38,0.12); display: flex; justify-content: space-between; align-items: center; font-size: 14px; color: {C['ikincil']};">
    {static_logo(C['metin'], 110)}<div>Stellar hackathonu için hazırlandı · [YIL]</div>
  </div>
</div>""" + TAIL
open(f"{OUT}/RehberWeb.dc.html", "w").write(web)

# ---------- 05 MOBİL ----------
def once(svg):
    return svg.replace(" infinite", " 1 forwards")

def phone(inner, bg):
    kind = "dark" if bg == C['metin'] else "light"
    return f"""<div class="gl" style="width: 390px; height: 844px; flex-shrink: 0; border-radius: 48px; border: 10px solid {C['metin']}; background: {bg}; overflow: hidden; box-sizing: content-box; display: flex; flex-direction: column; position: relative; box-shadow: 0 30px 80px rgba(59,50,38,0.25);">{atmos(kind, 0.3)}{inner}</div>"""

def ic(path, size=22, sw=1.8):
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="{sw}" '
            f'stroke-linecap="round" stroke-linejoin="round">{path}</svg>')
P_HOME = '<path d="M3 11l9-7 9 7"></path><path d="M5 10v10h14V10"></path>'
P_CHART = '<path d="M3 17h7a4 4 0 0 0 4-4V7"></path><path d="M14 7h7"></path><path d="M3 21h18"></path>'
P_CARD = '<rect x="3" y="6" width="18" height="13" rx="2"></rect><path d="M3 10h18"></path><path d="M7 15h3"></path>'
P_USER = '<circle cx="12" cy="8" r="4"></circle><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"></path>'
P_BELL = '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"></path><path d="M10 21h4"></path>'
P_SWAP = '<path d="M4 8h14l-4-4"></path><path d="M20 16H6l4 4"></path>'
P_DOWN = '<path d="M12 5v14"></path><path d="M6 13l6 6 6-6"></path>'
P_BOLT = '<path d="M13 3L5 14h6l-1 7 8-11h-6z"></path>'
P_SHIELD = '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"></path>'
P_BACK = '<path d="M15 5l-7 7 7 7"></path>'
P_COFFEE = '<path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"></path><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17"></path>'
P_BAG = '<path d="M5 8h14l-1 12H6z"></path><path d="M9 8a3 3 0 0 1 6 0"></path>'

def top(left, dark=False):
    return f"""<div style="padding: 58px 22px 0; display: flex; justify-content: space-between; align-items: center; height: 36px;">{left}{DEMO}</div>"""

def back(dark=False):
    col = C['kum'] if dark else C['ikincil']
    return f'<div style="display: flex; align-items: center; gap: 4px; font-size: 16px; color: {col};">{ic(P_BACK, 18)}Geri</div>'

def row(label, value, dark=False, strong=False):
    lc = "#D8CBB2" if dark else C['ikincil']
    return (f'<div style="display: flex; justify-content: space-between; align-items: center; font-size: 14px; height: 30px;">'
            f'<div style="color: {lc};">{label}</div><div class="num" style="font-weight: {600 if strong else 500};">{value}</div></div>')

def txn(icon, title, sub, amt, col):
    return f"""<div style="display: flex; align-items: center; gap: 12px; height: 54px; border-bottom: 1px solid rgba(59,50,38,0.1);">
      <div style="width: 36px; height: 36px; border-radius: 18px; background: rgba(200,162,74,0.16); color: {C['bronz']}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">{ic(icon, 18)}</div>
      <div style="display: flex; flex-direction: column; gap: 1px; flex-grow: 1; min-width: 0;"><div style="font-size: 15px; font-weight: 500;">{title}</div><div style="font-size: 12px; color: {C['ikincil']};">{sub}</div></div>
      <div class="num" style="font-size: 15px; font-weight: 500; color: {col}; white-space: nowrap;">{amt}</div></div>"""

def big_btn(label, bg, fg, icon=None, h=64):
    i = ic(icon, 20) if icon else ""
    return f'<div style="height: {h}px; border-radius: 22px; background: {bg}; color: {fg}; display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 18px; font-weight: 500;">{i}{label}</div>'

# 1 · Açılış
feat = "".join(f"""<div style="display: flex; align-items: center; gap: 12px; font-size: 14px; color: {C['krem']};">
      <div style="width: 32px; height: 32px; border-radius: 16px; background: rgba(200,162,74,0.18); color: {C['altin']}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">{ic(p_, 16)}</div>{t}</div>"""
    for p_, t in [(P_SWAP, "TL ve USDC arasında tek adımda çeviri"), (P_CHART, "Boştaki bakiyen getiri üretir"), (P_SHIELD, "Cüzdanında XLM tutman gerekmez")])
splash = f"""
  {top('<div></div>')}
  <div style="flex-grow: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 0 28px;">
    {once(logo(B, C['altin'], 280, anim=True, uid="m"))}
    <div style="font-family: 'Cormorant Garamond', Georgia, serif; font-style: italic; font-size: 21px; color: #D8CBB2;">Arkada akış, önde sakinlik.</div>
  </div>
  <div style="padding: 0 28px; display: flex; flex-direction: column; gap: 12px;">
    <div class="disp" style="font-size: 22px; line-height: 1.3; color: {C['krem']};">Maaşın TL gelir,<br>değeri dolarda kalır.</div>
    <div style="font-size: 14px; line-height: 1.5; color: #D8CBB2;">Maaşın yattığı an USDC'ye çevrilir; kartla öderken yeniden TL olur.</div>
  </div>
  <div style="padding: 20px 28px 0; display: flex; flex-direction: column; gap: 10px;">{feat}</div>
  <div style="padding: 24px 22px 0; display: flex; flex-direction: column; gap: 6px;">
    {big_btn("Hesap oluştur", C['altin'], C['metin'], h=64)}
    <div style="height: 44px; display: flex; align-items: center; justify-content: center; font-size: 15px; color: {C['krem']};">Zaten hesabım var</div>
  </div>
  <div style="padding: 2px 0 26px; text-align: center; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #A8997E;">Stellar üzerinde çalışır</div>"""

# 2 · Ana sayfa
tab = "".join(f"""<div style="display: flex; flex-direction: column; align-items: center; gap: 3px; font-size: 11px; font-weight: {600 if a_ else 400}; color: {C['metin'] if a_ else C['ikincil']}; width: 64px;">{ic(p_, 22, 2 if a_ else 1.6)}{t}</div>"""
    for p_, t, a_ in [(P_HOME, "Ana sayfa", True), (P_CHART, "Getiri", False), (P_CARD, "Kart", False), (P_USER, "Profil", False)])
home = f"""
  {top(f'<div style="display: flex; align-items: center; gap: 10px;">{static_logo(C["metin"], 92)}</div>')}
  <div style="padding: 18px 22px 0; display: flex; justify-content: space-between; align-items: flex-end;">
    <div style="display: flex; flex-direction: column; gap: 4px;">
      <div style="font-size: 12px; font-weight: 500; letter-spacing: 0.14em; text-transform: uppercase; color: {C['ikincil']};">Toplam bakiye</div>
      <div class="disp num" style="font-size: 30px; line-height: 1.15;">$1.284,50</div>
      <div style="display: flex; gap: 10px; font-size: 13px;"><div class="num" style="color: {C['ikincil']};">≈ ₺52.340</div><div style="color: {C['zeytin']}; font-weight: 600;">+%4,2 yıllık</div></div>
    </div>
    <div style="width: 40px; height: 40px; border-radius: 20px; {GLASS} display: flex; align-items: center; justify-content: center; color: {C['metin']};">{ic(P_BELL, 18)}</div>
  </div>
  <div style="padding: 16px 22px 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;">
    {big_btn("Çevir", C['metin'], C['krem'], P_SWAP)}{big_btn("Harca", C['altin'], C['metin'], P_CARD)}
  </div>
  <div style="margin: 14px 22px 0; padding: 14px 16px 12px; {GLASS} border-radius: 20px; display: flex; flex-direction: column; gap: 6px;">
    <div style="display: flex; justify-content: space-between; align-items: baseline;"><div style="font-size: 14px; font-weight: 600;">Getiri · Blend</div><div class="num" style="font-size: 14px; color: {C['zeytin']}; font-weight: 600;">+$42,10 bu ay</div></div>
    {chart_svg(304, 78, C['altin'], "rgba(200,162,74,0.14)")}
    <div style="display: flex; justify-content: space-between; font-size: 12px; color: {C['ikincil']};"><div>Son 6 ay</div><div>TL'de kalsaydı <span class="num" style="color: {C['kiremit']}; font-weight: 600;">−%18</span></div></div>
  </div>
  <div style="padding: 16px 22px 2px; display: flex; justify-content: space-between; align-items: baseline;"><div style="font-size: 16px; font-weight: 600;">Son işlemler</div><div style="font-size: 13px; color: {C['bronz']};">Tümü</div></div>
  <div style="padding: 0 22px;">
    {txn(P_SWAP, "Maaş", "TL → USDC · otomatik · bugün", "+$1.020,00", C['zeytin'])}
    {txn(P_COFFEE, "Kahve", "POS · TL ile ödendi · 09:12", "−₺145", C['metin'])}
    {txn(P_BAG, "Market", "POS · TL ile ödendi · dün", "−₺860", C['metin'])}
  </div>
  <div style="flex-grow: 1;"></div>
  <div style="margin: 0 14px 22px; height: 64px; border-radius: 32px; {GLASS} display: flex; align-items: center; justify-content: space-around;">{tab}</div>"""

# 3 · Çevir
def field(label, cur, amt, bal):
    return f"""<div style="padding: 14px 16px; {GLASS} border-radius: 18px; display: flex; flex-direction: column; gap: 6px;">
      <div style="display: flex; justify-content: space-between; font-size: 12px; color: {C['ikincil']};"><div>{label}</div><div class="num">{bal}</div></div>
      <div style="display: flex; justify-content: space-between; align-items: center;"><div class="disp num" style="font-size: 24px;">{amt}</div>
      <div style="height: 32px; padding: 0 12px; border-radius: 16px; background: rgba(234,223,200,0.85); display: flex; align-items: center; font-weight: 600; font-size: 14px;">{cur}</div></div></div>"""
chips = "".join(f'<div style="height: 34px; padding: 0 12px; border-radius: 17px; {GLASS} display: flex; align-items: center; font-size: 13px; font-weight: {600 if a_ else 500}; {"outline: 1.5px solid " + C["metin"] + ";" if a_ else ""}">{t}</div>'
    for t, a_ in [("₺1.000", False), ("₺5.000", False), ("₺10.000", True), ("Tümü", False)])
convert = f"""
  {top(back())}
  <div style="padding: 14px 22px 0; display: flex; flex-direction: column; gap: 4px;">
    <div class="disp" style="font-size: 24px;">Çevir</div>
    <div style="font-size: 14px; color: {C['ikincil']};">TL'den dolara, tek adımda.</div>
  </div>
  <div style="padding: 16px 22px 0; display: flex; flex-direction: column; gap: 6px;">
    {field("Gönderilen", "TRY", "₺10.000", "Bakiye ₺12.400")}
    <div style="align-self: center; width: 40px; height: 40px; margin: -24px 0; z-index: 2; border-radius: 20px; background: {C['metin']}; color: {C['altin']}; display: flex; align-items: center; justify-content: center; border: 3px solid rgba(251,248,241,0.9);">{ic(P_DOWN, 18)}</div>
    {field("Alınan", "USDC", "$245,10", "Tahmini")}
  </div>
  <div style="padding: 12px 22px 0; display: flex; gap: 8px; justify-content: space-between;">{chips}</div>
  <div style="margin: 12px 22px 0; padding: 6px 16px; {GLASS} border-radius: 18px;">
    {row("Kur", "1 USDC = ₺40,80")}{row("Ağ ücreti", "HAZE karşılar")}{row("İşlem", "Tek adım · path payment")}{row("Tahmini süre", "≈ 5 sn")}
  </div>
  <div style="margin: 10px 22px 0; padding: 12px 16px; {GLASS} border-radius: 18px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
    <div style="display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 14px; font-weight: 600;">Maaşımı otomatik çevir</div><div style="font-size: 12px; color: {C['ikincil']};">Her maaş gününde tamamı USDC'ye</div></div>
    <div style="width: 48px; height: 28px; border-radius: 14px; background: {C['zeytin']}; position: relative; flex-shrink: 0;"><div style="position: absolute; right: 3px; top: 3px; width: 22px; height: 22px; border-radius: 11px; background: #FFFFFF;"></div></div>
  </div>
  <div style="flex-grow: 1;"></div>
  <div style="padding: 0 22px 26px;">{big_btn("₺10.000 çevir", C['metin'], C['krem'], P_SWAP, h=72)}</div>"""

# 4 · POS ödeme
pay = f"""
  {top(back(True))}
  <div style="padding: 10px 0 0; text-align: center; font-size: 13px; font-weight: 500; letter-spacing: 0.14em; text-transform: uppercase; color: #A8997E;">Ödeme onayı</div>
  <div style="padding: 18px 28px 0; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; color: {C['krem']};">
    <div style="width: 60px; height: 60px; border-radius: 30px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.16); color: {C['altin']}; display: flex; align-items: center; justify-content: center;">{ic(P_COFFEE, 24)}</div>
    <div style="font-size: 16px; font-weight: 600;">[İşletme adı]</div>
    <div style="font-size: 13px; color: #D8CBB2;">Temassız ödeme · POS</div>
    <div class="disp num" style="font-size: 36px; margin-top: 6px;">₺145,00</div>
    <div style="font-size: 13px; line-height: 1.5; color: #D8CBB2; max-width: 270px;">USDC bakiyenden ödenir, satıcıya TL olarak ulaşır.</div>
  </div>
  <div style="margin: 18px 22px 0; padding: 8px 16px; border-radius: 20px; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.14); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); color: {C['krem']};">
    {row("Kur", "1 USDC = ₺40,80", True)}{row("Bakiyenden düşecek", "$3,55", True, True)}{row("Kalan bakiye", "$1.280,95", True)}{row("Kart", "HAZE •••• [son 4]", True)}{row("Onay süresi", "≈ 5 sn", True)}
  </div>
  <div style="margin: 12px 22px 0; display: flex; align-items: center; gap: 10px; font-size: 12px; color: #D8CBB2;">{ic(P_SHIELD, 16)}Ödeme, onayın olmadan gerçekleşmez.</div>
  <div style="flex-grow: 1;"></div>
  <div style="padding: 0 22px 22px; display: flex; flex-direction: column; gap: 4px;">
    {big_btn("Onayla ve öde", C['altin'], C['metin'], P_BOLT, h=72)}
    <div style="height: 44px; display: flex; align-items: center; justify-content: center; font-size: 15px; color: {C['kum']};">İptal</div>
  </div>"""

mob = HEAD + f"""<div class="gl" style="width: 1920px; height: 1100px; box-sizing: border-box; padding: 60px 80px; background: {C['kum']}; display: flex; flex-direction: column; gap: 36px; position: relative; overflow: hidden;">
  {atmos("light")}
  <div style="display: flex; justify-content: space-between; align-items: flex-end;">
    <div style="display: flex; flex-direction: column; gap: 12px;">{eyebrow("HAZE · Marka rehberi · 05")}<div class="disp" style="font-size: 40px; line-height: 1.1;">Mobil uygulama</div></div>
    <div style="font-size: 16px; line-height: 1.55; color: {C['ikincil']}; max-width: 560px; text-align: right;">Açılış, ana sayfa, çevirme ve POS ödeme. Ana butonlar başparmak bölgesinde; rakamlar örnektir, köşeli parantezler doldurulacak.</div>
  </div>
  <div style="display: flex; gap: 40px; justify-content: space-between;">
    {phone(splash, C['metin'])}{phone(home, C['krem'])}{phone(convert, C['krem'])}{phone(pay, C['metin'])}
  </div>
</div>""" + TAIL
open(f"{OUT}/RehberMobil.dc.html", "w").write(mob)

layout = [
    {"file": "RehberLogo.dc.html", "title": "01 · Logo", "x": 0, "y": 0, "w": 1440, "h": 1000},
    {"file": "RehberRenk.dc.html", "title": "02 · Renk", "x": 0, "y": 1120, "w": 1440, "h": 1180},
    {"file": "RehberTipo.dc.html", "title": "03 · Tipografi", "x": 0, "y": 2420, "w": 1440, "h": 1080},
    {"file": "RehberWeb.dc.html", "title": "04 · Web sitesi", "x": 1560, "y": 0, "w": 1440, "h": 2000},
    {"file": "RehberMobil.dc.html", "title": "05 · Mobil uygulama", "x": 3120, "y": 0, "w": 1920, "h": 1100},
]
for a in layout: a["page"] = "page-7"
c = json.load(open(f"{OUT}/canvas.json"))
c["artboards"] = [a for a in c["artboards"] if a.get("page") != "page-7"] + layout
if not any(p["id"] == "page-7" for p in c["pages"]):
    c["pages"].append({"id": "page-7", "name": "Marka rehberi"})
c["launch"] = {"view": "canvas", "page": "page-7"}
json.dump(c, open(f"{OUT}/canvas.json", "w"), ensure_ascii=False, indent=2)
for fn, f, bn, b in pairs: print(fn, bn, round(cr(f, b), 2))
