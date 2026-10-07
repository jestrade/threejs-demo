import * as THREE from 'three';
import { addHair as growHair, hairUniforms } from './hair.js';

// Colores tomados de la foto de referencia: pelaje crema/beige claro,
// un poco más tostado en la cara y las orejas, interior de oreja rosado.
const PALETTE = {
  fur: new THREE.Color('#ecdcc6'),
  furWarm: new THREE.Color('#dcc2a0'),
  furTan: new THREE.Color('#c39f7a'),
  skin: new THREE.Color('#bba184'),
  earInner: new THREE.Color('#c98f86'),
  nose: new THREE.Color('#141010'),
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

const skinMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.skin, roughness: 1 });

function canvasTexture(w, h, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Iris para una esfera con el polo mirando al frente: en el mapeo UV de la
// esfera, cada fila de la textura es un anillo alrededor de la pupila.
function irisTexture(rand) {
  return canvasTexture(256, 128, (g, w, h) => {
    for (let y = 0; y < h; y++) {
      const v = y / h; // 0 = centro de la pupila
      for (let x = 0; x < w; x += 2) {
        let col;
        if (v < 0.075) col = [6, 4, 3];
        else if (v < 0.2) {
          const k = (v - 0.075) / 0.125;
          const streak = 0.75 + 0.5 * Math.sin(x * 0.45 + Math.sin(x * 0.13) * 3) * rand();
          col = [70 + 40 * k, 38 + 22 * k, 18 + 8 * k].map((c) => c * streak);
        } else if (v < 0.23) col = [25, 14, 8];
        else col = [38, 24, 18];
        g.fillStyle = `rgb(${col.map((c) => Math.round(Math.min(255, c))).join(',')})`;
        g.fillRect(x, y, 2, 1);
      }
    }
  });
}

// Textura rugosa de trufa para el relieve de la nariz
function noseBump(rand) {
  const tex = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#808080';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const l = 90 + rand() * 120;
      g.fillStyle = `rgb(${l},${l},${l})`;
      g.beginPath();
      g.arc(rand() * w, rand() * h, 1.5 + rand() * 2.5, 0, Math.PI * 2);
      g.fill();
    }
  });
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

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

