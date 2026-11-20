# side by side: before | after, with labels
import sys
from PIL import Image, ImageDraw
a, b, out = sys.argv[1], sys.argv[2], sys.argv[3]
sc = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
A, B = Image.open(a), Image.open(b)
h = max(A.height, B.height)
c = Image.new('RGB', (A.width + B.width + 30, h + 34), 'white')
c.paste(A, (0, 34)); c.paste(B, (A.width + 30, 34))
d = ImageDraw.Draw(c)
d.text((8, 8), 'BEFORE', fill='black'); d.text((A.width + 38, 8), 'AFTER', fill='black')
if sc != 1: c = c.resize((int(c.width * sc), int(c.height * sc)))
c.save(out, quality=78)
