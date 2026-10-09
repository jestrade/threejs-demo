# Usage: python3 crop_tripo.py <dumpdir>   (after dump_glb.mjs)
# Removes the sofa and its cushion from the Tripo export, stands the dog upright on y=0
# facing +Z and writes <dumpdir>/dog_pos.f32, dog_nrm.f32, dog_idx.u32 (uv.f32 is reused).
import numpy as np, sys
from PIL import Image
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
d = sys.argv[1]
V = np.fromfile(f'{d}/pos.f32', np.float32).reshape(-1, 3).astype(float)
N = np.fromfile(f'{d}/nrm.f32', np.float32).reshape(-1, 3).astype(float)
UV = np.fromfile(f'{d}/uv.f32', np.float32).reshape(-1, 2)
F = np.fromfile(f'{d}/idx.u32', np.uint32).reshape(-1, 3).astype(np.int64)
x, y, z = V.T

# the sofa fabric is blue-grey in the texture, the fur is warm grey/cream
hsv = np.asarray(Image.open(f'{d}/color.jpg').convert('HSV')).astype(float)
S = hsv.shape[0]
texel = hsv[np.clip((UV[:, 1] * S).astype(int), 0, S - 1), np.clip((UV[:, 0] * S).astype(int), 0, S - 1)]
h, s = texel[:, 0] * 360 / 255, texel[:, 1] / 255
fabric = (h > 180) & (h < 250) & (s > 0.08)

# cushion top: highest upward-facing fabric point per grid cell, robust quadratic fit
sel = fabric & (N[:, 1] > 0.6)
g = 0.025; pts = []
for gx in np.arange(-0.42, 0.42, g):
    for gz in np.arange(-0.5, 0.5, g):
        m = sel & (x >= gx) & (x < gx + g) & (z >= gz) & (z < gz + g)
        if m.sum() > 20: pts.append(V[np.argmax(np.where(m, y, -9))])
P = np.array(pts)
A = lambda px, pz: np.c_[np.ones(len(px)), px, pz, px**2, pz**2, px * pz]
inl = np.ones(len(P), bool)
for _ in range(8):
    c, *_ = np.linalg.lstsq(A(P[inl, 0], P[inl, 2]), P[inl, 1], rcond=None)
    r = P[:, 1] - A(P[:, 0], P[:, 2]) @ c
    inl = np.abs(r) < 2 * np.std(r[inl]) + 0.005
height = y - A(x, z) @ c

# keep faces above the cushion (and fabric only well above it), then the largest piece
keepv = (height > 0.006) & ~(fabric & (height < 0.05))
Fk = F[keepv[F].all(1)]
_, weld = np.unique(np.round(V * 2e4).astype(np.int64), axis=0, return_inverse=True)  # UV seams split vertices
W = weld.ravel()[Fk]
e = np.r_[W[:, [0, 1]], W[:, [1, 2]]]
_, lab = connected_components(coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(W.max() + 1,) * 2), directed=False)
fl = lab[W[:, 0]]
Fk = Fk[fl == np.bincount(fl).argmax()]
print('triangles kept', len(Fk), 'of', len(F))

# stand it on the plane of its lowest points (paws and haunches) ...
used = np.unique(Fk); Pd = V[used]
low = Pd[Pd[:, 1] < np.percentile(Pd[:, 1], 5)]
k, *_ = np.linalg.lstsq(np.c_[np.ones(len(low)), low[:, 0], low[:, 2]], low[:, 1], rcond=None)
up = np.array([-k[1], 1, -k[2]]); up /= np.linalg.norm(up)
ax = np.cross(up, [0, 1, 0]); sa = np.linalg.norm(ax); ax /= sa; ca = up[1]
K = np.array([[0, -ax[2], ax[1]], [ax[2], 0, -ax[0]], [-ax[1], ax[0], 0]])
R = np.eye(3) + sa * K + (1 - ca) * K @ K
# ... and turn it from facing +X to facing +Z
R = np.array([[0, 0, -1], [0, 1, 0], [1, 0, 0]]) @ R
Pd = V[used] @ R.T
# the body lies diagonally: align its main axis (from the torso, below the head) with Z
body = Pd[Pd[:, 1] < 0.2][:, [0, 2]]
w, vec = np.linalg.eigh(np.cov((body - body.mean(0)).T))
ax2 = vec[:, np.argmax(w)]
if ax2[1] < 0: ax2 = -ax2  # towards the head
yaw = np.arctan2(ax2[0], ax2[1])
cy, sy = np.cos(yaw), np.sin(yaw)
R = np.array([[cy, 0, -sy], [0, 1, 0], [sy, 0, cy]]) @ R
V2 = V @ R.T; N2 = N @ R.T
Pd = V2[used]
V2[:, 1] -= np.percentile(Pd[:, 1], 0.5)
low = Pd[Pd[:, 1] < np.percentile(Pd[:, 1], 5)]
V2[:, [0, 2]] -= low[:, [0, 2]].mean(0)
print('tilt corrected (deg)', np.degrees(np.arccos(ca)), 'yaw (deg)', np.degrees(yaw), 'bbox', V2[used].min(0), V2[used].max(0))
V2.astype(np.float32).tofile(f'{d}/dog_pos.f32')
N2.astype(np.float32).tofile(f'{d}/dog_nrm.f32')
Fk.astype(np.uint32).tofile(f'{d}/dog_idx.u32')
