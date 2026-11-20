# Tracks the picture frame Cheer Bear holds in public/media/capture/bts.mp4 (multi-scale, multi-angle NCC on the frame
# region of frame 0), smooths it and writes bts-track.json; src/experience/capture/bts-track.ts holds the result.
#   mkdir -p W/bts && ffmpeg -i public/media/capture/bts.mp4 W/bts/f%04d.png && python3 bts-track.py W/
# (W/ gets bts-track.json and check images with the tracked quad drawn.)
import sys
import numpy as np, json, glob
from PIL import Image, ImageDraw
S=sys.argv[1].rstrip('/')+'/'
files=sorted(glob.glob(S+'bts/f*.png'))
K=2 # half res
def gray(f):
    im=Image.open(f).convert('L'); return np.asarray(im.resize((im.width//K, im.height//K), Image.BILINEAR)).astype(np.float32)
frames=[gray(f) for f in files]
box0=(472/K, 486/K, 590/K, 630/K) # outer frame bbox in frame 0 (x0,y0,x1,y1) at half res
im0=Image.open(files[0]).convert('L').resize((714//K,1280//K), Image.BILINEAR)
# template = the frame region, inset so rotation does not pull in background corners; rotated + scaled about its centre
w0=(box0[2]-box0[0]); h0=(box0[3]-box0[1]); c0x=(box0[0]+box0[2])/2; c0y=(box0[1]+box0[3])/2
big=im0.crop((int(c0x-w0), int(c0y-h0), int(c0x+w0), int(c0y+h0)))
def tmpl(scale, ang):
    r=big.rotate(ang, resample=Image.BILINEAR, center=(w0, h0))
    r=r.resize((int(round(2*w0*scale)), int(round(2*h0*scale))), Image.BILINEAR)
    cw,ch=0.8*w0*scale/2, 0.8*h0*scale/2; cx,cy=r.width/2, r.height/2
    return np.asarray(r.crop((int(cx-cw),int(cy-ch),int(cx+cw),int(cy+ch)))).astype(np.float32)
scales=[0.92,0.96,1.0,1.04,1.08]
angs=[-12,-9,-6,-3,0,3,6,9,12]
T={(s,a):tmpl(s,a) for s in scales for a in angs}
def ncc(a,b):
    a=a-a.mean(); b=b-b.mean(); return (a*b).sum()/(np.sqrt((a*a).sum()*(b*b).sum())+1e-6)
cx,cy=(box0[0]+box0[2])/2,(box0[1]+box0[3])/2; sc=1.0; an=0
out=[]
for t,img in enumerate(frames):
    best=(-2,cx,cy,sc,an)
    for (s,a),tp in T.items():
        if abs(s-sc)>0.045 or abs(a-an)>6.5: continue
        th,tw=tp.shape
        for dy in range(-6,7):
            for dx in range(-6,7):
                x0=int(round(cx+dx-tw/2)); y0=int(round(cy+dy-th/2))
                p=img[y0:y0+th, x0:x0+tw]
                if p.shape!=tp.shape: continue
                v=ncc(p,tp)
                if v>best[0]: best=(v,cx+dx,cy+dy,s,a)
    v,cx,cy,sc,an=best
    out.append((cx*K,cy*K,sc,an,round(float(v),3)))
arr=np.array(out)
print('ncc min %.3f mean %.3f'%(arr[:,4].min(),arr[:,4].mean()))
for i in range(0,121,10): print(i, np.round(arr[i],2))
# smooth
def smooth(a,n=5):
    k=np.ones(n)/n; p=np.pad(a,(n//2,n//2),mode='edge'); return np.convolve(p,k,mode='valid')
sm=np.stack([smooth(arr[:,0]),smooth(arr[:,1]),smooth(arr[:,2],7),smooth(arr[:,3],5)],1)
json.dump({'fps':24,'track':[[round(float(a),1),round(float(b),1),round(float(c),3),round(float(d),1)] for a,b,c,d in sm]}, open(S+'bts-track.json','w'))
# picture interior in frame 0 (orig px)
inner0=(488,503,573,616)
c0=((472+590)/2,(486+630)/2)
for t in [0,20,40,60,80,100,120]:
    x,y,s,a=sm[t]
    import math
    th=-math.radians(a)  # PIL rotate is counter-clockwise for +a (image coords y down)
    def P(px,py):
        dx,dy=(px-c0[0])*s,(py-c0[1])*s
        return (x+dx*math.cos(th)-dy*math.sin(th), y+dx*math.sin(th)+dy*math.cos(th))
    q=[P(inner0[0],inner0[1]),P(inner0[2],inner0[1]),P(inner0[2],inner0[3]),P(inner0[0],inner0[3])]
    im=Image.open(files[t]).convert('RGB'); d=ImageDraw.Draw(im); d.polygon(q, outline=(0,255,0), width=2)
    im.crop((360,400,700,720)).save(S+f'trk{t:03d}.png')
