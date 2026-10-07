# 🐶 Shorkie 3D

A walking **shorkie** (Shih Tzu × Yorkshire Terrier) built with [three.js](https://threejs.org/):
cream coat, tall pointy ears with fringes, short muzzle and the tongue sticking out.

The whole dog is procedural — there are no 3D model files.

## How it works

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
| Walk manually | `W A S D` or arrow keys |
| Bark | `Space` or the 🔊 button |
| Speed, pause, follow camera | panel in the corner |

Without manual control the dog walks around the circular path by itself.

## Project structure

```
index.html      page + three.js import map (CDN)
style.css       panel styles
src/main.js     scene, sky, camera, ground, controls and main loop
src/dog.js      shorkie model (body, head, ears, legs, tail) and walk animation
src/hair.js     hair lock generator and hair material
```

To tweak the look, change `PALETTE` in `src/dog.js` and the `addHair()` options (length, droop, flow, clump, …).
