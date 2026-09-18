#!/usr/bin/env python3
# HAZE — Marka rehberi 06 · Kart (HAZE Gold card: isometric + front/back + specs).
import json
OUT = "/home/claude/haze-brand"
g = open(f"{OUT}/gen_guide.py").read()
exec(g.split("# ---------- 01 LOGO ----------")[0])   # helpers only: C, GLASS, atmos, sheet, static_logo, icon_svg, eyebrow ...

W, H = 428, 270  # ISO/IEC 7810 ID-1 ratio (85.60 × 53.98 mm), 5 px per mm
import urllib.parse
SM = json.load(open(f"{OUT}/stellar_mark.json"))
def stellar_mark(h, color, uid="sm"):
    w = h * SM["w"] / SM["h"]
    return (f'<svg width="{w:.1f}" height="{h}" viewBox="{SM["vb"]}"><path fill="{color}" fill-rule="evenodd" d="{SM["d"]}"></path></svg>')

def noise_uri(bx, by, alpha, seed):
    svg = (f"<svg xmlns='http://www.w3.org/2000/svg' width='428' height='270'><filter id='n'>"
           f"<feTurbulence type='fractalNoise' baseFrequency='{bx} {by}' numOctaves='2' seed='{seed}'/>"
           f"<feColorMatrix values='0 0 0 0 0.30 0 0 0 0 0.22 0 0 0 0 0.08 0 0 0 {alpha} 0'/></filter>"
           f"<rect width='100%' height='100%' filter='url(#n)'/></svg>")
    return "url(data:image/svg+xml," + urllib.parse.quote(svg, safe="") + ")"
BRUSH = noise_uri(0.002, 0.95, 0.55, 7)
GRAIN = noise_uri(0.9, 0.9, 0.18, 3)
GOLD_FACE = ("background: "
             "radial-gradient(120% 140% at 50% 50%, rgba(0,0,0,0) 55%, rgba(70,48,10,0.28) 100%), "
             "linear-gradient(118deg, rgba(255,255,255,0) 22%, rgba(255,248,222,0.62) 34%, rgba(255,255,255,0) 44%), "
             "linear-gradient(118deg, rgba(255,255,255,0) 58%, rgba(255,246,214,0.32) 66%, rgba(255,255,255,0) 74%), "
             f"{GRAIN}, {BRUSH}, "
             "linear-gradient(160deg, #F1DDA2 0%, #D8B563 22%, #BF9843 45%, #D6B366 62%, #B48C3A 82%, #9E782C 100%);")
EDGE = "#8F6E2B"
INK = "#3B3226"
ENG = "color: rgba(52,40,22,0.88); text-shadow: 0 1px 0 rgba(255,241,200,0.55), 0 -1px 0 rgba(60,40,10,0.15);"
ENG_F = "filter: drop-shadow(0 1px 0 rgba(255,241,200,0.55)) drop-shadow(0 -0.5px 0 rgba(60,40,10,0.2));"
BEVEL = "box-shadow: inset 0 1.5px 0 rgba(255,250,228,0.85), inset 0 -1.5px 0 rgba(90,62,16,0.35), inset 1px 0 0 rgba(255,245,215,0.4), inset -1px 0 0 rgba(90,62,16,0.25);"

CHIP = """<svg width="50" height="40" viewBox="0 0 50 40">
  <defs>
    <linearGradient id="cg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FBEFC6"></stop><stop offset="0.35" stop-color="#D9B869"></stop><stop offset="0.6" stop-color="#F2DE9E"></stop><stop offset="1" stop-color="#B08A38"></stop></linearGradient>
    <linearGradient id="cg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E9D08E"></stop><stop offset="1" stop-color="#C39D4A"></stop></linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="49" height="39" rx="7.5" fill="url(#cg)" stroke="#7E6025" stroke-width="0.8"></rect>
  <rect x="17" y="11" width="16" height="18" rx="4" fill="url(#cg2)" stroke="#7E6025" stroke-width="0.8"></rect>
  <path d="M0.8 13.5H12.5Q17 13.5 17 17 M0.8 26.5H12.5Q17 26.5 17 23 M49.2 13.5H37.5Q33 13.5 33 17 M49.2 26.5H37.5Q33 26.5 33 23 M25 0.8V11 M25 29V39.2 M0.8 20H17 M33 20H49.2" stroke="#7E6025" stroke-width="0.8" fill="none"></path>
</svg>"""
NFC = """<svg width="24" height="30" viewBox="0 0 26 30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
  <path d="M3 10.5a7 7 0 0 1 0 9"></path><path d="M8.5 7a12 12 0 0 1 0 16"></path><path d="M14 3.5a17 17 0 0 1 0 23"></path><path d="M19.5 1a21 21 0 0 1 0 28"></path>
</svg>"""

