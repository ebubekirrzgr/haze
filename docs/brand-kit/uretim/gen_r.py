#!/usr/bin/env python3
# HAZE — "Yükselen H", font-derived: stems, bar height and weight measured from each font's own H.
import json, os
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.boundsPen import BoundsPen

OUT = "/home/claude/haze-brand"
FS = OUT + "/fonts/node_modules/@fontsource"
P = dict(krem="#F6F0E4", fildisi="#FBF8F1", kum="#EADFC8", sampanya="#F1E6CF",
         pudra="#EBD9CF", altin="#C8A24A", bronz="#8A6D2F", sepya="#3B3226")

def outline(font, ch):
    gs = font.getGlyphSet(); name = font.getBestCmap()[ord(ch)]
    rp = RecordingPen(); gs[name].draw(rp)
    return rp.value, font["hmtx"][name][0]

def to_d(rec, dx):
    d = []
    for op, args in rec:
        pts = [(a[0] + dx, -a[1]) for a in args]
        if op == "moveTo": d.append("M%.1f %.1f" % pts[0])
        elif op == "lineTo": d.append("L%.1f %.1f" % pts[0])
        elif op == "qCurveTo":
            ctrl, end = pts[:-1], pts[-1]
            for i, c in enumerate(ctrl):
                e = ((c[0] + ctrl[i+1][0]) / 2, (c[1] + ctrl[i+1][1]) / 2) if i < len(ctrl) - 1 else end
                d.append("Q%.1f %.1f %.1f %.1f" % (c[0], c[1], e[0], e[1]))
        elif op == "curveTo": d.append("C" + " ".join("%.1f %.1f" % p for p in pts))
        else: d.append("Z")
    return " ".join(d)

def measure_H(font):
    rec, adv = outline(font, "H")
    pts = [p for _, args in rec for p in args]
    xs = sorted(set(round(p[0]) for p in pts))
    ys = [p[1] for p in pts]
    cap = max(ys)
    # stem width from the font's own "I"; stem positions from H's outer edges
    gs = font.getGlyphSet(); bp = BoundsPen(gs); gs[font.getBestCmap()[ord("I")]].draw(bp)
    sw = bp.bounds[2] - bp.bounds[0]
    l0, r1 = xs[0], xs[-1]
    l1, r0 = l0 + sw, r1 - sw
    inner = [p[1] for p in pts if l1 + 1 < p[0] < r0 - 1]
    bar_lo, bar_hi = (min(inner), max(inner)) if inner else (cap * 0.48, cap * 0.52)
    return dict(adv=adv, cap=cap, stem=l1 - l0, lc=(l0 + l1) / 2, rc=(r0 + r1) / 2, rs=r1 - r0,
                bar_y=(bar_lo + bar_hi) / 2, bar_t=bar_hi - bar_lo, lsb=l0, rsb=adv - r1)

def rising_H(m, length, radius_k=0.62):
    """Geometry in font units, y-up. Returns svg pieces with y flipped."""
    s, cap, by = m["stem"], m["cap"], m["bar_y"]
    lc = m["lc"]
    rc = lc + length
    R = min(by, cap - by) * radius_k
    f = lambda y: -y
    left_top = f'M{lc:.1f} {f(cap):.1f} V{f(by):.1f}'
    main = (f'M{lc:.1f} {f(0):.1f} V{f(by - R):.1f} '
            f'A{R:.1f} {R:.1f} 0 0 1 {lc + R:.1f} {f(by):.1f} '
            f'H{rc - R:.1f} '
            f'A{R:.1f} {R:.1f} 0 0 0 {rc:.1f} {f(by + R):.1f} '
            f'V{f(cap):.1f}')
    right_bottom = f'M{rc:.1f} {f(by):.1f} V{f(0):.1f}'
    right_edge = rc + s / 2 + m["rsb"]
    return left_top, main, right_bottom, right_edge

def build(rel, length_em=2.9, track=0.04):
    font = TTFont(os.path.join(FS, rel))
    upm = font["head"].unitsPerEm
    m = measure_H(font)
    lt, main, rb, x = rising_H(m, upm * length_em)
    letters = []
    for ch in "AZE":
        x += upm * track
        rec, adv = outline(font, ch)
        letters.append(to_d(rec, x)); x += adv
    pad = upm * 0.05
    vb = (-pad, -m["cap"] - pad, x + 2 * pad, m["cap"] + 2 * pad)
    return dict(m=m, lt=lt, main=main, rb=rb, letters=" ".join(letters), vb=vb, upm=upm)

def build_icon(rel):
    font = TTFont(os.path.join(FS, rel))
    m = measure_H(font)
    length = m["rc"] - m["lc"]
    lt, main, rb, _ = rising_H(m, length, radius_k=0.62)
    w = length + m["stem"]
    return m, lt, main, rb, (m["lc"] - m["stem"] / 2, -m["cap"], w, m["cap"])

