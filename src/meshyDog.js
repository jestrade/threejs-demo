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
  return rigSittingDog(source.geometry, new THREE.MeshStandardMaterial({ map, roughness: 0.85, envMapIntensity: 0.45 }), {
    headPivot: HEAD_PIVOT,
    earPivots: EAR_PIVOTS,
    tailPivot: TAIL_PIVOT,
    chest: CHEST,
    height: HEIGHT,
    offset: new THREE.Vector3(-0.03, 0, 0),
    headMarker: new THREE.Vector3(-0.02, 0.2, 0.18),
    weights: (x, y, z) => {
      const ear = smoothstep(0.285, 0.33, y);
      return [
        smoothstep(0.09, 0.17, y) * smoothstep(-0.05, 0.05, z),
        smoothstep(-0.18, -0.24, z) * smoothstep(0.03, -0.02, y),
        ear * smoothstep(-0.03, -0.07, x),
        ear * smoothstep(-0.01, 0.03, x),
      ];
    },
  });
}

/**
 * Anima en el vertex shader un perro sentado sin esqueleto (mira alrededor,
 * mueve orejas y cola, respira). rig, en coordenadas del modelo (mira hacia +Z):
 * pivotes de cabeza, orejas y cola, centro del pecho, altura final en metros,
 * offset del modelo (en sus unidades), punto de la cabeza para el globo y
 * weights(x, y, z) → [cabeza, cola, oreja izq, oreja der].
 */
