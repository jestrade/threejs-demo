# Usage: python3 tools/recolor_texture.py <meshy texture> <out.webp>
# Shifts the pinkish/grey Meshy texture to the dog's cream color and the tongue to pink.
import numpy as np, sys
from PIL import Image
im=Image.open(sys.argv[1]).convert('RGB')
hsv=np.asarray(im.convert('HSV')).astype(float)
h,s,v=hsv[...,0]*360/255,hsv[...,1]/255,hsv[...,2]/255
# pink/salmon, low-saturation areas → cream; keep saturated (tongue) and dark (eyes, nose)
pink=((h>300)|(h<25))&(s<0.42)&(v>0.25)
w=np.clip((0.42-s)/0.12,0,1)*pink
target_h=34.0
dh=((target_h-h+180)%360)-180
h2=(h+dh*w)%360
s2=s*(1-w)+np.clip(s*1.15+0.08,0,0.4)*w
v2=v*(1-w*0.04)
# grises (restos del cojín y sombras horneadas) → crema
grey=(s<0.12)&(v>0.3)
h2=np.where(grey,target_h,h2)
s2=np.where(grey,0.16+s*0.5,s2)
# lengua magenta → rosa
tongue=(h>270)&(h<335)&(s>=0.42)
h2=np.where(tongue,345,h2)
s2=np.where(tongue,s*0.75,s2)
out=np.stack([h2/360*255,s2*255,v2*255],-1).astype(np.uint8)
res=Image.fromarray(out,'HSV').convert('RGB')
res.save(sys.argv[2],quality=88,method=6)
