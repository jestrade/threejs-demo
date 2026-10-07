import * as THREE from 'three';

// Colores tomados de la foto de referencia: pelaje crema/beige claro,
// un poco más tostado en la cara y las orejas, interior de oreja rosado.
const PALETTE = {
  fur: new THREE.Color('#ecdcc6'),
  furWarm: new THREE.Color('#dcc2a0'),
  furTan: new THREE.Color('#c39f7a'),
  skin: new THREE.Color('#bba184'),
  earInner: new THREE.Color('#d8a49c'),
  nose: new THREE.Color('#141010'),
  eye: new THREE.Color('#1d110b'),
  tongue: new THREE.Color('#e46f86'),
  mouth: new THREE.Color('#3a2020'),
};

// Generador pseudoaleatorio con semilla, para que el pelaje sea siempre igual.
function mulberry32(seed) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Material del pelo ----------
// Un solo material para todos los mechones. El vertex shader mueve las puntas
// (brisa + inercia al caminar) usando aHair.x = posición a lo largo del mechón.
const hairUniforms = {
  uTime: { value: 0 },
  uMotion: { value: new THREE.Vector3() },
};

const hairMaterial = new THREE.MeshPhysicalMaterial({
  vertexColors: true,
  roughness: 0.62,
  sheen: 1,
  sheenRoughness: 0.45,
  sheenColor: new THREE.Color('#fff1dc'),
  side: THREE.DoubleSide,
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
transformed += hw * (uMotion + 0.005 * vec3(sin(uTime * 2.7 + aHair.y), 0.0, cos(uTime * 2.1 + aHair.y * 1.3)));`
    );
};

const skinMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.skin, roughness: 1 });

function mesh(geometry, material) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function ellipsoid(rx, ry, rz, material, segments = 24) {
  const m = mesh(new THREE.SphereGeometry(1, segments, Math.round(segments * 0.75)), material);
  m.scale.set(rx, ry, rz);
  return m;
}

/**
 * Cubre un elipsoide con mechones de pelo curvos (un solo BufferGeometry).
 * Cada mechón es un tubo de 3 lados, afinado hacia la punta, que nace en la
 * superficie y se dobla por la gravedad sin atravesar el cuerpo.
 *
 * - droop:  fuerza de gravedad sobre el mechón
 * - flow:   dirección en que se "peina" (espacio local del padre)
 * - lift:   cuánto sale el pelo perpendicular a la piel al nacer
 * - part:   raya en el lomo: empuja el pelo de arriba hacia los lados
 * - spread: abre el pelo hacia afuera en horizontal (bigotes)
 * - filter(n) / lengthFn(n): dónde poner pelo y qué tan largo, según la normal
 */
function addHair(parent, ctx, opts) {
  const {
    center = [0, 0, 0],
    radii = [0.1, 0.1, 0.1],
    count: baseCount = 300,
    length = 0.1,
    lengthJitter = 0.45,
    droop = 1,
    flow = [0, 0, 0],
    lift = 0.5,
    part = 0,
    spread = 0,
    width = 0.0055,
    colors = [PALETTE.fur],
    filter = null,
    lengthFn = null,
    messiness = 0.15,
    segments = 4,
    rootShade = 0.5,
  } = opts;
  const { rand, quality } = ctx;

  const count = Math.max(8, Math.round(baseCount * quality));
  const strandWidth = width / Math.sqrt(quality); // menos mechones → más gruesos
  const RING = 3;
  const vertsPer = (segments + 1) * RING;

  const pos = new Float32Array(count * vertsPer * 3);
  const nor = new Float32Array(count * vertsPer * 3);
  const col = new Float32Array(count * vertsPer * 3);
  const hair = new Float32Array(count * vertsPer * 2);
  const idx = new Uint32Array(count * segments * RING * 6);

  const C = new THREE.Vector3(...center);
  const R = new THREE.Vector3(...radii);
  const flowV = new THREE.Vector3(...flow);
  const n = new THREE.Vector3();
  const p = new THREE.Vector3();
  const g = new THREE.Vector3();
  const gt = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const s1 = new THREE.Vector3();
  const s2 = new THREE.Vector3();
  const rad = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const noise = new THREE.Vector3();
  const helperY = new THREE.Vector3(0, 1, 0);
  const helperX = new THREE.Vector3(1, 0, 0);
  const base = new THREE.Color();
  const c = new THREE.Color();
  const white = new THREE.Color(1, 1, 1);

  const randomNoise = (scale) => noise.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(scale);

  let s = 0;
  let vi = 0;
  let ii = 0;
  let guard = 0;
  while (s < count && guard++ < count * 40) {
    const u = rand() * 2 - 1;
    const th = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const ux = r * Math.cos(th);
    const uy = u;
    const uz = r * Math.sin(th);
    n.set(ux / R.x, uy / R.y, uz / R.z).normalize();
    if (filter && !filter(n)) continue;

    p.set(C.x + ux * R.x * 0.97, C.y + uy * R.y * 0.97, C.z + uz * R.z * 0.97);

    let len = length * (1 - lengthJitter / 2 + rand() * lengthJitter);
    if (lengthFn) len *= lengthFn(n);

    // Fuerza total sobre el mechón
    g.set(0, -droop, 0).add(flowV);
    if (part) g.x += part * Math.sign(n.x || 1) * Math.max(0, n.y);
    if (spread) g.addScaledVector(tmp.set(n.x, 0, n.z), spread);

    // Dirección inicial: sale de la piel y se acuesta según la fuerza tangencial
    gt.copy(g).addScaledVector(n, -g.dot(n));
    dir.copy(n).multiplyScalar(lift).add(gt).add(randomNoise(messiness)).normalize();

    const w = strandWidth * (0.7 + rand() * 0.6);
    const phase = rand() * Math.PI * 2;
    const twist = rand() * Math.PI;
    base.copy(colors[Math.floor(rand() * colors.length)]).offsetHSL(0, (rand() - 0.5) * 0.04, (rand() - 0.5) * 0.07);

    const bend = 1.3 / segments;
    const step = len / segments;
    const first = vi;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;

      s1.crossVectors(dir, Math.abs(dir.y) < 0.9 ? helperY : helperX).normalize();
      s2.crossVectors(dir, s1);
      const ringR = w * (1 - 0.85 * t);

      // raíz oscura (oclusión) → punta clara
      c.copy(base).multiplyScalar(rootShade + (1 - rootShade) * Math.pow(t, 0.7)).lerp(white, 0.08 * t);

      for (let k = 0; k < RING; k++) {
        const a = twist + (k * Math.PI * 2) / RING;
        rad.copy(s1).multiplyScalar(Math.cos(a)).addScaledVector(s2, Math.sin(a));
        pos[vi * 3] = p.x + rad.x * ringR;
        pos[vi * 3 + 1] = p.y + rad.y * ringR;
        pos[vi * 3 + 2] = p.z + rad.z * ringR;
        // normal mezclada con la de la piel: sombreado suave y coherente
        tmp.copy(rad).multiplyScalar(0.45).add(n).normalize();
        nor[vi * 3] = tmp.x;
        nor[vi * 3 + 1] = tmp.y;
        nor[vi * 3 + 2] = tmp.z;
        col[vi * 3] = c.r;
        col[vi * 3 + 1] = c.g;
        col[vi * 3 + 2] = c.b;
        hair[vi * 2] = t;
        hair[vi * 2 + 1] = phase;
        vi++;
      }

      if (i < segments) {
        dir.addScaledVector(g, bend).add(randomNoise(messiness * 0.4)).normalize();
        p.addScaledVector(dir, step);
        // que no se meta dentro del cuerpo
        tmp.copy(p).sub(C).divide(R);
        const q = tmp.lengthSq();
        if (q < 1.02) p.sub(C).multiplyScalar(Math.sqrt(1.02 / q)).add(C);
      }
    }

    for (let i = 0; i < segments; i++) {
      for (let k = 0; k < RING; k++) {
        const a0 = first + i * RING + k;
        const b0 = first + i * RING + ((k + 1) % RING);
        idx[ii++] = a0;
        idx[ii++] = b0;
        idx[ii++] = b0 + RING;
        idx[ii++] = a0;
        idx[ii++] = b0 + RING;
        idx[ii++] = a0 + RING;
      }
    }
    s++;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, vi * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, vi * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, vi * 3), 3));
  geo.setAttribute('aHair', new THREE.BufferAttribute(hair.subarray(0, vi * 2), 2));
  geo.setIndex(new THREE.BufferAttribute(idx.subarray(0, ii), 1));
  geo.computeBoundingSphere();

  const m = new THREE.Mesh(geo, hairMaterial);
  m.castShadow = true;
  // sin auto-sombra: el pelaje claro se veía grisáceo
  m.receiveShadow = false;
  parent.add(m);
  ctx.strands += s;
  return m;
}

function makeEar(side, ctx) {
  // side = +1 (oreja en +X) o -1
  const ear = new THREE.Group();
  ear.position.set(0.09 * side, 0.17, -0.01);
  ear.scale.setScalar(1.25);
  ear.rotation.set(-0.15, 0.3 * side, -0.3 * side);

  // Oreja triangular y delgada
  const outer = mesh(new THREE.ConeGeometry(0.072, 0.21, 24).translate(0, 0.105, 0), skinMaterial);
  outer.scale.z = 0.35;
  ear.add(outer);

  const inner = mesh(
    new THREE.ConeGeometry(0.052, 0.165, 24).translate(0, 0.0825, 0),
    new THREE.MeshPhysicalMaterial({ color: PALETTE.earInner, roughness: 0.55, sheen: 0.4 })
  );
  inner.scale.z = 0.22;
  inner.position.set(0, 0.012, 0.016);
  ear.add(inner);

  // Pelo corto que cubre el dorso de la oreja, peinado hacia la punta
  addHair(ear, ctx, {
    center: [0, 0.075, -0.004],
    radii: [0.062, 0.09, 0.022],
    count: 700,
    length: 0.03,
    droop: -0.9,
    lift: 0.15,
    width: 0.0035,
    colors: [PALETTE.furWarm, PALETTE.furTan],
    filter: (h) => h.z < 0.1,
    rootShade: 0.7,
  });
  // Flecos largos en los bordes (como en la foto)
  addHair(ear, ctx, {
    center: [0, 0.06, 0],
    radii: [0.062, 0.08, 0.02],
    count: 800,
    length: 0.065,
    droop: 0.35,
    flow: [0.9 * side, 0.25, -0.2],
    lift: 0.3,
    width: 0.0035,
    colors: [PALETTE.fur, PALETTE.furWarm, PALETTE.furTan],
    filter: (h) => Math.abs(h.x) > 0.7 && h.x * side > 0,
  });
  // Penacho en la punta
  addHair(ear, ctx, {
    center: [0, 0.185, 0],
    radii: [0.014, 0.03, 0.01],
    count: 80,
    length: 0.035,
    droop: -1.2,
    width: 0.003,
    colors: [PALETTE.furTan, PALETTE.furWarm],
  });
  return ear;
}

function makeLeg(x, z, front, ctx) {
  const hip = new THREE.Group();
  // las traseras nacen un poco más abajo para compensar el corvejón
  hip.position.set(x, front ? -0.09 : -0.106, z);

  // Ángulos de reposo: las traseras tienen el corvejón hacia atrás
  const restHip = front ? 0.05 : -0.3;
  const restKnee = front ? -0.05 : 0.55;
  const restPaw = -(restHip + restKnee);

  const upper = mesh(new THREE.CapsuleGeometry(0.052, 0.17, 4, 12), skinMaterial);
  upper.position.y = -0.11;
  hip.add(upper);
  addHair(hip, ctx, {
    center: [0, -0.09, 0],
    radii: [0.066, 0.14, 0.066],
    count: 1300,
    length: 0.13,
    droop: 2.2,
    lift: 0.3,
    colors: [PALETTE.fur, PALETTE.fur, PALETTE.furWarm],
  });

  const knee = new THREE.Group();
  knee.position.y = -0.23;
  hip.add(knee);

  const lower = mesh(new THREE.CapsuleGeometry(0.042, 0.13, 4, 12), skinMaterial);
  lower.position.y = -0.085;
  knee.add(lower);
  addHair(knee, ctx, {
    center: [0, -0.08, 0],
    radii: [0.05, 0.1, 0.05],
    count: 700,
    length: 0.08,
    droop: 2.2,
    lift: 0.3,
    colors: [PALETTE.fur, PALETTE.furWarm],
  });

  const ankle = new THREE.Group();
  ankle.position.y = -0.18;
  knee.add(ankle);

  const paw = ellipsoid(0.052, 0.034, 0.07, skinMaterial, 16);
  paw.position.set(0, -0.012, 0.02);
  ankle.add(paw);
  addHair(ankle, ctx, {
    center: [0, -0.012, 0.02],
    radii: [0.052, 0.034, 0.07],
    count: 350,
    length: 0.035,
    droop: 1,
    flow: [0, 0, 0.6],
    lift: 0.4,
    colors: [PALETTE.fur],
    filter: (h) => h.y > -0.5,
  });

  hip.rotation.x = restHip;
  knee.rotation.x = restKnee;
  ankle.rotation.x = restPaw;

  return { hip, knee, ankle, restHip, restKnee, restPaw, front };
}

export function createShorkie({ seed = 7, quality = 1 } = {}) {
  const ctx = { rand: mulberry32(seed), quality, strands: 0 };
  const group = new THREE.Group();

  // root: se mueve arriba/abajo con el paso
  const ROOT_Y = 0.545;
  const root = new THREE.Group();
  root.position.y = ROOT_Y;
  group.add(root);

  // ---------- Cuerpo ----------
  // pecho más ancho y profundo que la cadera
  const chest = ellipsoid(0.185, 0.185, 0.2, skinMaterial);
  chest.position.set(0, 0.01, 0.15);
  root.add(chest);
  const hips = ellipsoid(0.17, 0.17, 0.2, skinMaterial);
  hips.position.set(0, 0.02, -0.16);
  root.add(hips);

  const coat = {
    length: 0.17,
    droop: 1.6,
    lift: 0.25,
    part: 1.2,
    colors: [PALETTE.fur, PALETTE.fur, PALETTE.fur, PALETTE.furWarm],
    // Más largo hacia abajo: la "falda" típica del Yorkie/Shih Tzu
    lengthFn: (h) => 0.75 + (1 - h.y) * 0.5,
  };
  addHair(root, ctx, {
    ...coat,
    center: [0, 0.015, 0],
    radii: [0.2, 0.21, 0.39],
    count: 12500,
    flow: [0, 0, -0.45],
  });

  // ---------- Patas ----------
  // Paso de 4 tiempos: trasera izq, delantera izq, trasera der, delantera der
  const legs = [
    { ...makeLeg(0.11, 0.24, true, ctx), offset: Math.PI * 0.5 },
    { ...makeLeg(-0.11, 0.24, true, ctx), offset: Math.PI * 1.5 },
    { ...makeLeg(0.11, -0.25, false, ctx), offset: 0 },
    { ...makeLeg(-0.11, -0.25, false, ctx), offset: Math.PI },
  ];
  legs.forEach((l) => root.add(l.hip));

  // ---------- Cuello ----------
  const neck = ellipsoid(0.13, 0.15, 0.13, skinMaterial);
  neck.position.set(0, 0.13, 0.28);
  neck.rotation.x = -0.5;
  root.add(neck);
  addHair(root, ctx, {
    center: [0, 0.13, 0.28],
    radii: [0.13, 0.15, 0.13],
    count: 2600,
    length: 0.14,
    droop: 1.4,
    lift: 0.35,
    flow: [0, 0, -0.15],
    colors: [PALETTE.fur, PALETTE.fur, PALETTE.furWarm],
  });

  // ---------- Cabeza ----------
  const head = new THREE.Group();
  head.position.set(0, 0.25, 0.36);
  root.add(head);

  const SKULL_C = new THREE.Vector3(0, 0.07, 0.02);
  const SKULL_R = new THREE.Vector3(0.135, 0.125, 0.13);
  const skull = ellipsoid(SKULL_R.x, SKULL_R.y, SKULL_R.z, skinMaterial);
  skull.position.copy(SKULL_C);
  head.add(skull);

  // Ojos grandes, redondos y mirando al frente
  const eyeDirs = [1, -1].map((side) => new THREE.Vector3(0.4 * side, 0.2, 0.9).normalize());
  const eyeMat = new THREE.MeshPhysicalMaterial({
    color: PALETTE.eye,
    roughness: 0.25,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
  });
  const lidMat = new THREE.MeshStandardMaterial({ color: '#2a1a14', roughness: 0.7 });
  const eyes = [];
  for (const d of eyeDirs) {
    const at = new THREE.Vector3(d.x * SKULL_R.x, d.y * SKULL_R.y, d.z * SKULL_R.z).multiplyScalar(0.9).add(SKULL_C);
    const eye = mesh(new THREE.SphereGeometry(0.025, 24, 16), eyeMat);
    eye.position.copy(at);
    head.add(eye);
    eyes.push(eye);

    const lid = mesh(new THREE.TorusGeometry(0.025, 0.005, 8, 32), lidMat);
    lid.position.copy(at).addScaledVector(d, 0.006);
    lid.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
    head.add(lid);
  }

  // Pelo de la cabeza: largo y despeinado, peinado hacia atrás
  addHair(head, ctx, {
    center: SKULL_C.toArray(),
    radii: SKULL_R.toArray(),
    count: 4200,
    length: 0.06,
    droop: 0.9,
    lift: 0.45,
    flow: [0, 0.1, -0.6],
    messiness: 0.25,
    colors: [PALETTE.furWarm, PALETTE.furWarm, PALETTE.fur, PALETTE.furTan],
    filter: (h) => !(h.z > 0.45 && h.y < 0.5),
  });
  // Pelito corto en la cara, dejando libres los ojos
  addHair(head, ctx, {
    center: SKULL_C.toArray(),
    radii: SKULL_R.toArray(),
    count: 2200,
    length: 0.032,
    droop: 0.8,
    lift: 0.5,
    flow: [0, 0, 0.2],
    width: 0.0042,
    colors: [PALETTE.furWarm, PALETTE.fur, PALETTE.furTan],
    filter: (h) => h.z > 0.4 && h.y < 0.6 && eyeDirs.every((e) => h.distanceTo(e) > 0.2),
  });
  // Cejas: mechones que salen hacia arriba y afuera
  for (const side of [1, -1]) {
    addHair(head, ctx, {
      center: [0.055 * side, 0.135, 0.12],
      radii: [0.03, 0.012, 0.02],
      count: 120,
      length: 0.05,
      droop: -0.4,
      flow: [0.5 * side, 0, 0.6],
      lift: 0.6,
      width: 0.0035,
      colors: [PALETTE.furTan, PALETTE.furWarm],
    });
  }

  // Hocico corto (herencia Shih Tzu)
  const MUZ_C = [0, 0.012, 0.15];
  const MUZ_R = [0.072, 0.06, 0.068];
  const muzzle = ellipsoid(MUZ_R[0], MUZ_R[1], MUZ_R[2], skinMaterial);
  muzzle.position.set(...MUZ_C);
  head.add(muzzle);
  // Bigotes y barba que caen hacia los lados
  addHair(head, ctx, {
    center: MUZ_C,
    radii: MUZ_R,
    count: 2600,
    length: 0.075,
    droop: 1.5,
    lift: 0.6,
    spread: 0.8,
    flow: [0, 0, 0.2],
    width: 0.0045,
    colors: [PALETTE.fur, PALETTE.fur, PALETTE.furWarm],
    filter: (h) => !(h.z > 0.8 && h.y > -0.15) && h.y < 0.75,
    lengthFn: (h) => 0.7 + Math.max(0, -h.y) * 0.9,
  });
  // Puente de la nariz: pelo corto
  addHair(head, ctx, {
    center: MUZ_C,
    radii: MUZ_R,
    count: 900,
    length: 0.025,
    droop: -0.3,
    flow: [0, 0, -0.8],
    width: 0.0035,
    colors: [PALETTE.furWarm, PALETTE.furTan],
    filter: (h) => h.y > 0.45,
  });

  const noseMat = new THREE.MeshPhysicalMaterial({
    color: PALETTE.nose,
    roughness: 0.5,
    clearcoat: 0.6,
    clearcoatRoughness: 0.3,
  });
  const nose = ellipsoid(0.028, 0.02, 0.02, noseMat, 20);
  nose.position.set(0, 0.04, 0.214);
  head.add(nose);
  for (const side of [1, -1]) {
    const nostril = ellipsoid(0.0065, 0.0045, 0.004, new THREE.MeshBasicMaterial({ color: 0x000000 }), 10);
    nostril.position.set(0.011 * side, 0.036, 0.233);
    head.add(nostril);
  }

  const mouth = ellipsoid(0.04, 0.018, 0.028, new THREE.MeshStandardMaterial({ color: PALETTE.mouth, roughness: 0.8 }), 16);
  mouth.position.set(0, -0.03, 0.175);
  head.add(mouth);

  // Lengüita afuera, como en la foto
  const tongue = ellipsoid(
    0.026,
    0.008,
    0.036,
    new THREE.MeshPhysicalMaterial({ color: PALETTE.tongue, roughness: 0.35, clearcoat: 0.5 }),
    16
  );
  tongue.position.set(0.004, -0.05, 0.215);
  tongue.rotation.x = 0.55;
  head.add(tongue);

  // Orejas puntiagudas y erguidas (herencia Yorkie)
  const ears = [makeEar(1, ctx), makeEar(-1, ctx)];
  ears.forEach((e) => head.add(e));

  // ---------- Cola ----------
  // Cola emplumada, llevada alta y curvada sobre el lomo
  const tailWag = new THREE.Group();
  tailWag.position.set(0, 0.12, -0.36);
  root.add(tailWag);
  const tailSegments = [];
  let parent = tailWag;
  for (let i = 0; i < 5; i++) {
    const seg = new THREE.Group();
    seg.position.y = i === 0 ? 0 : 0.06;
    seg.rotation.x = i === 0 ? -0.6 : -0.3;
    parent.add(seg);
    const r = 0.032 - i * 0.004;
    const bone = ellipsoid(r, 0.04, r, skinMaterial, 12);
    bone.position.y = 0.03;
    seg.add(bone);
    addHair(seg, ctx, {
      center: [0, 0.03, 0],
      radii: [r, 0.04, r],
      count: 450,
      length: 0.12 - i * 0.01,
      droop: 1.4,
      flow: [0, 0, -0.3],
      lift: 0.35,
      messiness: 0.1,
      colors: [PALETTE.fur, PALETTE.furWarm],
    });
    tailSegments.push(seg);
    parent = seg;
  }

  // ---------- Animación ----------
  let phase = 0;
  let amp = 0;
  let barkTime = 0;
  let blinkTimer = 2 + Math.random() * 3;
  let prevBob = 0;
  const STRIDE = 0.42; // distancia avanzada por ciclo de paso

  function update(dt, speed, time) {
    phase += ((Math.PI * 2 * speed) / STRIDE) * dt;
    const targetAmp = THREE.MathUtils.clamp(Math.abs(speed) / 0.4, 0, 1);
    amp += (targetAmp - amp) * Math.min(1, dt * 6);

    for (const leg of legs) {
      const a = phase + leg.offset;
      const swing = Math.max(0, Math.cos(a)); // fase de balanceo (pata en el aire)
      leg.hip.rotation.x = leg.restHip - Math.sin(a) * 0.42 * amp;
      // las delanteras doblan el carpo hacia atrás, las traseras el corvejón
      leg.knee.rotation.x = leg.restKnee + swing * (leg.front ? 0.9 : 0.45) * amp;
      leg.ankle.rotation.x = leg.restPaw + swing * (leg.front ? 0.5 : -0.3) * amp + Math.sin(a) * 0.15 * amp;
    }

    // Rebote con cada paso
    const bob = Math.abs(Math.sin(phase)) * 0.014 * amp;
    root.position.y = ROOT_Y + bob;
    root.rotation.z = Math.sin(phase) * 0.03 * amp;
    root.rotation.x = Math.sin(phase * 2) * 0.012 * amp;
    root.rotation.y = Math.sin(phase) * 0.025 * amp;

    // Inercia del pelo: se queda un poco atrás y rebota con el paso
    const bobVel = dt > 0 ? (bob - prevBob) / dt : 0;
    prevBob = bob;
    hairUniforms.uTime.value = time;
    hairUniforms.uMotion.value.set(0, -bobVel * 0.04, -speed * 0.015);

    // Cabeza: estable al caminar (los perros la compensan) y curiosa quieto
    const idle = 1 - amp;
    head.rotation.x = Math.sin(phase * 2 + 0.6) * 0.035 * amp + Math.sin(time * 0.9) * 0.05 * idle;
    head.rotation.y = -root.rotation.y + Math.sin(time * 0.6) * 0.35 * idle + Math.sin(time * 0.4) * 0.08 * amp;
    head.rotation.z = Math.sin(time * 0.5) * 0.14 * idle;

    // Ladrido
    if (barkTime > 0) {
      barkTime = Math.max(0, barkTime - dt);
      const k = Math.sin((1 - barkTime / 0.35) * Math.PI);
      head.rotation.x -= k * 0.25;
      mouth.scale.y = 0.018 + k * 0.03;
      tongue.position.y = -0.05 - k * 0.02;
    } else {
      mouth.scale.y = 0.018;
      tongue.position.y = -0.05;
    }

    // Orejas: rebotan un poco con el paso y se mueven atentas
    ears.forEach((e, i) => {
      const side = i === 0 ? 1 : -1;
      const twitch = Math.max(0, Math.sin(time * 0.7 + i * 2.1) - 0.93) * 3;
      e.rotation.x = -0.15 + Math.sin(phase * 2 - 0.9) * 0.06 * amp + twitch * 0.3;
      e.rotation.z = -0.3 * side + Math.sin(phase * 2 - 1.1) * 0.035 * amp * side;
    });

    // Jadeo
    tongue.scale.z = 0.036 * (1 + Math.sin(time * (8 + amp * 6)) * 0.12);

    // Cola feliz
    const wagSpeed = 7 + amp * 4;
    tailWag.rotation.y = Math.sin(time * wagSpeed) * 0.45;
    tailSegments.forEach((s, i) => {
      s.rotation.z = Math.sin(time * wagSpeed - i * 0.6) * 0.08;
    });

    // Parpadeo
    blinkTimer -= dt;
    const blink = blinkTimer < 0.12 && blinkTimer > 0 ? 0.12 : 1;
    if (blinkTimer <= 0) blinkTimer = 2 + Math.random() * 4;
    eyes.forEach((e) => (e.scale.y = blink));
  }

  function bark() {
    barkTime = 0.35;
  }

  return { group, head, update, bark, strands: ctx.strands };
}