export function rigSittingDog(geometry, material, rig) {
  const uniforms = addRegionRig(geometry, material, rig);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // Escala y apoyo en el suelo
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const scale = rig.height / (box.max.y - box.min.y);
  mesh.scale.setScalar(scale);
  // apoyado en el suelo y con el cuerpo centrado sobre el origen del grupo
  mesh.position.copy(rig.offset).multiplyScalar(scale);
  mesh.position.y = -box.min.y * scale;

  const group = new THREE.Group();
  group.add(mesh);

  // Punto de referencia en la cabeza (para el globo "¡Guau!")
  const head = new THREE.Object3D();
  head.position.copy(rig.headMarker);
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
    let open = 0;
    if (barkTime > 0) {
      barkTime = Math.max(0, barkTime - dt);
      open = Math.sin((1 - barkTime / 0.35) * Math.PI);
      pitch -= open * 0.22;
    }
    // rig.headMotion = false: la cabeza queda quieta (solo boca y orejas)
    if (rig.headMotion !== false) setRot(uniforms.uHeadRot.value, pitch, lookYaw, lookTilt);
    // la boca se abre con cada ladrido (si el modelo tiene mandíbula)
    setRot(uniforms.uJawRot.value, open * 0.5, 0, 0);

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

/**
 * Agrega a la malla las regiones animables (cabeza, cola, orejas, pecho y,
 * si weights devuelve un quinto valor, la mandíbula con pivote rig.jawPivot) y
 * parchea el material para moverlas en el vertex shader. Devuelve los uniforms:
 * uHeadRot, uTailRot, uEarRotL, uEarRotR, uJawRot (Matrix3) y uBreath.
 */
export function addRegionRig(geometry, material, rig) {
  // Pesos por vértice: x = cabeza, y = cola, z = oreja izq, w = oreja der
  const pos = geometry.attributes.position;
  const weights = new Float32Array(pos.count * 4);
  const jaw = new Float32Array(pos.count); // quinto valor opcional: mandíbula
  for (let i = 0; i < pos.count; i++) {
    const w = rig.weights(pos.getX(i), pos.getY(i), pos.getZ(i));
    weights.set(w.slice(0, 4), i * 4);
    jaw[i] = w[4] ?? 0;
  }
  geometry.setAttribute('aRig', new THREE.BufferAttribute(weights, 4));
  geometry.setAttribute('aJaw', new THREE.BufferAttribute(jaw, 1));

  const uniforms = {
    uHeadRot: { value: new THREE.Matrix3() },
    uTailRot: { value: new THREE.Matrix3() },
    uEarRotL: { value: new THREE.Matrix3() },
    uEarRotR: { value: new THREE.Matrix3() },
    uHeadPivot: { value: rig.headPivot },
    uTailPivot: { value: rig.tailPivot },
    uEarPivotL: { value: rig.earPivots[0] },
    uEarPivotR: { value: rig.earPivots[1] },
    uChest: { value: rig.chest },
    uChestSize: { value: rig.chestSize ?? 0.012 },
    uJawRot: { value: new THREE.Matrix3() },
    uJawPivot: { value: rig.jawPivot ?? new THREE.Vector3() },
    uBreath: { value: 0 },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aRig;
attribute float aJaw;
uniform mat3 uHeadRot, uTailRot, uEarRotL, uEarRotR, uJawRot;
uniform vec3 uHeadPivot, uTailPivot, uEarPivotL, uEarPivotR, uJawPivot, uChest;
uniform float uBreath, uChestSize;
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
// orejas y mandíbula se mueven sobre la cabeza, luego la cabeza sobre el cuello
rigApply(rigPos, objectNormal, uJawRot, uJawPivot, aJaw);
rigApply(rigPos, objectNormal, uEarRotL, uEarPivotL, aRig.z);
rigApply(rigPos, objectNormal, uEarRotR, uEarPivotR, aRig.w);
rigApply(rigPos, objectNormal, uHeadRot, uHeadPivot, aRig.x);
rigApply(rigPos, objectNormal, uTailRot, uTailPivot, aRig.y);
// respiración: el pecho se infla un poco
vec3 dc = position - uChest;
float chest = exp(-dot(dc, dc) / uChestSize) * (1.0 - aRig.x);
rigPos += vec3(dc.x, 0.3 * dc.y, dc.z) * chest * uBreath;`
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = rigPos;');
  };

  return uniforms;
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
// flipY: si la textura se carga volteada (OBJ/TextureLoader sí, glTF no).
export function coatFromTexture(image, uvs, flipY = true) {
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
    const py = Math.min(size - 1, Math.max(0, Math.floor((flipY ? 1 - v : v) * size)));
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

  return mountHeadOnBody({
    geometry: obj.children.find((c) => c.isMesh).geometry,
    // un poco más clara para igualar el pelaje del cuerpo
    material: new THREE.MeshStandardMaterial({ map, color: new THREE.Color(1.25, 1.22, 1.15), roughness: 0.85, envMapIntensity: 0.45 }),
    isHead: (x, y, z) => y > HEAD_CUT_Y && z > -0.06,
    pivot: HEAD_PIVOT,
    scale: HEAD_SCALE,
    offset: HEAD_OFFSET,
    createBody,
  });
}

/**
 * Recorta la cabeza de una malla (los triángulos con los 3 vértices dentro de
 * isHead) y la pone en lugar de la cabeza del perro procedural, que se tiñe con
 * los colores de esa cabeza. pivot: cuello, en coordenadas de la malla;
 * scale/offset/rotation: ajuste dentro del grupo de la cabeza procedural.
 */
export function mountHeadOnBody({ geometry, material, isHead, pivot, scale, offset, rotation = null, createBody }) {
  const src = geometry.index ? geometry.toNonIndexed() : geometry;
  const attrs = ['position', 'normal', 'uv'];
  const out = Object.fromEntries(attrs.map((a) => [a, []]));
  const pos = src.attributes.position;
  for (let t = 0; t < pos.count; t += 3) {
    let inside = true;
    for (let k = 0; k < 3 && inside; k++) inside = isHead(pos.getX(t + k), pos.getY(t + k), pos.getZ(t + k));
    if (!inside) continue;
    for (const a of attrs) {
      const attr = src.attributes[a];
      for (let k = 0; k < 3; k++) {
        for (let c = 0; c < attr.itemSize; c++) out[a].push(attr.getComponent(t + k, c));
      }
    }
  }
  const head = new THREE.BufferGeometry();
  head.setAttribute('position', new THREE.Float32BufferAttribute(out.position, 3));
  head.setAttribute('normal', new THREE.Float32BufferAttribute(out.normal, 3));
  head.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
  // centrar en el cuello para que gire como la cabeza procedural
  head.translate(-pivot.x, -pivot.y, -pivot.z);

  const headMesh = new THREE.Mesh(head, material);
  headMesh.castShadow = true;
  headMesh.receiveShadow = true;
  headMesh.scale.setScalar(scale);
  headMesh.position.copy(offset);
  if (rotation) headMesh.rotation.copy(rotation);

  const map = material.map;
  const dog = createBody(coatFromTexture(map.image, out.uv, map.flipY));
  dog.head.clear(); // quita la cabeza procedural (las animaciones de cabeza siguen aplicando)
  dog.head.add(headMesh);
  return { ...dog, canWalk: true };
}
