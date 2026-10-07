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
