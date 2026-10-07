# Usage: python3 tools/crop_meshy.py <meshy.obj> <out.obj> <margin>   (e.g. margin 0.004)
# Removes the sofa cushion from the Meshy export and writes smooth normals.
import numpy as np, sys
src, out, margin = sys.argv[1], sys.argv[2], float(sys.argv[3])
V=[];T=[];F=[]
for l in open(src):
    if l.startswith('v '): V.append(l.split()[1:4])
    elif l.startswith('vt '): T.append(l.split()[1:3])
    elif l.startswith('f '): F.append([tuple(int(x)-1 for x in p.split('/')[:2]) for p in l.split()[1:]])
V=np.array(V,float); T=np.array(T,float); F=np.array(F)
x,y,z=V.T
# top surface of the cushion outside the dog footprint: max y per grid cell
foot=(x>-0.2)&(x<0.27)&(z>-0.28)&(z<0.32)
g=0.03; pts=[]
for gx in np.arange(-0.36,0.36,g):
  for gz in np.arange(-0.36,0.36,g):
    m=(~foot)&(x>=gx)&(x<gx+g)&(z>=gz)&(z<gz+g)
    if m.sum()>5: i=np.argmax(np.where(m,y,-9)); pts.append(V[i])
P=np.array(pts)
# drop the ragged rim: keep cells reasonably inside the cushion
r=np.maximum(np.abs(P[:,0]),np.abs(P[:,2])); P=P[r<0.3]
A=np.c_[np.ones(len(P)),P[:,0],P[:,2],P[:,0]**2,P[:,2]**2,P[:,0]*P[:,2]]
coef,*_=np.linalg.lstsq(A,P[:,1],rcond=None)
print('fit pts',len(P),'resid',np.abs(A@coef-P[:,1]).mean(), 'center top', coef[0])
def top(px,pz): return coef[0]+coef[1]*px+coef[2]*pz+coef[3]*px**2+coef[4]*pz**2+coef[5]*px*pz
fv=V[F[:,:,0]]  # nf,3,3
keep=(fv[:,:,1].min(1) > top(fv[:,:,0].mean(1),fv[:,:,2].mean(1))+margin)
# largest connected component
par=np.arange(len(V))
def find(a):
    r=a
    while par[r]!=r: r=par[r]
    while par[a]!=r: par[a],a=r,par[a]
    return r
for f in F[keep]:
    a=find(f[0][0])
    for k in (1,2):
        b=find(f[k][0])
        if b!=a: par[b]=a
roots=np.array([find(f[0][0]) for f in F[keep]])
u,c=np.unique(roots,return_counts=True); print('components',len(u),sorted(c)[-4:])
idx=np.where(keep)[0]; keep[:]=False; keep[idx[roots==u[np.argmax(c)]]]=True
print('kept',keep.sum())
used=np.unique(F[keep][:,:,0]); usedt=np.unique(F[keep][:,:,1])
vmap=-np.ones(len(V),int); vmap[used]=np.arange(len(used))
tmap=-np.ones(len(T),int); tmap[usedt]=np.arange(len(usedt))
# smooth vertex normals (area weighted), shared across UV seams
Fk=F[keep]; P=V[used]; tri=vmap[Fk[:,:,0]]
fn=np.cross(P[tri[:,1]]-P[tri[:,0]],P[tri[:,2]]-P[tri[:,0]])
N=np.zeros_like(P)
for k in range(3): np.add.at(N,tri[:,k],fn)
N/=np.linalg.norm(N,axis=1,keepdims=True)+1e-12
with open(out,'w') as o:
    o.write('# Shorkie generated with Meshy from a photo; sofa cushion removed\n')
    for p in V[used]: o.write('v %.5f %.5f %.5f\n'%tuple(p))
    for t in T[usedt]: o.write('vt %.5f %.5f\n'%tuple(t))
    for n in N: o.write('vn %.3f %.3f %.3f\n'%tuple(n))
    for f in F[keep]: o.write('f '+' '.join('%d/%d/%d'%(vmap[a]+1,tmap[b]+1,vmap[a]+1) for a,b in f)+'\n')
