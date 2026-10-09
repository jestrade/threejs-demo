# 🐶 Shorkie 3D

A walking **shorkie** (Shih Tzu × Yorkshire Terrier) built with [three.js](https://threejs.org/):
cream coat, tall pointy ears with fringes, short muzzle and the tongue sticking out.

The app has five dogs, selectable in the panel:

- **Tripo walking** (default) — the body and head of the [Tripo](https://www.tripo3d.ai/) model,
  "stood up" on the procedural legs and tail (see below).
- **Tripo model (lying down)** — a much more detailed model generated with Tripo from a photo of
  the real dog: sculpted hair locks in the geometry plus a normal map. It lies on the ground, looks
  around, twitches its ears, breathes and wags its tail, but it cannot walk (no skeleton).
- **Meshy walking** — the real dog's head from the Meshy model on the articulated
  procedural body, whose coat is tinted with colors sampled from the Meshy texture.
- **Meshy model (sitting)** — a realistic scan-like model generated with [Meshy](https://www.meshy.ai/)
  from a photo of the real dog. It sits, looks around, twitches its ears, breathes and wags its tail,
  but it cannot walk (it has no skeleton and it was generated in a sitting pose).
- **Procedural (walking)** — a dog built entirely in code that walks around the path.

Open `?dog=tripo`, `?dog=meshy-walk`, `?dog=meshy` or `?dog=procedural` to start with another dog.

## Tripo model

`models/shorkie-tripo.glb` comes from a Tripo image-to-3D export (PBR GLB, ~1M vertices, 22 MB) of the
dog lying on a sofa cushion. The scripts in `tools/tripo/` turn it into a 2 MB web model:

```bash
cd tools/tripo && npm install
node dump_glb.mjs tripo_export.glb work      # decode meshopt → raw arrays + textures
python3 crop_tripo.py work                   # remove sofa/cushion, stand upright facing +Z (numpy, scipy, Pillow)
python3 textures_tripo.py work               # cream recolor + 2K/1K WebP textures
node build_glb.mjs work ../../models/shorkie-tripo.glb 0.15   # simplify to ~140k triangles
```

- `crop_tripo.py` tells the sofa from the dog by the texture color (blue-grey fabric), fits the
  cushion's top surface, keeps what is above it (the largest connected piece, after welding the UV
  seams), levels it on the plane of its paws and aligns the body axis with +Z.
- `build_glb.mjs` simplifies with meshoptimizer and writes a GLB with `EXT_meshopt_compression`,
  `KHR_mesh_quantization` and `EXT_texture_webp`; the app loads it with `GLTFLoader` + `MeshoptDecoder`.

`src/tripoDog.js` reuses the region animation and the head-swap hybrid from `src/meshyDog.js`.

## Meshy model

`models/shorkie-meshy.obj` + `models/shorkie-meshy.webp` come from a Meshy image-to-3D export
of the dog sitting on a sofa cushion. Two scripts in `tools/` prepared them:

- `tools/crop_meshy.py` fits the cushion's top surface, keeps only the faces above it (the dog),
  keeps the largest connected piece and writes smooth normals.
- `tools/recolor_texture.py` shifts the pinkish/grey texture towards the dog's real cream color
  and the purple tongue towards pink.

Since the mesh has no rig, `src/meshyDog.js` animates it in the vertex shader by regions
(head, ears, tail, chest), with per-vertex weights computed when the model loads.

### Why the walking version is a hybrid

The Meshy mesh is a single surface in a sitting pose: the body is turned diagonally and the folded
hind legs are fused with the body, so there are no separate legs to rig. Re-posing it standing would
badly distort it. Instead, `loadMeshyWalker()` cuts the head (above the neck) out of the mesh and
mounts it on the procedural dog, replacing its procedural head; the head keeps the procedural
head animation (bobbing, looking around, barking).

The Tripo model lies down with the legs folded under the body. Its walking version
(`loadTripoWalker()`) keeps the real coat instead: it cuts off what touches the ground (folded legs),
stretches the body vertically to standing height, levels the back (the rump is much lower when lying),
widens it a little and mounts it on the procedural dog built with `bodyHair: false` (only legs and
tail). The head moves with the procedural head animation through the same region rig. For a fully realistic walking dog, the model would need to be
generated standing on four legs and exported rigged with a walk cycle (e.g. GLB with animations).

## How the procedural dog works

### Sculpted hair locks

The coat is made of thousands of hair **locks**, styled after hand-sculpted dog models:

- each lock grows from the skin with gravity and a combing direction, and never goes through the body;
- it is a tapered tube with a flattened cross-section that splits into 3 sub-locks fanning out near the tip;
- spine parting, a long "skirt", moustache and beard falling to the sides, fringed ears with tufts inside;
- vertex colors carry the ambient occlusion (darker roots and undersides) and tan-tinted tips on the head and ears;
- the tips sway with a light breeze and lag behind with the walking motion (vertex shader).

### Face and lighting

- Eyes have a procedural iris texture and a wet clearcoat; the nose has a leathery bump map.
- The scene uses a physical sky (`Sky`) that also feeds the image-based lighting, plus a grass bounce.

### Animation

- **Legs**: 4-beat walk (left hind → left fore → right hind → right fore); hip, knee/hock and paw bend during the swing.
- **Body**: bobbing and slight rolling with each step.
- **Head and ears**: the head is stabilized while walking and looks around when idle; the ears bounce and twitch.
- Tail wagging, panting tongue and blinking.

## Running it

No build step — just serve the folder statically (ES modules don't load from `file://`):

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

### Quality

On slower machines add `?quality=0.5` (or lower) to the URL to generate fewer locks.
Touch devices use `0.5` by default.

### GitHub Pages

In **Settings → Pages**, choose *Deploy from a branch* → `main` / `(root)`.

## Controls

| Action | Control |
| --- | --- |
| Orbit / zoom camera | drag / mouse wheel |
| Choose dog | panel selector |
| Walk manually (procedural dog) | `W A S D` or arrow keys |
| Bark | `Space` or the 🔊 button |
| Speed, pause, follow camera | panel in the corner |

Without manual control the procedural dog walks around the circular path by itself.

## Project structure

```
index.html      page + three.js import map (CDN)
style.css       panel styles
src/main.js     scene, sky, camera, ground, controls, dog switching and main loop
src/tripoDog.js Tripo model (GLB): lying down and walking hybrid
src/meshyDog.js Meshy model: sitting (animated by regions) and walking hybrid (Meshy head + procedural body)
src/dog.js      procedural shorkie (body, head, ears, legs, tail) and walk animation
src/hair.js     hair lock generator and hair material
models/         Tripo model (GLB) and Meshy model (OBJ + texture)
tools/          scripts used to prepare the Meshy (tools/*.py) and Tripo (tools/tripo/) models
```

To tweak the look, change `PALETTE` in `src/dog.js` and the `addHair()` options (length, droop, flow, clump, …).
