import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { rigSittingDog, mountHeadOnBody } from './meshyDog.js';

// Modelo generado con Tripo a partir de la foto: mucho más detalle en el pelo
// (geometría + normal map) que el de Meshy. Viene echado sobre un cojín; tools/tripo/
// le quita el sofá, lo endereza mirando hacia +Z y lo simplifica (GLB con meshopt).
// Tampoco tiene esqueleto: se anima igual que el de Meshy, por regiones.

// Regiones en las coordenadas del GLB (mira hacia +Z, el suelo en y = 0)
const HEAD_PIVOT = new THREE.Vector3(-0.03, 0.27, 0.24);
const EAR_PIVOTS = [new THREE.Vector3(-0.11, 0.39, 0.38), new THREE.Vector3(0.02, 0.39, 0.3)];
const TAIL_PIVOT = new THREE.Vector3(0, 0.05, -0.25);
const CHEST = new THREE.Vector3(-0.02, 0.17, 0.17);
const HEIGHT = 0.6; // altura final del perro echado, en metros de la escena

function smoothstep(a, b, x) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// Las dos versiones comparten la descarga del GLB
const cache = new Map();
function loadTripo(url) {
  if (!cache.has(url)) {
    cache.set(url, new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url).then((gltf) => {
      const mesh = gltf.scene.getObjectByProperty('isMesh', true);
      // Los vértices vienen cuantizados (enteros + escala en el nodo): se pasan a
      // float en las coordenadas del modelo, que son las que usan las regiones
      const { geometry } = mesh;
      for (const name of ['position', 'normal', 'uv']) {
        const attr = geometry.attributes[name];
        const array = new Float32Array(attr.count * attr.itemSize);
        for (let i = 0; i < attr.count; i++) {
          for (let c = 0; c < attr.itemSize; c++) array[i * attr.itemSize + c] = attr.getComponent(i, c);
        }
        geometry.setAttribute(name, new THREE.BufferAttribute(array, attr.itemSize));
      }
      mesh.updateWorldMatrix(true, false);
      geometry.applyMatrix4(mesh.matrixWorld);
      const { material } = mesh;
      material.envMapIntensity = 0.45;
      for (const map of [material.map, material.normalMap, material.roughnessMap]) if (map) map.anisotropy = 8;
      return mesh;
    }));
  }
  return cache.get(url);
}

export async function loadTripoShorkie({ url }) {
  const mesh = await loadTripo(url);
  return rigSittingDog(mesh.geometry.clone(), mesh.material.clone(), {
    headPivot: HEAD_PIVOT,
    earPivots: EAR_PIVOTS,
    tailPivot: TAIL_PIVOT,
    chest: CHEST,
    chestSize: 0.01,
    height: HEIGHT,
    offset: new THREE.Vector3(0, 0, 0),
    headMarker: new THREE.Vector3(-0.03, 0.42, 0.34),
    weights: (x, y, z) => {
      const ear = smoothstep(0.385, 0.42, y);
      return [
        smoothstep(0.2, 0.29, y) * smoothstep(0.16, 0.25, z),
        smoothstep(-0.24, -0.29, z) * smoothstep(0.12, 0.08, y),
        ear * smoothstep(-0.07, -0.09, x),
        ear * smoothstep(-0.07, -0.05, x),
      ];
    },
  });
}

// Versión que camina: la cabeza de Tripo sobre el cuerpo procedural (ver loadMeshyWalker)
const HEAD_CUT = (x, y, z) => y > 0.255 && z > 0.2;
const HEAD_SCALE = 1.35;
const HEAD_OFFSET = new THREE.Vector3(0, -0.08, -0.1);

export async function loadTripoWalker({ url, createBody }) {
  const mesh = await loadTripo(url);
  const material = mesh.material.clone();
  material.color.setRGB(1.15, 1.12, 1.08); // un poco más clara para igualar el cuerpo
  return mountHeadOnBody({
    geometry: mesh.geometry,
    material,
    isHead: HEAD_CUT,
    pivot: HEAD_PIVOT,
    scale: HEAD_SCALE,
    offset: HEAD_OFFSET,
    createBody,
  });
}
