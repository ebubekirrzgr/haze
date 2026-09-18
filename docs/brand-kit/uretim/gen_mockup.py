#!/usr/bin/env python3
# HAZE — Marka rehberi 07 · Mockup (realistic 3D scenes: desk, POS tap, fanned cards).
import json
OUT = "/home/claude/haze-brand"
g = open(f"{OUT}/gen_guide.py").read()
head = g.split("# ---------- 01 LOGO ----------")[0]
ui = g[g.index("# ---------- shared UI bits ----------"):g.index("# ---------- 04 WEB ----------")]
mobile = g[g.index("# ---------- 05 MOBİL ----------"):g.index("mob = HEAD")]
exec(head); exec(ui); exec(mobile)          # C, GLASS, sheet, static_logo, icon_svg, phone parts, home ...
c_src = open(f"{OUT}/gen_card.py").read()
exec(c_src[c_src.index("W, H = 428"):c_src.index("ISO = ")])   # front(), back(), GOLD_FACE, stellar_mark ...

NOISE = noise_uri(0.75, 0.75, 0.22, 11)
VEIN = noise_uri(0.004, 0.02, 0.10, 5)

def surface(kind):
    if kind == "stone":
        return (f"background: radial-gradient(90% 80% at 22% 12%, rgba(255,252,242,0.95), rgba(255,252,242,0) 60%), "
                f"radial-gradient(80% 90% at 90% 100%, rgba(120,92,48,0.30), rgba(120,92,48,0) 60%), "
                f"{NOISE}, {VEIN}, linear-gradient(135deg, #EEE5D3, #DCCDB0);")
    return (f"background: radial-gradient(70% 70% at 30% 20%, rgba(200,162,74,0.28), rgba(200,162,74,0) 60%), "
            f"radial-gradient(90% 90% at 80% 100%, rgba(0,0,0,0.45), rgba(0,0,0,0) 60%), "
            f"{NOISE}, linear-gradient(135deg, #3E342A, #211B15);")

def plane(inner, rx, rz, extra=""):
    return (f'<div style="position: absolute; left: 50%; top: 50%; width: 0; height: 0; transform-style: preserve-3d; '
            f'transform: rotateX({rx}deg) rotateZ({rz}deg); {extra}">{inner}</div>')

def obj(inner, x, y, w, h, rot=0, z=0, shadow=(18, 26, 0.35)):
    ox, blur, a = shadow
    return (f'<div style="position: absolute; left: {x - w/2:.0f}px; top: {y - h/2:.0f}px; width: {w}px; height: {h}px; '
            f'transform: rotateZ({rot}deg) translateZ({z}px); transform-style: preserve-3d;">'
            f'<div style="position: absolute; inset: 4px; border-radius: 22px; background: rgba(30,20,8,{a}); filter: blur({blur}px); '
            f'transform: translate({ox*0.3:.0f}px, {ox:.0f}px) translateZ(-{z + 1}px);"></div>'
            f'<div style="position: absolute; inset: 0; transform: translateZ(0.5px);">{inner}</div></div>')

def card_obj(face, s=1.0, thick="#8A6A28"):
    return (f'<div style="width: {W*s:.0f}px; height: {H*s:.0f}px; position: relative; border-radius: {16*s:.0f}px; '
            f'box-shadow: 0 {3*s:.1f}px 0 {thick}, 0 {4*s:.1f}px 0 #6E5220;">'
            f'<div style="position: absolute; left: 0; top: 0; transform: scale({s}); transform-origin: 0 0;">{face}</div></div>')

def phone_obj(inner_screen, s):
    return (f'<div style="width: {410*s:.0f}px; height: {864*s:.0f}px; position: relative; border-radius: {58*s:.0f}px; '
            f'background: linear-gradient(135deg, #5A4C3C, #2A231B); box-shadow: 0 {5*s:.0f}px 0 #1A1510, inset 0 0 0 {2*s:.1f}px rgba(255,240,210,0.25);">'
            f'<div style="position: absolute; left: 0; top: 0; transform: scale({s}); transform-origin: 0 0;">{inner_screen}</div>'
            f'<div style="position: absolute; inset: 0; border-radius: {58*s:.0f}px; background: linear-gradient(125deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 35%); pointer-events: none;"></div></div>')

