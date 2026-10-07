import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

// Modelo generado con Meshy a partir de la foto (el perro sentado en el sofá),
// sin el cojín y con la textura corregida a crema (ver tools/).
// Viene sin esqueleto, así que se anima en el vertex shader por regiones:
// cabeza, orejas, cola y pecho (respiración). Está sentado: no camina.

// Regiones en las coordenadas originales del modelo (mira hacia +Z)
const HEAD_PIVOT = new THREE.Vector3(-0.02, 0.12, 0.11);
const EAR_PIVOTS = [new THREE.Vector3(-0.1, 0.29, 0.17), new THREE.Vector3(0.06, 0.29, 0.17)];
const TAIL_PIVOT = new THREE.Vector3(0.03, -0.06, -0.19);
const CHEST = new THREE.Vector3(0.02, 0.02, 0.06);
const HEIGHT = 0.82; // altura final del perro sentado, en metros de la escena

function smoothstep(a, b, x) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export async function loadMeshyShorkie({ objUrl, textureUrl }) {
  const [obj, map] = await Promise.all([
    new OBJLoader().loadAsync(objUrl),
    new THREE.TextureLoader().loadAsync(textureUrl),
  ]);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const source = obj.children.find((c) => c.isMesh);
  const geometry = source.geometry;

  // Pesos por vértice: x = cabeza, y = cola, z = oreja izq, w = oreja der
  const pos = geometry.attributes.position;
  const rig = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    rig[i * 4] = smoothstep(0.09, 0.17, y) * smoothstep(-0.05, 0.05, z);
    rig[i * 4 + 1] = smoothstep(-0.18, -0.24, z) * smoothstep(0.03, -0.02, y);
    const ear = smoothstep(0.285, 0.33, y);
    rig[i * 4 + 2] = ear * smoothstep(-0.03, -0.07, x);
    rig[i * 4 + 3] = ear * smoothstep(-0.01, 0.03, x);
  }
  geometry.setAttribute('aRig', new THREE.BufferAttribute(rig, 4));

  const uniforms = {
    uHeadRot: { value: new THREE.Matrix3() },
    uTailRot: { value: new THREE.Matrix3() },
    uEarRotL: { value: new THREE.Matrix3() },
    uEarRotR: { value: new THREE.Matrix3() },
    uHeadPivot: { value: HEAD_PIVOT },
    uTailPivot: { value: TAIL_PIVOT },
    uEarPivotL: { value: EAR_PIVOTS[0] },
    uEarPivotR: { value: EAR_PIVOTS[1] },
    uChest: { value: CHEST },
    uBreath: { value: 0 },
  };

  const material = new THREE.MeshStandardMaterial({ map, roughness: 0.85, envMapIntensity: 0.45 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aRig;
uniform mat3 uHeadRot, uTailRot, uEarRotL, uEarRotR;
uniform vec3 uHeadPivot, uTailPivot, uEarPivotL, uEarPivotR, uChest;
uniform float uBreath;
vec3 rigPos;
void rigApply(inout vec3 p, inout vec3 n, mat3 R, vec3 pivot, float w) {
  if (w <= 0.0) return;
  p = mix(p, pivot + R * (p - pivot), w);
  n = normalize(mix(n, R * n, w));
}`
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
rigPos = position;
// las orejas se mueven sobre la cabeza, luego la cabeza sobre el cuello
rigApply(rigPos, objectNormal, uEarRotL, uEarPivotL, aRig.z);
rigApply(rigPos, objectNormal, uEarRotR, uEarPivotR, aRig.w);
rigApply(rigPos, objectNormal, uHeadRot, uHeadPivot, aRig.x);
rigApply(rigPos, objectNormal, uTailRot, uTailPivot, aRig.y);
// respiración: el pecho se infla un poco
vec3 dc = position - uChest;
float chest = exp(-dot(dc, dc) / 0.012) * (1.0 - aRig.x);
rigPos += vec3(dc.x, 0.3 * dc.y, dc.z) * chest * uBreath;`
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = rigPos;');
  };

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // Escala y apoyo en el suelo
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const scale = HEIGHT / (box.max.y - box.min.y);
  mesh.scale.setScalar(scale);
  mesh.position.y = -box.min.y * scale;
  // centrar el cuerpo sobre el origen del grupo
  mesh.position.x = -0.03 * scale;
  mesh.position.z = 0.0;

  const group = new THREE.Group();
  group.add(mesh);

  // Punto de referencia en la cabeza (para el globo "¡Guau!")
  const head = new THREE.Object3D();
  head.position.set(-0.02, 0.2, 0.18);
  mesh.add(head);

  // ---------- Animación ----------
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const m4 = new THREE.Matrix4();
  const setRot = (target, x, y, z) => {
    euler.set(x, y, z);
    target.setFromMatrix4(m4.makeRotationFromEuler(euler));
  };

  let barkTime = 0;
  let lookYaw = 0;
  let lookPitch = 0;
  let lookTilt = 0;
  let goal = { yaw: 0, pitch: 0, tilt: 0 };
  let nextLook = 1.5;

  function update(dt, _speed, time) {
    // Mira alrededor con pausas, como un perro curioso
    nextLook -= dt;
    if (nextLook <= 0) {
      nextLook = 1.5 + Math.random() * 3;
      goal = {
        yaw: (Math.random() - 0.5) * 0.9,
        pitch: (Math.random() - 0.5) * 0.25,
        tilt: Math.random() < 0.3 ? (Math.random() - 0.5) * 0.6 : 0,
      };
    }
    const k = Math.min(1, dt * 3.5);
    lookYaw += (goal.yaw - lookYaw) * k;
    lookPitch += (goal.pitch - lookPitch) * k;
    lookTilt += (goal.tilt - lookTilt) * k;

    // Jadeo: la cabeza sube y baja muy poco
    let pitch = lookPitch + Math.sin(time * 9) * 0.012;
    if (barkTime > 0) {
      barkTime = Math.max(0, barkTime - dt);
      pitch -= Math.sin((1 - barkTime / 0.35) * Math.PI) * 0.22;
    }
    setRot(uniforms.uHeadRot.value, pitch, lookYaw, lookTilt);

    // Orejas: pequeños giros de atención
    const twitchL = Math.max(0, Math.sin(time * 0.8) - 0.9) * 2.5;
    const twitchR = Math.max(0, Math.sin(time * 0.65 + 2) - 0.9) * 2.5;
    setRot(uniforms.uEarRotL.value, -twitchL * 0.4, 0, twitchL * 0.25);
    setRot(uniforms.uEarRotR.value, -twitchR * 0.4, 0, -twitchR * 0.25);

    // Cola barriendo el suelo
    setRot(uniforms.uTailRot.value, 0, Math.sin(time * 7) * 0.35, 0);

    uniforms.uBreath.value = (Math.sin(time * 4.2) * 0.5 + 0.5) * 0.06;
  }

  function bark() {
    barkTime = 0.35;
  }

  return { group, head, update, bark, canWalk: false };
}

