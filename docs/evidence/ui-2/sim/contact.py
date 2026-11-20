import sys
from PIL import Image
d, tag, out = sys.argv[1], sys.argv[2], sys.argv[3]
fs = sys.argv[4].split(',')
ims=[Image.open(f'{d}/{tag}-{f}.jpg') for f in fs]
w=sum(i.width for i in ims)+10*len(ims); h=max(i.height for i in ims)
c=Image.new('RGB',(w,h),'white'); x=0
for i in ims: c.paste(i,(x,0)); x+=i.width+10
sc=float(sys.argv[5]) if len(sys.argv)>5 else 0.5
c.resize((int(w*sc),int(h*sc))).save(out,quality=80)