def sleeve(s=1.0):
    w, h = 470, 300
    return (f'<div style="width: {w*s:.0f}px; height: {h*s:.0f}px; position: relative; border-radius: {10*s:.0f}px; '
            f'background: radial-gradient(80% 90% at 30% 20%, rgba(255,240,210,0.10), rgba(0,0,0,0) 60%), {NOISE}, linear-gradient(160deg, #4A3E31, #2B241C); '
            f'box-shadow: 0 {3*s:.0f}px 0 #1C1712, inset 0 1px 0 rgba(255,240,210,0.18);">'
            f'<div style="position: absolute; left: 0; right: 0; top: {h*s*0.52:.0f}px; height: 1px; background: rgba(0,0,0,0.35); box-shadow: 0 1px 0 rgba(255,240,210,0.08);"></div>'
            f'<div style="position: absolute; left: 50%; top: {h*s*0.74:.0f}px; transform: translate(-50%, -50%); '
            f'filter: drop-shadow(0 1px 0 rgba(0,0,0,0.5));">{static_logo("#C8A24A", int(150*s))}</div></div>')

# ---- Scene A: desk (stone) — phone + card sliding out of sleeve
screen = phone(home, C['krem']).replace("box-shadow: 0 30px 80px rgba(59,50,38,0.25);", "")
scene_a_objs = (
    obj(phone_obj(screen, 0.62), -250, 10, int(410*0.62), int(864*0.62), rot=-14, z=6, shadow=(22, 22, 0.32)) +
    obj(sleeve(1.0), 190, 70, 470, 300, rot=16, z=3, shadow=(14, 18, 0.30)) +
    obj(card_obj(front(), 1.0), 150, -60, W, H, rot=9, z=9, shadow=(26, 24, 0.34))
)
scene_a = (f'<div style="grid-column: span 12; height: 560px; border-radius: 22px; overflow: hidden; position: relative; perspective: 1700px; '
           f'{surface("stone")} box-shadow: 0 20px 60px rgba(59,50,38,0.18), inset 0 1px 0 rgba(255,255,255,0.6);">'
           f'{plane(scene_a_objs, 48, -8, "top: 54%;")}'
           f'<div style="position: absolute; inset: 0; background: linear-gradient(180deg, rgba(255,250,236,0.35), rgba(255,250,236,0) 30%, rgba(40,30,15,0) 70%, rgba(40,30,15,0.18));"></div></div>')

# ---- Scene B: POS contactless tap
TERM_SCREEN = f"""<div style="position: absolute; left: 26px; top: 30px; width: 188px; height: 168px; border-radius: 12px; background: linear-gradient(160deg, #FBF8F1, #F1E6CF); box-shadow: inset 0 0 0 1px rgba(0,0,0,0.25);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: #3B3226;">
  <div style="width: 40px; height: 40px; border-radius: 20px; background: #5E7F4F; display: flex; align-items: center; justify-content: center;">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FBF8F1" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg></div>
  <div class="disp num" style="font-size: 22px;">₺145,00</div>
  <div style="font-size: 12px; font-weight: 600; letter-spacing: 0.08em;">ONAYLANDI</div>
</div>"""
keys = "".join(f'<div style="height: 26px; border-radius: 6px; background: linear-gradient(180deg, #4E4337, #372F26); box-shadow: 0 2px 0 #1A1510, inset 0 1px 0 rgba(255,240,210,0.15);"></div>' for _ in range(12))
terminal = (f'<div style="width: 240px; height: 420px; position: relative; border-radius: 26px; background: linear-gradient(160deg, #4A3F33, #231D16); '
            f'box-shadow: 0 6px 0 #15110D, inset 0 1px 0 rgba(255,240,210,0.2);">{TERM_SCREEN}'
            f'<div style="position: absolute; left: 30px; right: 30px; top: 222px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px;">{keys}</div>'
            f'<div style="position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); color: rgba(246,240,228,0.55);">{NFC}</div></div>')