// Todos los mechones usan el color crema por defecto
function addHair(parent, ctx, opts) {
  return growHair(parent, ctx, { colors: [PALETTE.fur], ...opts });
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

  // Mechones que salen del interior de la oreja
  addHair(ear, ctx, {
    center: [0, 0.05, 0.012],
    radii: [0.035, 0.06, 0.012],
    count: 300,
    lockSize: 6,
    length: 0.06,
    droop: -0.6,
    flow: [0.5 * side, 0, 0.3],
    lift: 0.5,
    colors: [PALETTE.fur, PALETTE.furWarm],
    filter: (h) => h.z > 0.3,
  });

  // Pelo corto que cubre el dorso de la oreja, peinado hacia la punta
  addHair(ear, ctx, {
    center: [0, 0.075, -0.004],
    radii: [0.062, 0.09, 0.022],
    count: 1400,
    clump: 0.2,
    lockSize: 6,
    tipColor: PALETTE.furTan,
    tipMix: 0.5,
    length: 0.03,
    droop: -0.9,
    lift: 0.15,
    colors: [PALETTE.furWarm, PALETTE.furTan],
    filter: (h) => h.z < 0.1,
    rootShade: 0.7,
  });
  // Flecos largos en los bordes (como en la foto)
  addHair(ear, ctx, {
    center: [0, 0.06, 0],
    radii: [0.062, 0.08, 0.02],
    count: 1300,
    clump: 0.6,
    lockSize: 8,
    length: 0.065,
    droop: 0.35,
    flow: [0.9 * side, 0.25, -0.2],
    lift: 0.3,
    colors: [PALETTE.fur, PALETTE.furWarm, PALETTE.furTan],
    filter: (h) => Math.abs(h.x) > 0.7 && h.x * side > 0,
  });
  // Penacho en la punta
  addHair(ear, ctx, {
    center: [0, 0.185, 0],
    radii: [0.014, 0.03, 0.01],
    count: 160,
    clump: 0.5,
    lockSize: 6,
    length: 0.035,
    droop: -1.2,
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
    count: 2400,
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
    count: 1300,
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
    count: 700,
    clump: 0.3,
    lockSize: 6,
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
    lift: 0.15,
    messiness: 0.08,
    part: 1.2,
    colors: [PALETTE.fur, PALETTE.fur, PALETTE.fur, PALETTE.furWarm],
    // Más largo hacia abajo: la "falda" típica del Yorkie/Shih Tzu
    lengthFn: (h) => 0.75 + (1 - h.y) * 0.5,
  };
  addHair(root, ctx, {
    ...coat,
    center: [0, 0.015, 0],
    radii: [0.2, 0.21, 0.39],
    count: 22000,
    lockSize: 22,
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
    count: 5000,
    lockSize: 18,
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
    map: irisTexture(ctx.rand),
    roughness: 0.25,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
  });
  const lidMat = new THREE.MeshStandardMaterial({ color: '#2a1a14', roughness: 0.7 });
  const eyes = [];
  for (const d of eyeDirs) {
    const at = new THREE.Vector3(d.x * SKULL_R.x, d.y * SKULL_R.y, d.z * SKULL_R.z).multiplyScalar(0.9).add(SKULL_C);
    const eye = mesh(new THREE.SphereGeometry(0.025, 32, 24).rotateX(Math.PI / 2), eyeMat);
    eye.position.copy(at);
    // la pupila mira casi al frente
    eye.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(d.x * 0.35, d.y * 0.2, 1).normalize());
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
    count: 7000,
    tipColor: PALETTE.furTan,
    tipMix: 0.35,
    lockSize: 10,
    wave: 0.08,
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
    count: 4000,
    clump: 0.25,
    lockSize: 6,
    length: 0.032,
    droop: 0.8,
    lift: 0.5,
    flow: [0, 0, 0.2],
    colors: [PALETTE.furWarm, PALETTE.fur, PALETTE.furTan],
    filter: (h) => h.z > 0.4 && h.y < 0.6 && eyeDirs.every((e) => h.distanceTo(e) > 0.2),
  });
  // Cejas: mechones que salen hacia arriba y afuera
  for (const side of [1, -1]) {
    addHair(head, ctx, {
      center: [0.055 * side, 0.135, 0.12],
      radii: [0.03, 0.012, 0.02],
      count: 220,
      lockSize: 8,
      length: 0.05,
      droop: -0.4,
      flow: [0.5 * side, 0, 0.6],
      lift: 0.6,
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
    count: 5000,
    clump: 0.7,
    lockSize: 12,
    length: 0.075,
    droop: 1.5,
    lift: 0.6,
    spread: 0.8,
    flow: [0, 0, 0.2],
    colors: [PALETTE.fur, PALETTE.fur, PALETTE.furWarm],
    filter: (h) => !(h.z > 0.88 && h.y > 0) && h.y < 0.75,
    lengthFn: (h) => 0.7 + Math.max(0, -h.y) * 0.9,
  });
  // Puente de la nariz: pelo corto
  addHair(head, ctx, {
    center: MUZ_C,
    radii: MUZ_R,
    count: 1600,
    clump: 0.2,
    lockSize: 6,
    length: 0.025,
    droop: -0.3,
    flow: [0, 0, -0.8],
    colors: [PALETTE.furWarm, PALETTE.furTan],
    filter: (h) => h.y > 0.45,
  });

  const noseMat = new THREE.MeshPhysicalMaterial({
    color: PALETTE.nose,
    bumpMap: noseBump(ctx.rand),
    bumpScale: 1.5,
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
      count: 900,
      lockSize: 18,
      clump: 0.85,
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

  return { group, head, update, bark, strands: ctx.strands, canWalk: true };
}
