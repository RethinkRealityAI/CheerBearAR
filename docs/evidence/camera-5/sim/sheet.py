import sys, glob
from PIL import Image
out=sys.argv[1]; fs=sys.argv[2:]
h=600
ims=[]
for f in fs:
    im=Image.open(f); r=h/im.height; ims.append(im.resize((int(im.width*r),h)))
W=sum(i.width for i in ims)+6*len(ims)
s=Image.new('RGB',(W,h),'white'); x=0
for i in ims: s.paste(i,(x,0)); x+=i.width+6
s.save(out,quality=72)