def logo(b, color, width, anim=True, uid="a"):
    vb = b["vb"]; sw = b["m"]["stem"]
    h = width * vb[3] / vb[2]
    css = ""
    dcls = fcls = ""
    if anim:
        css = (f'<style>.d{uid}{{stroke-dasharray:1;stroke-dashoffset:1;animation:dr{uid} 5s cubic-bezier(.65,0,.35,1) infinite}}'
               f'@keyframes dr{uid}{{0%,6%{{stroke-dashoffset:1}}42%,100%{{stroke-dashoffset:0}}}}'
               f'.s{uid}{{opacity:0;animation:st{uid} 5s ease-out infinite}}@keyframes st{uid}{{0%,38%{{opacity:0}}50%,100%{{opacity:1}}}}'
               f'.l{uid}{{opacity:0;transform:translateY(2%);animation:lt{uid} 5s ease-out infinite}}'
               f'@keyframes lt{uid}{{0%,46%{{opacity:0;transform:translateY(2%)}}62%,100%{{opacity:1;transform:translateY(0)}}}}</style>')
        dcls, scls, lcls = f' class="d{uid}"', f' class="s{uid}"', f' class="l{uid}"'
    else:
        scls = lcls = ""
    return (f'<svg width="{width}" height="{h:.0f}" viewBox="{vb[0]:.0f} {vb[1]:.0f} {vb[2]:.0f} {vb[3]:.0f}">{css}'
            f'<g fill="none" stroke="{color}" stroke-width="{sw:.1f}" stroke-linecap="butt">'
            f'<path d="{b["lt"]}"{scls}></path>'
            f'<path d="{b["main"]}" pathLength="1"{dcls}></path>'
            f'<path d="{b["rb"]}"{scls}></path></g>'
            f'<path d="{b["letters"]}" fill="{color}"{lcls}></path></svg>')

def icon_svg(rel, size, bg, fg):
    m, lt, main, rb, vb = build_icon(rel)
    pad = vb[2] * 0.30
    side = vb[2] + 2 * pad
    oy = vb[1] - (side - vb[3]) / 2
    return (f'<svg width="{size}" height="{size}" viewBox="{vb[0]-pad:.0f} {oy:.0f} {side:.0f} {side:.0f}">'
            f'<rect x="{vb[0]-pad:.0f}" y="{oy:.0f}" width="{side:.0f}" height="{side:.0f}" rx="{side*0.22:.0f}" fill="{bg}"></rect>'
            f'<g fill="none" stroke="{fg}" stroke-width="{m["stem"]*1.25:.1f}"><path d="{lt}"></path><path d="{main}"></path><path d="{rb}"></path></g></svg>')

HEAD = open(f"{OUT}/FJosefin.dc.html").read().split("<div style=")[0]
TAIL = "\n</x-dc>\n</body>\n</html>\n"

FONTS = [
    ("RSpace", "R1 · Space Grotesk", "space-grotesk/files/space-grotesk-latin-300-normal.woff2", "kum", "sepya", "bronz",
     "Sade ve modern; çizgi fontun gövdesiyle birebir aynı kalınlıkta. Fintech için en dengeli olanı."),
    ("RJosefin", "R2 · Josefin Sans", "josefin-sans/files/josefin-sans-latin-300-normal.woff2", "krem", "altin", "bronz",
     "Art Deco zarafeti, ince ve uzun. Altınla en şık duran versiyon."),
    ("RUnbounded", "R3 · Unbounded", "unbounded/files/unbounded-latin-300-normal.woff2", "sepya", "altin", "kum",
     "Geniş ve yuvarlak; kıvrımlar harflerin yumuşaklığıyla uyumlu. Koyu zeminde güçlü."),
    ("RMichroma", "R4 · Michroma", "michroma/files/michroma-latin-400-normal.woff2", "fildisi", "sepya", "bronz",
     "Teknik ve geniş; kripto dünyasına en yakın ses. Kalın çizgi küçük boyda da net."),
]

layout = []
y = 0
for i, (stem, title, rel, bg, fg, lab, note) in enumerate(FONTS):
    b = build(rel)
    icons = "".join(icon_svg(rel, s_, P[fg], P[bg]) for s_ in (72, 40, 24))
    html = HEAD + f"""<div style="width: 1200px; height: 460px; box-sizing: border-box; padding: 36px 56px; background: {P[bg]}; display: flex; flex-direction: column; justify-content: space-between;">
  <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 32px;">
    <div style="display: flex; flex-direction: column; gap: 6px;">
      <div style="font-size: 12px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: {P[lab]};">{title}</div>
      <div style="font-size: 14px; line-height: 1.5; color: {P[lab]}; max-width: 640px; text-wrap: pretty;">{note}</div>
    </div>
    <div style="display: flex; gap: 14px; align-items: center;">{icons}</div>
  </div>
  {logo(b, P[fg], 1000, uid=str(i))}
</div>""" + TAIL
    open(f"{OUT}/{stem}.dc.html", "w").write(html)
    layout.append({"file": f"{stem}.dc.html", "title": title, "x": 0, "y": y, "w": 1200, "h": 460, "page": "page-6"})
    y += 600

c = json.load(open(f"{OUT}/canvas.json"))
c["artboards"] = [a for a in c["artboards"] if a.get("page") != "page-6"] + layout
if not any(p["id"] == "page-6" for p in c["pages"]):
    c["pages"].append({"id": "page-6", "name": "Yükselen H · font tabanlı"})
c["annotations"] = [n for n in c["annotations"] if n["id"] != "r-notu"] + [
    {"id": "r-notu", "x": 1280, "y": 0, "w": 340, "page": "page-6",
     "text": "Mina'nın notu\nElle çizim yok: gövde kalınlığı, gövdelerin yeri ve orta çizgi yüksekliği her fontun kendi H harfinden ölçüldü. Kıvrımlar düzgün çeyrek daire.\nHepsinde G5'teki açılış animasyonu var; sağ üstte ikonlar (72 / 40 / 24)."}]
c["launch"] = {"view": "canvas", "page": "page-6"}
json.dump(c, open(f"{OUT}/canvas.json", "w"), ensure_ascii=False, indent=2)
for _, _, rel, *_ in FONTS:
    print(rel.split("/")[0], {k: round(v) for k, v in measure_H(TTFont(os.path.join(FS, rel))).items()})
