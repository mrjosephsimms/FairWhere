# App Store screenshots: headline on fairway green, the real app screen in a rounded "phone" below.
# Outputs 6.9" (1320x2868) and 6.5" (1284x2778) sets.
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os
SHOTS = [
    ("1-buddies",   "See which hole\nthey're on"),
    ("2-round",     "Know when\nthey'll be done"),
    ("3-alerts",    "Get the alerts\nyou choose"),
    ("4-scorecard", "Follow the score\nhole by hole"),
    ("5-start",     "Start a round\nin seconds"),
]
SIZES = {"6.9": (1320, 2868), "6.5": (1284, 2778)}
TOP, BOT = (47, 174, 100), (1, 55, 28)   # icon greens

def font(px):
    return ImageFont.truetype("/System/Library/Fonts/HelveticaNeue.ttc", px, index=1)  # Helvetica Neue Bold

def gradient(w, h):
    g = Image.new("RGB", (w, h))
    px = g.load()
    for y in range(h):
        t = y / (h - 1)
        c = tuple(int(TOP[i] + (BOT[i] - TOP[i]) * t) for i in range(3))
        for x in range(w):
            px[x, y] = c
    return g

def rounded(im, r):
    m = Image.new("L", im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1], r, fill=255)
    return m

for label, (W, H) in SIZES.items():
    os.makedirs(f"out/{label}", exist_ok=True)
    bg_base = gradient(W, H)
    for name, headline in SHOTS:
        bg = bg_base.copy()
        d = ImageDraw.Draw(bg)
        f = font(int(W * 0.085))
        y = int(H * 0.055)
        for line in headline.split("\n"):
            tw = d.textlength(line, font=f)
            d.text(((W - tw) / 2, y), line, font=f, fill=(255, 255, 255))
            y += int(W * 0.1)
        shot = Image.open(f"raw/{name}.png").convert("RGB")
        pw = int(W * 0.82)
        ph = int(shot.size[1] * pw / shot.size[0])
        shot = shot.resize((pw, ph), Image.LANCZOS)
        r = int(pw * 0.11)
        bezel = int(pw * 0.025)
        px0 = (W - pw) // 2
        py0 = y + int(H * 0.035)
        # shadow
        sh = Image.new("L", (W, H), 0)
        ImageDraw.Draw(sh).rounded_rectangle([px0 - bezel, py0 - bezel + 24, px0 + pw + bezel, py0 + ph + bezel + 24], r + bezel, fill=110)
        sh = sh.filter(ImageFilter.GaussianBlur(40))
        bg.paste((0, 0, 0), (0, 0), sh)
        # black bezel + screen
        ImageDraw.Draw(bg).rounded_rectangle([px0 - bezel, py0 - bezel, px0 + pw + bezel, py0 + ph + bezel], r + bezel, fill=(17, 24, 19))
        bg.paste(shot, (px0, py0), rounded(shot, r))
        bg.save(f"out/{label}/{name}.png")   # bleeds off the bottom, like most App Store shots
        print(label, name, bg.size)
