import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { rigSittingDog, addRegionRig, coatFromTexture } from './meshyDog.js';

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

// ---------- Versión que camina ----------
// El cuerpo de Tripo está echado (patas dobladas debajo), así que se "levanta":
// se corta la parte que toca el suelo, se estira en vertical para que tenga la
// altura de un perro de pie, se nivela el lomo y se monta sobre las patas y la
// cola del perro procedural (sin su pelaje). La cabeza sigue la animación de la
// cabeza procedural con el mismo rig por regiones.
const CUT_Y = 0.09; // por debajo (patas dobladas y apoyo en el suelo) se descarta
const SCALE = 1.5; // en planta y para la cabeza
const BODY_WIDEN = 1.3; // el torso echado es más angosto que las patas procedurales
const BODY_STRETCH = 2.2; // escala vertical del cuerpo (echado es más bajo que de pie)
const BOTTOM = 0.22 - 0.545; // borde inferior del pelaje, en el espacio del root procedural
const Z_OFFSET = 0.02;

// Estiramiento vertical acumulado: BODY_STRETCH en el cuerpo y SCALE desde el cuello
const STEPS = 256;
const heightMap = new Float32Array(STEPS + 1);
for (let i = 1; i <= STEPS; i++) {
  const y = CUT_Y + ((0.6 - CUT_Y) * (i - 0.5)) / STEPS;
  const slope = THREE.MathUtils.lerp(BODY_STRETCH, SCALE, smoothstep(0.22, 0.32, y));
  heightMap[i] = heightMap[i - 1] + (slope * (0.6 - CUT_Y)) / STEPS;
}
function mapHeight(y) {
  const t = THREE.MathUtils.clamp(((y - CUT_Y) / (0.6 - CUT_Y)) * STEPS, 0, STEPS);
  const i = Math.min(STEPS - 1, Math.floor(t));
  return heightMap[i] + (heightMap[i + 1] - heightMap[i]) * (t - i) + Math.min(0, y - CUT_Y) * BODY_STRETCH;
}

// Altura del lomo de Tripo a lo largo del cuerpo (z = -0.30 … 0.10, cada 0.04):
// echado, la grupa queda mucho más baja que la cruz
const BACK_Z0 = -0.3;
const BACK = [0.097, 0.13, 0.161, 0.187, 0.209, 0.227, 0.239, 0.246, 0.254, 0.261, 0.269];
function backHeight(z) {
  const t = THREE.MathUtils.clamp((z - BACK_Z0) / 0.04, 0, BACK.length - 1);
  const i = Math.min(BACK.length - 2, Math.floor(t));
  return BACK[i] + (BACK[i + 1] - BACK[i]) * (t - i);
}
// lomo de pie: nivelado a la altura de la cruz y redondeado en la grupa
const backTarget = (z) => 0.27 - 0.35 * Math.max(0, -0.18 - z) ** 1.5 * 10;

// coordenadas de Tripo → espacio del root del perro procedural
function standUp(x, y, z, out = new THREE.Vector3()) {
  // se estira hacia arriba desde el corte para nivelar el lomo (solo en el cuerpo)
  const body = smoothstep(0.2, 0.12, z);
  const rump = 1 + body * ((backTarget(z) - CUT_Y) / (backHeight(z) - CUT_Y) - 1);
  const yl = CUT_Y + (y - CUT_Y) * rump;
  // el torso está corrido hacia -x; la cabeza no
  const shift = THREE.MathUtils.lerp(0.03, 0.075, body);
  return out.set((x + shift) * SCALE * THREE.MathUtils.lerp(1, BODY_WIDEN, body), BOTTOM + mapHeight(yl), z * SCALE + Z_OFFSET);
}

