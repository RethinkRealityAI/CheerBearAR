# The 3D Photo's life-size Happi standee, from a render of the real model (tools/render_pose.py, clip "wave" at 0.35):
# a white die-cut edge round the silhouette, gaps closed, and a face hole in the white face panel.
# Writes the texture (RGBA webp) and prints the hole + size numbers for src/happi/cutout.ts.
import sys, json
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
from scipy import ndimage
src, out = sys.argv[1], sys.argv[2]
DEF_H = 2.3            # default standee height (m): the hole centre lands near 1.4 m
HOLE = (0.30, 0.38)    # face hole (m), a vertical oval
im = Image.open(src).convert('RGBA')
a = np.array(im)
h, w = a.shape[:2]
alpha = a[..., 3] > 128
# the white face panel = the biggest near-white blob in the top half
white = (a[..., 0] > 225) & (a[..., 1] > 225) & (a[..., 2] > 225) & alpha
white[int(h * 0.55):] = False
lab, n = ndimage.label(white)
k = np.argmax(ndimage.sum(white, lab, range(1, n + 1))) + 1
ys, xs = np.where(lab == k)
cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
# silhouette: close small gaps (between the legs, under the arm), then the die-cut edge
sil = ndimage.binary_closing(alpha, structure=np.ones((3, 3)), iterations=10)
sil = ndimage.binary_fill_holes(sil)
edge = ndimage.binary_dilation(sil, structure=np.ones((3, 3)), iterations=int(h * 0.009))
edge_img = Image.fromarray((edge * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2)).point(lambda v: 255 if v > 127 else 0)
board = Image.new('RGBA', (w, h), (0, 0, 0, 0))
board.paste(Image.new('RGBA', (w, h), (255, 255, 255, 255)), (0, 0), edge_img)
board.alpha_composite(im)
# the hole
px = h / DEF_H
rx, ry = HOLE[0] / 2 * px, HOLE[1] / 2 * px
m = Image.new('L', (w * 4, h * 4), 0)
ImageDraw.Draw(m).ellipse([(cx - rx) * 4, (cy - ry) * 4, (cx + rx) * 4, (cy + ry) * 4], fill=255)
m = m.resize((w, h), Image.LANCZOS)
ba = np.array(board)
ba[..., 3] = (ba[..., 3].astype(int) * (255 - np.array(m).astype(int)) // 255).astype(np.uint8)
board = Image.fromarray(ba)
# a thin navy ring round the hole so it reads as a cut
ring = Image.new('L', (w * 4, h * 4), 0)
d = ImageDraw.Draw(ring)
t = h * 0.0035 * 4
d.ellipse([(cx - rx) * 4 - t, (cy - ry) * 4 - t, (cx + rx) * 4 + t, (cy + ry) * 4 + t], fill=255)
d.ellipse([(cx - rx) * 4, (cy - ry) * 4, (cx + rx) * 4, (cy + ry) * 4], fill=0)
ring = ring.resize((w, h), Image.LANCZOS)
board.paste(Image.new('RGBA', (w, h), (40, 58, 143, 255)), (0, 0), ring)
OUTH = 1440
board = board.resize((round(w * OUTH / h), OUTH), Image.LANCZOS)
board.save(out, 'WEBP', quality=86, method=6)
info = {'aspect': w / h, 'hole': {'x': cx / w - 0.5, 'y': 1 - cy / h, 'rx': rx / h, 'ry': ry / h}, 'defH': DEF_H}
print(json.dumps(info))
