# Flag-as-question-mark icons. The flag waves from the top of the pole, sweeping left and down
# into the hook of a "?"; the pole is the stem; the cup is the dot.
import math

def catmull(pts, n=40):
    out = []
    P = [pts[0]] + pts + [pts[-1]]
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2
                                     + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in (0, 1)))
    out.append(pts[-1])
    return out

def ribbon(center, widths, wave=0.0, waves=2.0):
    """Polygon around a centerline with varying width (and an optional ripple on the edges)."""
    L, R = [], []
    n = len(center)
    for i, (x, y) in enumerate(center):
        a = center[max(i - 1, 0)]; b = center[min(i + 1, n - 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]; m = math.hypot(dx, dy) or 1
        nx, ny = -dy / m, dx / m
        t = i / (n - 1)
        w = widths(t) / 2
        r = wave * math.sin(t * math.pi * waves) * min(1, t * 3)  # ripple grows away from the tip
        L.append((x + nx * (w + r), y + ny * (w + r)))
        R.append((x - nx * (w - r), y - ny * (w - r)))
    pts = L + R[::-1]
    return "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in pts) + " Z"

def smooth(t, a, b):  # smoothstep
    t = min(max((t - a) / (b - a), 0), 1)
    return t * t * (3 - 2 * t)

# The "?" hook: free tip (lower left) -> over the top -> down the right -> back into the pole.
hook = catmull([(318, 432), (338, 300), (430, 214), (548, 200), (652, 252), (690, 352), (650, 440), (566, 494), (512, 536)])
def flag_w(t):  # thin at the fluttering tip, full in the middle, narrowing to the pole's width
    return 14 + 150 * smooth(t, 0.0, 0.42) - 104 * smooth(t, 0.62, 1.0)
FLAG = ribbon(hook, flag_w, wave=7, waves=3)

POLE_TOP, POLE_BOT, POLE_X, POLE_W = 520, 770, 512, 46

def icon(name, bg, flag, pole, cup, cup_rim, extra=""):
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    {bg[0]}
    <linearGradient id="fl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{flag[0]}"/><stop offset="1" stop-color="{flag[1]}"/></linearGradient>
    <filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity=".18"/></filter>
  </defs>
  <rect width="1024" height="1024" fill="{bg[1]}"/>
  {extra}
  <g filter="url(#sh)">
    <!-- cup: the dot -->
    <ellipse cx="{POLE_X}" cy="850" rx="96" ry="30" fill="{cup_rim}"/>
    <ellipse cx="{POLE_X}" cy="846" rx="80" ry="22" fill="{cup}"/>
    <!-- pole: the stem -->
    <rect x="{POLE_X - POLE_W/2}" y="{POLE_TOP}" width="{POLE_W}" height="{POLE_BOT - POLE_TOP}" rx="{POLE_W/2}" fill="{pole}"/>
    <!-- flag: the hook, waving -->
    <path d="{FLAG}" fill="url(#fl)"/>
  </g>
</svg>'''
    open(name, "w").write(svg)

G = '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2fae64"/><stop offset="1" stop-color="#136b37"/></linearGradient>'
L = '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#eef1ec"/></linearGradient>'
N = '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16251b"/><stop offset="1" stop-color="#0b130e"/></linearGradient>'
# 1: red flag, white pole on fairway green
icon("1-green.svg", (G, "url(#bg)"), ("#ff5a5f", "#cf3a40"), "#ffffff", "#0c3a1f", "#bfe9cf")
# 2: green flag on white (clean, Apple-like)
icon("2-light.svg", (L, "url(#bg)"), ("#34b46a", "#16703b"), "#111813", "#111813", "#d9e7dc")
# 3: red flag on deep green-black (premium)
icon("3-night.svg", (N, "url(#bg)"), ("#ff5a5f", "#cf3a40"), "#f5f7f3", "#000000", "#2fae64")