export async function loadTripoWalker({ url, createBody }) {
  const source = await loadTripo(url);
  const geometry = source.geometry.clone();

  // quita los triángulos con algún vértice por debajo del corte
  const pos = geometry.attributes.position;
  const index = geometry.index.array;
  const kept = [];
  for (let t = 0; t < index.length; t += 3) {
    if (pos.getY(index[t]) > CUT_Y && pos.getY(index[t + 1]) > CUT_Y && pos.getY(index[t + 2]) > CUT_Y) {
      kept.push(index[t], index[t + 1], index[t + 2]);
    }
  }
  geometry.setIndex(kept);

  // pesos de las regiones en las coordenadas originales, antes de deformar
  const rig = {
    weights: (x, y, z) => {
      const ear = smoothstep(0.385, 0.42, y);
      return [smoothstep(0.2, 0.29, y) * smoothstep(0.16, 0.25, z), 0, ear * smoothstep(-0.07, -0.09, x), ear * smoothstep(-0.07, -0.05, x)];
    },
    headPivot: standUp(HEAD_PIVOT.x, HEAD_PIVOT.y, HEAD_PIVOT.z),
    earPivots: EAR_PIVOTS.map((p) => standUp(p.x, p.y, p.z)),
    tailPivot: new THREE.Vector3(),
    chest: new THREE.Vector3(),
  };

  // deforma posiciones y normales (con la inversa transpuesta del jacobiano)
  const nrm = geometry.attributes.normal;
  const p = new THREE.Vector3();
  const d = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const J = new THREE.Matrix3();
  const n = new THREE.Vector3();
  const h = 1e-3;
  const moved = new Float32Array(pos.count * 3);
  const normals = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    // los vértices bajo el corte ya no se usan: se dejan en el borde (bounding sphere)
    const x = pos.getX(i), y = Math.max(CUT_Y, pos.getY(i)), z = pos.getZ(i);
    standUp(x, y, z, p);
    standUp(x + h, y, z, d[0]).sub(p);
    standUp(x, y + h, z, d[1]).sub(p);
    standUp(x, y, z + h, d[2]).sub(p);
    J.set(d[0].x, d[1].x, d[2].x, d[0].y, d[1].y, d[2].y, d[0].z, d[1].z, d[2].z).invert().transpose();
    n.fromBufferAttribute(nrm, i).applyMatrix3(J).normalize();
    p.toArray(moved, i * 3);
    n.toArray(normals, i * 3);
  }
  const material = source.material.clone();
  material.side = THREE.DoubleSide; // por debajo se ve el interior, no el cielo
  material.color.setRGB(1.12, 1.1, 1.06); // un poco más clara para igualar las patas
  material.envMapIntensity = 0.7;
  const uniforms = addRegionRig(geometry, material, rig); // pesos con la pose original
  geometry.setAttribute('position', new THREE.BufferAttribute(moved, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // las patas y la cola procedurales se tiñen con colores del pelaje de Tripo
  const uv = geometry.attributes.uv;
  const uvs = [];
  for (let t = 0; t < kept.length; t += 3 * 40) {
    for (let k = 0; k < 3; k++) uvs.push(uv.getX(kept[t + k]), uv.getY(kept[t + k]));
  }
  const dog = createBody(coatFromTexture(material.map.image, uvs, material.map.flipY), { bodyHair: false });
  const { head } = dog;
  head.clear(); // la cabeza procedural solo queda como referencia de la animación
  head.parent.add(mesh);
  // la cola procedural sale de la grupa de Tripo
  standUp(-0.04, backTarget(-0.23) - 0.05, -0.23, dog.tail.position);
  dog.tail.rotation.x = 0.5; // más pegada al lomo
  dog.tail.scale.setScalar(0.85);

  // la cabeza de Tripo copia la rotación de la cabeza procedural
  const m4 = new THREE.Matrix4();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const setRotation = (target, x, y, z) => target.setFromMatrix4(m4.makeRotationFromEuler(euler.set(x, y, z)));
  const update = (dt, speed, time) => {
    dog.update(dt, speed, time);
    uniforms.uHeadRot.value.setFromMatrix4(m4.makeRotationFromEuler(head.rotation));
    const twitchL = Math.max(0, Math.sin(time * 0.8) - 0.9) * 2.5;
    const twitchR = Math.max(0, Math.sin(time * 0.65 + 2) - 0.9) * 2.5;
    setRotation(uniforms.uEarRotL.value, -twitchL * 0.4, 0, twitchL * 0.25);
    setRotation(uniforms.uEarRotR.value, -twitchR * 0.4, 0, -twitchR * 0.25);
  };

  // el globo "¡Guau!" sale sobre la cabeza de Tripo
  const marker = new THREE.Object3D();
  marker.position.copy(standUp(-0.03, 0.42, 0.34));
  head.parent.add(marker);
  return { ...dog, head: marker, update, canWalk: true };
}
