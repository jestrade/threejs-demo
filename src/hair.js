import * as THREE from 'three';

// ---------- Material del pelo ----------
// El pelo está "esculpido" en mechas: tubos que se afinan hasta la punta y se
// abren en sub-mechas, como en un modelo esculpido a mano. El color por vértice
// lleva la oclusión (raíz y cara interna más oscuras).
// El vertex shader mueve las puntas (brisa + inercia al caminar) usando
// aHair.x = posición a lo largo de la mecha (0 raíz → 1 punta), aHair.y = fase.
export const hairUniforms = {
  uTime: { value: 0 },
  uMotion: { value: new THREE.Vector3() },
};

export const hairMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.72,
});
hairMaterial.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, hairUniforms);
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
attribute vec2 aHair;
uniform float uTime;
uniform vec3 uMotion;`
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
float hw = aHair.x * aHair.x;
transformed += hw * (uMotion + 0.006 * vec3(sin(uTime * 2.3 + aHair.y), 0.3 * sin(uTime * 3.1 + aHair.y * 2.0), cos(uTime * 1.9 + aHair.y * 1.3)));`
    );
};

const _tmp = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

function pushOut(p, C, R, limit) {
  _tmp.copy(p).sub(C).divide(R);
  const q = _tmp.lengthSq();
  if (q < limit) p.sub(C).multiplyScalar(Math.sqrt(limit / q)).add(C);
}

function tangentBasis(n, a, b) {
  a.crossVectors(n, Math.abs(n.y) < 0.95 ? UP : RIGHT).normalize();
  b.crossVectors(n, a);
}

/**
 * Cubre un elipsoide con mechas de pelo. Cada mecha crece desde la piel con
 * gravedad y peinado, y se divide en varias sub-mechas que se separan hacia la
 * punta.
 *
 * - count:    densidad (aprox. mechones finos equivalentes; mechas = count / lockSize)
 * - droop:    gravedad sobre la mecha
 * - flow:     dirección del peinado (espacio local del padre)
 * - lift:     cuánto se separa el pelo de la piel en la raíz
 * - part:     raya en el lomo: empuja el pelo de arriba hacia los lados
 * - spread:   abre el pelo hacia afuera en horizontal (bigotes)
 * - clump:    0 = las sub-mechas se abren mucho, 1 = quedan juntas
 * - wave:     ondulado suave (fracción del largo)
 * - thickness: grosor relativo de las mechas
 * - filter(n) / lengthFn(n): dónde crece el pelo y qué tan largo, según la normal
 */