def stellar_strip():
    return (f'<div style="position: absolute; left: 20px; right: 20px; bottom: 0; height: 48px; border-top: 1px solid rgba(60,42,12,0.28); '
            f'box-shadow: 0 1px 0 rgba(255,244,210,0.45) inset; display: flex; align-items: center; justify-content: center; gap: 10px;">'
            f'<div style="{ENG_F} display: flex;">{stellar_mark(26, "rgba(52,40,22,0.86)")}</div></div>')

def face_base(inner):
    return (f'<div style="position: relative; width: {W}px; height: {H}px; border-radius: 16px; overflow: hidden; {GOLD_FACE} {BEVEL}">'
            f'{inner}</div>')

def front():
    return face_base(f"""
  <div style="position: absolute; left: 24px; top: 26px; {ENG_F}">{static_logo("rgba(52,40,22,0.9)", 128)}</div>
  <div class="disp" style="position: absolute; right: 24px; top: 27px; font-size: 10px; letter-spacing: 0.34em; {ENG}">GOLD</div>
  <div style="position: absolute; left: 26px; top: 82px; filter: drop-shadow(0 1px 1px rgba(60,40,10,0.35));">{CHIP}</div>
  <div style="position: absolute; left: 90px; top: 87px; {ENG}">{NFC}</div>
  <div class="disp num" style="position: absolute; left: 26px; top: 140px; font-size: 16px; letter-spacing: 0.1em; word-spacing: 0.32em; {ENG}">•••• •••• •••• 0000</div>
  <div style="position: absolute; left: 26px; top: 176px; display: flex; flex-direction: column; gap: 2px; {ENG}">
    <div style="font-size: 7.5px; font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase; opacity: 0.75;">Kart sahibi</div>
    <div style="font-size: 12.5px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase;">[Ad Soyad]</div>
  </div>
  <div style="position: absolute; left: 244px; top: 176px; display: flex; flex-direction: column; gap: 2px; {ENG}">
    <div style="font-size: 7.5px; font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase; opacity: 0.75;">Son kullanma</div>
    <div class="num" style="font-size: 12.5px; font-weight: 500; letter-spacing: 0.1em;">00/00</div>
  </div>
  {stellar_strip()}""")

def back():
    return face_base(f"""
  <div style="position: absolute; left: 0; right: 0; top: 22px; height: 44px; background: linear-gradient(180deg, #221C15 0%, #3A3127 45%, #2A231B 55%, #1E1914 100%); box-shadow: 0 1px 0 rgba(255,244,210,0.4);"></div>
  <div style="position: absolute; left: 0; right: 0; top: 22px; height: 44px; background: linear-gradient(100deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.12) 42%, rgba(255,255,255,0) 52%);"></div>
  <div style="position: absolute; left: 24px; top: 86px; width: 268px; height: 36px; border-radius: 3px; background: repeating-linear-gradient(-45deg, #FBF6E8 0px, #FBF6E8 5px, #EFE3C6 5px, #EFE3C6 7px); box-shadow: inset 0 1px 2px rgba(60,40,10,0.25);"></div>
  <div style="position: absolute; left: 304px; top: 86px; width: 100px; height: 36px; border-radius: 3px; background: #FBF6E8; box-shadow: inset 0 1px 2px rgba(60,40,10,0.25); display: flex; align-items: center; justify-content: center; gap: 8px; color: {INK};">
    <div style="font-size: 7.5px; font-weight: 600; letter-spacing: 0.16em; opacity: 0.7;">CVV</div><div class="num" style="font-size: 13px; font-weight: 600; font-style: italic;">000</div>
  </div>
  <div style="position: absolute; left: 24px; top: 138px; width: 250px; font-size: 8.5px; line-height: 1.55; {ENG}">
    Bu kart [kart programı ortağı] tarafından HAZE adına çıkarılır. USDC bakiyenden ödenir, satıcıya TL olarak ulaşır.
  </div>
  <div style="position: absolute; left: 24px; top: 192px; font-size: 8.5px; letter-spacing: 0.08em; {ENG}">Destek · [destek hattı]</div>
  <div style="position: absolute; right: 26px; top: 136px; filter: drop-shadow(0 1px 1px rgba(60,40,10,0.35));">{icon_svg(REL, 48, "#3B3226", C['altin'])}</div>
  {stellar_strip()}""")