waves = (f'<div style="position: absolute; left: 50%; top: 50%; width: 0; height: 0;">' +
         "".join(f'<div style="position: absolute; left: {-r}px; top: {-r}px; width: {2*r}px; height: {2*r}px; border-radius: 50%; border: 2px solid rgba(200,162,74,{a});"></div>'
                 for r, a in [(90, 0.55), (130, 0.35), (170, 0.18)]) + "</div>")
scene_b_objs = (
    obj(terminal, -70, -20, 240, 420, rot=-6, z=4, shadow=(24, 20, 0.40)) +
    f'<div style="position: absolute; left: -70px; top: -60px; transform: translateZ(40px);">{waves}</div>' +
    obj(card_obj(front(), 0.62), 115, -80, int(W*0.62), int(H*0.62), rot=22, z=90, shadow=(90, 30, 0.22))
)
scene_b = (f'<div style="grid-column: span 6; height: 400px; border-radius: 22px; overflow: hidden; position: relative; perspective: 1400px; {surface("stone")} '
           f'box-shadow: 0 20px 60px rgba(59,50,38,0.18), inset 0 1px 0 rgba(255,255,255,0.6);">'
           f'{plane(scene_b_objs, 40, 10, "top: 52%;")}</div>')

# ---- Scene C: fanned cards on dark leather
scene_c_objs = (
    obj(card_obj(back(), 0.78), 40, 40, int(W*0.78), int(H*0.78), rot=-22, z=3, shadow=(14, 18, 0.55)) +
    obj(card_obj(front(), 0.78), -20, -10, int(W*0.78), int(H*0.78), rot=8, z=7, shadow=(18, 20, 0.55))
)
scene_c = (f'<div style="grid-column: span 6; height: 400px; border-radius: 22px; overflow: hidden; position: relative; perspective: 1400px; {surface("dark")} '
           f'box-shadow: 0 20px 60px rgba(30,20,8,0.3), inset 0 1px 0 rgba(255,240,210,0.12);">'
           f'{plane(scene_c_objs, 44, -6, "top: 52%;")}'
           f'<div style="position: absolute; inset: 0; background: radial-gradient(60% 50% at 30% 20%, rgba(255,230,170,0.12), rgba(0,0,0,0) 60%);"></div></div>')

def cap(t, d):
    return f'<div style="display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 15px; font-weight: 600;">{t}</div><div style="font-size: 14px; color: {C["ikincil"]};">{d}</div></div>'

body = f"""
  <div style="display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 24px;">
    {scene_a}
    <div style="grid-column: span 12; margin-top: -8px;">{cap("Masa üstü", "Uygulama açık telefon ve kılıfından çıkan HAZE Gold; taş yüzey, gün ışığı.")}</div>
    {scene_b}
    {scene_c}
    <div style="grid-column: span 6; margin-top: -8px;">{cap("Temassız ödeme", "Kart POS'a yaklaşır; ödeme USDC bakiyeden, satıcıya TL olarak.")}</div>
    <div style="grid-column: span 6; margin-top: -8px;">{cap("Ön ve arka yüz", "Koyu deri zeminde yelpaze; altın yüzeyin ışığı yakaladığı an.")}</div>
  </div>"""

html = sheet(1440, 1340, C["krem"], "07", "Mockup",
             "HAZE Gold ve uygulama, gerçek kullanım anlarında.", body)
open(f"{OUT}/RehberMockup.dc.html", "w").write(html)

c = json.load(open(f"{OUT}/canvas.json"))
c["artboards"] = [a for a in c["artboards"] if a["file"] != "RehberMockup.dc.html"] + [
    {"file": "RehberMockup.dc.html", "title": "07 · Mockup", "x": 4680, "y": 1240, "w": 1440, "h": 1340, "page": "page-7"}]
json.dump(c, open(f"{OUT}/canvas.json", "w"), ensure_ascii=False, indent=2)
print("ok")