export function addHair(parent, ctx, opts) {
  const {
    center = [0, 0, 0],
    radii = [0.1, 0.1, 0.1],
    count = 300,
    lockSize = 14,
    length = 0.1,
    lengthJitter = 0.4,
    droop = 1,
    flow = [0, 0, 0],
    lift = 0.5,
    part = 0,
    spread = 0,
    colors,
    tipColor = null,
    tipMix = 0,
    filter = null,
    lengthFn = null,
    messiness = 0.15,
    rootShade = 0.5,
    clump = 0.75,
    wave = 0.06,
    thickness = 1,
  } = opts;
  const { rand, quality } = ctx;

  const C = new THREE.Vector3(...center);
  const R = new THREE.Vector3(...radii);
  const flowV = new THREE.Vector3(...flow);
  const area = (4 * Math.PI * (R.x * R.y + R.x * R.z + R.y * R.z)) / 3;
  const lockCount = Math.max(4, Math.round((count / lockSize) * quality * 0.8));
  const spacing = Math.sqrt(area / lockCount / Math.PI); // radio de piel por mecha
  const baseR = spacing * 1.05 * thickness;

  const S = 8; // segmentos a lo largo
  const K = 7; // lados del tubo
  const SUBS = 3;

  const noise = new THREE.Vector3();
  const randomNoise = (s) => noise.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(s);
  const tipC = tipColor ? new THREE.Color(tipColor) : null;

  const positions = [];
  const colorsArr = [];
  const hairArr = [];
  const indices = [];

  const u3 = new THREE.Vector3();
  const n = new THREE.Vector3();
  const g = new THREE.Vector3();
  const gt = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const ws = new THREE.Vector3();
  const t1 = new THREE.Vector3();
  const t2 = new THREE.Vector3();
  const T = new THREE.Vector3();
  const B = new THREE.Vector3();
  const N2 = new THREE.Vector3();
  const off = new THREE.Vector3();
  const fan = new THREE.Vector3();
  const base = new THREE.Color();
  const c = new THREE.Color();
  const path = Array.from({ length: S + 1 }, () => new THREE.Vector3());
  const sub = Array.from({ length: S + 1 }, () => new THREE.Vector3());

  let locks = 0;
  let guard = 0;
  while (locks < lockCount && guard++ < lockCount * 60) {
    // ---- raíz de la mecha sobre el elipsoide ----
    const u = rand() * 2 - 1;
    const th = rand() * Math.PI * 2;
    const rr = Math.sqrt(1 - u * u);
    u3.set(rr * Math.cos(th), u, rr * Math.sin(th));
    n.set(u3.x / R.x, u3.y / R.y, u3.z / R.z).normalize();
    if (filter && !filter(n)) continue;

    let len = length * (1 - lengthJitter / 2 + rand() * lengthJitter);
    if (lengthFn) len *= lengthFn(n);

    // ---- mecha guía: gravedad + peinado ----
    g.set(0, -droop, 0).add(flowV);
    if (part) g.x += part * Math.sign(n.x || 1) * Math.max(0, n.y);
    if (spread) g.addScaledVector(_tmp.set(n.x, 0, n.z), spread);
    gt.copy(g).addScaledVector(n, -g.dot(n));
    dir.copy(n).multiplyScalar(lift).add(gt).add(randomNoise(messiness)).normalize();
    ws.crossVectors(dir, n);
    if (ws.lengthSq() < 1e-6) ws.crossVectors(dir, RIGHT);
    ws.normalize();

    path[0].set(C.x + u3.x * R.x * 0.96, C.y + u3.y * R.y * 0.96, C.z + u3.z * R.z * 0.96);
    const p = path[0].clone();
    const bend = 1.3 / S;
    const waveFreq = 4 + rand() * 4;
    const wavePh = rand() * Math.PI * 2;
    for (let i = 1; i <= S; i++) {
      dir.addScaledVector(g, bend).add(randomNoise(messiness * 0.35)).normalize();
      p.addScaledVector(dir, len / S);
      pushOut(p, C, R, 1.04);
      const t = i / S;
      path[i].copy(p).addScaledVector(ws, Math.sin(t * waveFreq + wavePh) * wave * len * t);
    }

    base.copy(colors[Math.floor(rand() * colors.length)]).offsetHSL(0, (rand() - 0.5) * 0.04, (rand() - 0.5) * 0.06);
    const phase = rand() * Math.PI * 2;
    tangentBasis(n, t1, t2);

    // ---- sub-mechas ----
    for (let j = 0; j < SUBS; j++) {
      const main = j === 0;
      const r0 = baseR * (main ? 1 : 0.5 + rand() * 0.25);
      const lf = main ? 1 : 0.65 + rand() * 0.3;
      const a = rand() * Math.PI * 2;
      off.set(0, 0, 0);
      if (!main) off.addScaledVector(t1, Math.cos(a) * baseR * 0.7).addScaledVector(t2, Math.sin(a) * baseR * 0.7);
      fan.copy(off).normalize().multiplyScalar((1 - clump) * len * 0.35).add(randomNoise(len * 0.08));
      const shade = 0.92 + rand() * 0.16;

      for (let i = 0; i <= S; i++) {
        const t = i / S;
        const f = t * lf * S;
        const i0 = Math.min(S - 1, Math.floor(f));
        sub[i].lerpVectors(path[i0], path[i0 + 1], f - i0).add(off).addScaledVector(fan, t * t);
        if (i > 0) pushOut(sub[i], C, R, 1.02);
      }

      const first = positions.length / 3;
      for (let i = 0; i <= S; i++) {
        const t = i / S;
        T.subVectors(sub[Math.min(S, i + 1)], sub[Math.max(0, i - 1)]).normalize();
        B.crossVectors(T, n);
        if (B.lengthSq() < 1e-6) B.crossVectors(T, UP);
        B.normalize();
        N2.crossVectors(B, T).normalize();
        if (N2.dot(n) < 0) N2.negate();

        // perfil: se ensancha cerca de la raíz y se afina hasta la punta
        const r = r0 * (0.6 + 0.4 * Math.min(1, t * 5)) * Math.pow(1 - t, 0.85) + 0.0004;

        c.copy(base).multiplyScalar(shade * (rootShade + (1 - rootShade) * Math.pow(t, 0.6)));
        if (tipC) c.lerp(tipC, tipMix * t * t);

        for (let k = 0; k < K; k++) {
          const ang = (k / K) * Math.PI * 2;
          const cs = Math.cos(ang);
          const sn = Math.sin(ang);
          // sección aplanada contra la piel
          positions.push(
            sub[i].x + (B.x * cs + N2.x * sn * 0.75) * r,
            sub[i].y + (B.y * cs + N2.y * sn * 0.75) * r,
            sub[i].z + (B.z * cs + N2.z * sn * 0.75) * r
          );
          // la cara que mira a la piel queda en sombra
          const ao = 0.7 + 0.3 * (0.5 + 0.5 * sn);
          colorsArr.push(c.r * ao, c.g * ao, c.b * ao);
          hairArr.push(t, phase);
        }
      }
      for (let i = 0; i < S; i++) {
        for (let k = 0; k < K; k++) {
          const a0 = first + i * K + k;
          const b0 = first + i * K + ((k + 1) % K);
          indices.push(a0, a0 + K, b0, b0, a0 + K, b0 + K);
        }
      }
    }
    locks++;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colorsArr, 3));
  geo.setAttribute('aHair', new THREE.Float32BufferAttribute(hairArr, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const m = new THREE.Mesh(geo, hairMaterial);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  ctx.strands += locks;
  return m;
}