// ---------- Versión que camina ----------
// La malla de Meshy es una sola superficie sentada (patas traseras fundidas con
// el cuerpo), así que no se puede re-posar de pie sin deformarla. Para que
// camine se usa un híbrido: la cabeza real de Meshy (cara, ojos, orejas y
// textura) sobre el cuerpo procedural articulado.
const HEAD_CUT_Y = 0.115; // por encima de esto, en coordenadas de Meshy, es cabeza
const HEAD_SCALE = 1.45; // la cabeza procedural ya tiene escala 1.15
const HEAD_OFFSET = new THREE.Vector3(0, -0.08, -0.05);

// Colores del pelaje sacados de la textura de la cabeza: claros, medios y
// oscuros (sin contar ojos, nariz ni boca), para teñir el cuerpo procedural.
function coatFromTexture(image, uvs) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(image, 0, 0, size, size);
  const data = g.getImageData(0, 0, size, size).data;
  const samples = [];
  const c = new THREE.Color();
  for (let i = 0; i < uvs.length; i += 6) {
    const u = (uvs[i] + uvs[i + 2] + uvs[i + 4]) / 3;
    const v = (uvs[i + 1] + uvs[i + 3] + uvs[i + 5]) / 3;
    const px = Math.min(size - 1, Math.max(0, Math.floor(u * size)));
    const py = Math.min(size - 1, Math.max(0, Math.floor((1 - v) * size)));
    const o = (py * size + px) * 4;
    c.setRGB(data[o] / 255, data[o + 1] / 255, data[o + 2] / 255, THREE.SRGBColorSpace);
    const hsl = c.getHSL({}, THREE.SRGBColorSpace);
    if (hsl.l > 0.45 && hsl.s < 0.5) samples.push({ l: hsl.l, color: c.clone() });
  }
  // La textura trae sombras horneadas (es más oscura de lo que se ve el pelo):
  // se toma el tono medio y se usan luminosidades de pelaje claro.
  samples.sort((a, b) => a.l - b.l);
  const hue = samples[Math.floor(samples.length / 2)].color.getHSL({}, THREE.SRGBColorSpace).h;
  const hsl = (s, l) => new THREE.Color().setHSL(hue, s, l, THREE.SRGBColorSpace);
  return { fur: hsl(0.5, 0.8), furWarm: hsl(0.48, 0.7), furTan: hsl(0.42, 0.57) };
}

export async function loadMeshyWalker({ objUrl, textureUrl, createBody }) {
  const [obj, map] = await Promise.all([
    new OBJLoader().loadAsync(objUrl),
    new THREE.TextureLoader().loadAsync(textureUrl),
  ]);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  // Recorta los triángulos de la cabeza (la geometría del OBJ no es indexada)
  const src = obj.children.find((c) => c.isMesh).geometry;
  const attrs = ['position', 'normal', 'uv'];
  const out = Object.fromEntries(attrs.map((a) => [a, []]));
  const pos = src.attributes.position;
  for (let t = 0; t < pos.count; t += 3) {
    let inside = true;
    for (let k = 0; k < 3 && inside; k++) {
      inside = pos.getY(t + k) > HEAD_CUT_Y && pos.getZ(t + k) > -0.06;
    }
    if (!inside) continue;
    for (const a of attrs) {
      const attr = src.attributes[a];
      for (let k = 0; k < 3; k++) {
        for (let c = 0; c < attr.itemSize; c++) out[a].push(attr.array[(t + k) * attr.itemSize + c]);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(out.position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(out.normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
  // centrar en el cuello para que gire como la cabeza procedural
  geometry.translate(-HEAD_PIVOT.x, -HEAD_PIVOT.y, -HEAD_PIVOT.z);

  const headMesh = new THREE.Mesh(
    geometry,
    // un poco más clara para igualar el pelaje del cuerpo
    new THREE.MeshStandardMaterial({ map, color: new THREE.Color(1.25, 1.22, 1.15), roughness: 0.85, envMapIntensity: 0.45 })
  );
  headMesh.castShadow = true;
  headMesh.receiveShadow = true;
  headMesh.scale.setScalar(HEAD_SCALE);
  headMesh.position.copy(HEAD_OFFSET);

  const dog = createBody(coatFromTexture(map.image, out.uv));
  dog.head.clear(); // quita la cabeza procedural (las animaciones de cabeza siguen aplicando)
  dog.head.add(headMesh);
  return { ...dog, canWalk: true };
}