ISO = "matrix(0.7071, 0.4082, -0.7071, 0.4082, 0, 0)"   # isometric top view
def iso_card(face, x, y, depth=6, lift=46):
    edges = "".join(
        f'<div style="position: absolute; left: 0; top: 0; width: {W}px; height: {H}px; border-radius: 16px; '
        f'background: linear-gradient(90deg, #7A5B20, #C9A452 45%, #F0DA9A 55%, #8A6A28); transform: translateY({i}px) {ISO}; transform-origin: 50% 50%;"></div>'
        for i in range(depth, 0, -1))
    return (f'<div style="position: absolute; left: {x}px; top: {y}px; width: {W}px; height: {H}px;">'
            f'<div style="position: absolute; left: 0; top: 0; width: {W}px; height: {H}px; border-radius: 30px; background: rgba(46,34,16,0.30); '
            f'filter: blur(26px); transform: translateY({lift+26}px) {ISO} scale(0.96); transform-origin: 50% 50%;"></div>'
            f'<div style="position: absolute; left: 0; top: 0; width: {W}px; height: {H}px; border-radius: 16px; background: rgba(46,34,16,0.22); '
            f'filter: blur(8px); transform: translateY({lift+8}px) {ISO} scale(0.99); transform-origin: 50% 50%;"></div>'
            f'{edges}<div style="position: absolute; left: 0; top: 0; transform: {ISO}; transform-origin: 50% 50%;">{face}</div></div>')

def scaled(face, s):
    return (f'<div style="width: {W*s:.0f}px; height: {H*s:.0f}px; position: relative; flex-shrink: 0;">'
            f'<div style="position: absolute; left: 0; top: 0; transform: scale({s}); transform-origin: 0 0;">{face}</div></div>')

scene = f"""<div style="grid-column: span 7; {GLASS} border-radius: 20px; position: relative; overflow: hidden; height: 600px;">
  <div style="position: absolute; inset: 0; background: radial-gradient(70% 60% at 50% 62%, rgba(255,250,236,0.9), rgba(238,224,192,0.55) 60%, rgba(214,190,140,0.45) 100%);"></div>
  <div style="position: absolute; left: 50%; top: 30%; width: 640px; height: 360px; margin-left: -320px; border-radius: 50%; background: radial-gradient(circle, rgba(255,255,255,0.65), rgba(255,255,255,0) 70%); filter: blur(10px);"></div>
  {iso_card(back(), 250, 260, lift=30)}
  {iso_card(front(), 86, 96, lift=90)}
  <div style="position: absolute; left: 20px; bottom: 16px; font-size: 13px; color: {C['ikincil']};">İzometrik görünüm · ön yüz üstte, arka yüz altta</div>
</div>"""

def spec(t, d):
    return (f'<div style="{GLASS} border-radius: 16px; padding: 18px 20px; display: flex; flex-direction: column; gap: 6px;">'
            f'<div style="font-size: 15px; font-weight: 600;">{t}</div><div style="font-size: 14px; line-height: 1.5; color: {C["ikincil"]};">{d}</div></div>')

body = f"""
  <div style="display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 32px;">
    {scene}
    <div style="grid-column: span 5; display: flex; flex-direction: column; gap: 18px;">
      <div style="display: flex; flex-direction: column; gap: 8px;">{eyebrow("Ön yüz")}{scaled(front(), 1.14)}</div>
      <div style="display: flex; flex-direction: column; gap: 8px;">{eyebrow("Arka yüz")}{scaled(back(), 1.14)}</div>
    </div>
  </div>
  <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px;">
    {spec("Ölçü", "85,60 × 53,98 mm · ISO/IEC 7810 ID-1 · köşe yarıçapı 3,18 mm")}
    {spec("Yüzey", "Fırçalanmış altın tonlu metal; logo, numara ve yazılar lazer gravür.")}
    {spec("Yerleşim", "Logo sol üstte, çip ve temassız simgesi ortada, bilgi satırları altta.")}
    {spec("Stellar logosu", "İki yüzde de alt şeritte ortalı, yalnız işaret olarak lazer gravür.")}
  </div>"""

html = sheet(1440, 1120, C["krem"], "06", "Kart",
             "HAZE Gold: altın gibi duran bir kart; bakiye USDC'de, ödeme TL'de.", body)
open(f"{OUT}/RehberKart.dc.html", "w").write(html)

c = json.load(open(f"{OUT}/canvas.json"))
c["artboards"] = [a for a in c["artboards"] if a["file"] != "RehberKart.dc.html"] + [
    {"file": "RehberKart.dc.html", "title": "06 · Kart", "x": 3120, "y": 1240, "w": 1440, "h": 1120, "page": "page-7"}]
c["launch"] = {"view": "canvas", "page": "page-7"}
json.dump(c, open(f"{OUT}/canvas.json", "w"), ensure_ascii=False, indent=2)
print("ok")
