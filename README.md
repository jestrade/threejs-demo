# 🐶 Shorkie 3D

A walking **shorkie** (Shih Tzu × Yorkshire Terrier) built with [three.js](https://threejs.org/):
cream coat, tall pointy ears with fringes, short muzzle and the tongue sticking out.

The app has two dogs, selectable in the panel:

- **Meshy model (sitting)** — a realistic scan-like model generated with [Meshy](https://www.meshy.ai/)
  from a photo of the real dog. It sits, looks around, twitches its ears, breathes and wags its tail,
  but it cannot walk (it has no skeleton and it was generated in a sitting pose).
- **Procedural (walking)** — a dog built entirely in code that walks around the path.

Open `?dog=procedural` to start with the walking dog.

## Meshy model

`models/shorkie-meshy.obj` + `models/shorkie-meshy.webp` come from a Meshy image-to-3D export
of the dog sitting on a sofa cushion. Two scripts in `tools/` prepared them:

- `tools/crop_meshy.py` fits the cushion's top surface, keeps only the faces above it (the dog),
  keeps the largest connected piece and writes smooth normals.
- `tools/recolor_texture.py` shifts the pinkish/grey texture towards the dog's real cream color
  and the purple tongue towards pink.

Since the mesh has no rig, `src/meshyDog.js` animates it in the vertex shader by regions
(head, ears, tail, chest), with per-vertex weights computed when the model loads.

To make the realistic dog walk, the model would need to be generated standing on four legs
and exported rigged with a walk cycle (e.g. GLB); it could then be loaded with `GLTFLoader`.

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
src/meshyDog.js loads the Meshy model and animates it by regions in the vertex shader
src/dog.js      procedural shorkie (body, head, ears, legs, tail) and walk animation
src/hair.js     hair lock generator and hair material
models/         Meshy model (OBJ) and its texture
tools/          scripts used to prepare the Meshy model
```

To tweak the look, change `PALETTE` in `src/dog.js` and the `addHair()` options (length, droop, flow, clump, …).
