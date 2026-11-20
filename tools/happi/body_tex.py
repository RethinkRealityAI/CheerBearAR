# Flat, crisp textures for Happi's rebuilt body (round 6): coat, sleeves, shirt. Colours from the brand art.
# Written as PNGs, packed into the .blend by build_body.py.
import math, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
OUT = sys.argv[1] if len(sys.argv) > 1 else '/home/user/happi-work/tex6'
import os; os.makedirs(OUT, exist_ok=True)
NAVY = (40, 58, 143); ORANGE = (243, 115, 33); WHITE = (250, 250, 248)
SS = 2  # supersample, then downscale for clean edges

def save(im, name):
    im = im.resize((im.width // SS, im.height // SS), Image.LANCZOS)
    im.save(f'{OUT}/{name}.png'); print('TEX', name, im.size)

def pinwheel(d, cx, cy, r):
    """The happi crest: a white disc with six curved navy blades (a tomoe-like pinwheel)."""
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE)
    for k in range(6):
        a0 = k * math.pi / 3
        pts = []
        for i in range(24):
            t = i / 23
            a = a0 + t * 1.25
            rr = r * (0.18 + 0.78 * t)
            pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
        for i in range(23, -1, -1):
            t = i / 23
            a = a0 + t * 1.25 + 0.55 * (1 - t) + 0.12
            rr = r * (0.18 + 0.78 * t)
            pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
        d.polygon(pts, fill=NAVY)
    d.ellipse([cx - r * 0.16, cy - r * 0.16, cx + r * 0.16, cy + r * 0.16], fill=WHITE)

# ---- coat body: u = round the body from the left front edge, over the back, to the right front edge; v = hem->collar
W, H = 2048 * SS, 640 * SS
im = Image.new('RGB', (W, H), NAVY); d = ImageDraw.Draw(im)
BAND = int(0.075 * W)            # the orange front bands (lapels)
d.rectangle([0, 0, BAND, H], fill=ORANGE); d.rectangle([W - BAND, 0, W, H], fill=ORANGE)
d.rectangle([0, 0, W, int(0.07 * H)], fill=ORANGE)          # the collar round the back of the neck (top of v)
# a thin navy line between band and coat (the art's outline, softened to navy)
for x in (BAND, W - BAND):
    d.rectangle([x - 3 * SS, int(0.07 * H), x + 3 * SS, H], fill=(28, 40, 104))
# crests high on the chest, just outside the bands
cr = int(0.052 * W)
for cx in (BAND + int(0.085 * W), W - BAND - int(0.085 * W)):
    pinwheel(d, cx, int(0.24 * H), cr)
# hem checker: two rows at the front corners
cs = int(0.028 * W)
for side in (0, 1):
    x0 = BAND + 2 * SS if side == 0 else W - BAND - 6 * cs - 2 * SS
    for row in range(2):
        for col in range(6):
            if (row + col) % 2 == 0:
                y = H - (row + 1) * cs
                d.rectangle([x0 + col * cs, y, x0 + (col + 1) * cs - 1, y + cs - 1], fill=WHITE)
save(im, 'coat')

# ---- sleeve: u = round the sleeve (0 = top), v = shoulder (top of image) -> cuff (bottom). Diamonds at the cuff.
W, H = 1024 * SS, 512 * SS
im = Image.new('RGB', (W, H), NAVY); d = ImageDraw.Draw(im)
s = int(W / 10)                   # diamond size: 10 around the sleeve
y0 = int(0.56 * H)
for row in range(-1, 6):
    for col in range(0, 11):
        cx = col * s + (s / 2 if row % 2 else 0); cy = y0 + row * s / 2 + s / 2
        if cy - s / 2 < y0: continue
        d.polygon([(cx, cy - s / 2), (cx + s / 2, cy), (cx, cy + s / 2), (cx - s / 2, cy)], fill=WHITE if (row % 2 == 0) else NAVY)
d.rectangle([0, H - int(0.05 * H), W, H], fill=WHITE)      # a clean white edge at the opening
save(im, 'sleeve')

# ---- shirt: u = round the body (0.5 = front), v = bottom -> top. White apple, orange NYC.
W, H = 1024 * SS, 512 * SS
im = Image.new('RGB', (W, H), ORANGE); d = ImageDraw.Draw(im)
cx, cy, R = W // 2, int(0.48 * H), int(0.085 * W)
d.ellipse([cx - R * 1.02, cy - R * 0.9, cx + R * 0.1, cy + R * 0.95], fill=WHITE)
d.ellipse([cx - R * 0.1, cy - R * 0.9, cx + R * 1.02, cy + R * 0.95], fill=WHITE)
d.ellipse([cx - R * 0.75, cy - R * 0.2, cx + R * 0.75, cy + R * 1.1], fill=WHITE)
d.polygon([(cx - R * 0.05, cy - R * 0.85), (cx + R * 0.05, cy - R * 0.85), (cx + R * 0.12, cy - R * 1.25), (cx + R * 0.02, cy - R * 1.27)], fill=WHITE)
d.ellipse([cx + R * 0.12, cy - R * 1.32, cx + R * 0.62, cy - R * 1.05], fill=WHITE)
f = ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf', int(R * 0.78))
tw = d.textlength('NYC', font=f)
d.text((cx - tw / 2, cy - R * 0.38), 'NYC', font=f, fill=ORANGE)
save(im, 'shirt')
