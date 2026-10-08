# v5: v3's shape (best "?" read) with the tip hanging down, smooth sheen instead of fold bands,
# and the pole's top showing above the flag so it reads as a flagstick.
import math
exec(open("gen.py").read().split("# The \"?\" hook")[0])  # catmull(), ribbon(), smooth()

PX = 600
HOOK = catmull([(PX, 286), (560, 222), (486, 196), (408, 214), (356, 270), (344, 336), (356, 398), (372, 426)], 30)

def icon(name, bg, flag, pole, cup, rim, kind, sheen=".22"):
    PW, TOP, BOT = 40, 178, 712
    wf = (lambda t: 122 - 90 * smooth(t, 0.35, 1.0)) if kind == "pennant" else (lambda t: 112 - 16 * smooth(t, 0.5, 1.0))
    d = ribbon(HOOK, wf, wave=5, waves=2.5)
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    {bg}
    <linearGradient id="fl" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{flag[0]}"/><stop offset="1" stop-color="{flag[1]}"/></linearGradient>
    <!-- soft sheen: cloth catching light across the wave -->
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".38" stop-color="#fff" stop-opacity="{sheen}"/>
      <stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset=".72" stop-color="#000" stop-opacity=".10"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
    </linearGradient>
    <filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity=".2"/></filter>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <g filter="url(#sh)" transform="translate(-6 22)">
    <ellipse cx="{PX}" cy="800" rx="96" ry="29" fill="{rim}"/>
    <ellipse cx="{PX}" cy="796" rx="78" ry="20" fill="{cup}"/>
    <rect x="{PX - PW/2}" y="{TOP}" width="{PW}" height="{BOT - TOP}" rx="{PW/2}" fill="{pole}"/>
    <path d="{d}" fill="url(#fl)"/>
    <path d="{d}" fill="url(#sheen)"/>
  </g>
</svg>'''
    open(name, "w").write(svg)

G = '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2fae64"/><stop offset="1" stop-color="#136b37"/></linearGradient>'
L_ = '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#eef1ec"/></linearGradient>'
N = '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#18281d"/><stop offset="1" stop-color="#0a120d"/></linearGradient>'
R = ("#ff6166", "#c9363c")
icon("15-green.svg", G, R, "#ffffff", "#0c3a1f", "#bfe9cf", "pennant")
icon("16-light.svg", L_, R, "#111813", "#111813", "#cfe6d6", "pennant")
icon("17-night.svg", N, R, "#f5f7f3", "#000000", "#2fae64", "pennant")
icon("18-green-flag.svg", G, R, "#ffffff", "#0c3a1f", "#bfe9cf", "flag")
