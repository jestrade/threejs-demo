import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { createShorkie } from './dog.js';
import { loadMeshyShorkie, loadMeshyWalker } from './meshyDog.js';
import { loadTripoShorkie, loadTripoWalker } from './tripoDog.js';

// ---------- Escena ----------
const container = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#d3dee6', 14, 45);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.05, 200);
camera.position.set(2.6, 1.6, 3.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 1;
controls.maxDistance = 14;
controls.maxPolarAngle = Math.PI * 0.49;
controls.target.set(0, 0.5, 0);

// ---------- Cielo e iluminación ----------
const SUN_DIR = new THREE.Vector3(4, 6, 3).normalize();

function makeSky() {
  const sky = new Sky();
  sky.scale.setScalar(100);
  const u = sky.material.uniforms;
  u.turbidity.value = 5;
  u.rayleigh.value = 1.4;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.copy(SUN_DIR);
  return sky;
}
scene.add(makeSky());

// Iluminación ambiental (IBL) a partir del mismo cielo + rebote del pasto,
// para reflejos naturales en ojos, nariz y pelo
{
  const envScene = new THREE.Scene();
  envScene.add(makeSky());
  const bounce = new THREE.Mesh(
    new THREE.CircleGeometry(50, 32),
    new THREE.MeshBasicMaterial({ color: '#5d6b45' })
  );
  bounce.rotation.x = -Math.PI / 2;
  bounce.position.y = -1;
  envScene.add(bounce);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.7;
}

scene.add(new THREE.HemisphereLight('#dfeaff', '#8d8a62', 0.6));
const sun = new THREE.DirectionalLight('#fff0d6', 3.2);
sun.position.copy(SUN_DIR).multiplyScalar(9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -1.6;
sun.shadow.camera.right = 1.6;
sun.shadow.camera.top = 1.6;
sun.shadow.camera.bottom = -1.6;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 20;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(sun.target);

// ---------- Suelo ----------
// Textura de pasto/tierra con ruido, generada en un canvas
function noiseTexture(base, spots, repeat) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = spots[i % spots.length];
    g.globalAlpha = 0.15 + Math.random() * 0.35;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  return tex;
}

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(40, 64),
  new THREE.MeshStandardMaterial({
    map: noiseTexture('#7d9455', ['#6a8246', '#91a865', '#5c7240', '#a3a76b'], 60),
    roughness: 1,
  })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const PATH_RADIUS = 3;
const path = new THREE.Mesh(
  new THREE.RingGeometry(PATH_RADIUS - 0.35, PATH_RADIUS + 0.35, 96),
  new THREE.MeshStandardMaterial({
    map: noiseTexture('#b9a78a', ['#a59275', '#c8b89c', '#8f7f66'], 20),
    roughness: 1,
  })
);
path.rotation.x = -Math.PI / 2;
path.position.y = 0.002;
path.receiveShadow = true;
scene.add(path);

// Pasto
{
  const blade = new THREE.ConeGeometry(0.012, 0.12, 3).translate(0, 0.06, 0);
  const count = 12000;
  const grass = new THREE.InstancedMesh(blade, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }), count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const c = new THREE.Color();
  let i = 0;
  while (i < count) {
    const r = Math.sqrt(Math.random()) * 18;
    if (Math.abs(r - PATH_RADIUS) < 0.5) continue;
    const a = Math.random() * Math.PI * 2;
    e.set((Math.random() - 0.5) * 0.4, Math.random() * Math.PI, (Math.random() - 0.5) * 0.4);
    q.setFromEuler(e);
    const s = 0.6 + Math.random() * 0.9;
    m.compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), q, new THREE.Vector3(s, s, s));
    grass.setMatrixAt(i, m);
    grass.setColorAt(i, c.setHSL(0.2 + Math.random() * 0.07, 0.4, 0.28 + Math.random() * 0.14));
    i++;
  }
  grass.receiveShadow = true;
  scene.add(grass);
}

// Una pelotita roja para darle escala
const ball = new THREE.Mesh(
  new THREE.SphereGeometry(0.12, 24, 16),
  new THREE.MeshStandardMaterial({ color: '#e0533d', roughness: 0.5 })
);
ball.position.set(0, 0.12, 0);
ball.castShadow = true;
scene.add(ball);

// ---------- Perro ----------
// ?quality=0.5 reduce la cantidad de mechones (útil en equipos lentos);
// en celulares se usa la mitad por defecto
const params = new URLSearchParams(location.search);
const quality = THREE.MathUtils.clamp(
  parseFloat(params.get('quality')) || (matchMedia('(pointer: coarse)').matches ? 0.5 : 1),
  0.1,
  2
);
// Cinco perros: Tripo y Meshy caminando (su cabeza sobre el cuerpo procedural),
// Tripo y Meshy quietos (el modelo completo) y el procedural
const dogs = {};
let dog = null;
let dogRequest = 0;

async function getDog(kind) {
  if (!dogs[kind]) {
    const meshy = { objUrl: 'models/shorkie-meshy.obj', textureUrl: 'models/shorkie-meshy.webp' };
    const tripo = { url: 'models/shorkie-tripo.glb' };
    const createBody = (coat, options) => createShorkie({ quality, coat, ...options });
    if (kind === 'tripo') dogs[kind] = loadTripoShorkie(tripo);
    else if (kind === 'tripo-walk') dogs[kind] = loadTripoWalker({ ...tripo, createBody });
    else if (kind === 'meshy') dogs[kind] = loadMeshyShorkie(meshy);
    else if (kind === 'meshy-walk') dogs[kind] = loadMeshyWalker({ ...meshy, createBody });
    else dogs[kind] = Promise.resolve(createShorkie({ quality }));
  }
  return dogs[kind];
}

async function setDog(kind) {
  const request = ++dogRequest;
  document.body.classList.add('loading');
  const next = await getDog(kind);
  if (request !== dogRequest) return; // el usuario cambió de opinión mientras cargaba
  if (dog) scene.remove(dog.group);
  dog = next;
  scene.add(dog.group);
  document.body.classList.remove('loading');
  document.body.classList.toggle('static-dog', !dog.canWalk);
}

// ---------- UI ----------
const ui = {
  model: document.getElementById('model'),
  speed: document.getElementById('speed'),
  manual: document.getElementById('manual'),
  follow: document.getElementById('follow'),
  pause: document.getElementById('pause'),
  bark: document.getElementById('bark'),
  bubble: document.getElementById('bubble'),
};

let paused = false;
ui.pause.addEventListener('click', () => {
  paused = !paused;
  ui.pause.textContent = paused ? '▶ Caminar' : '⏸ Pausar';
});

const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    bark();
    return;
  }
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
    e.preventDefault();
    keys.add(e.code);
    if (!ui.manual.checked) ui.manual.checked = true;
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
ui.bark.addEventListener('click', bark);

ui.model.value = ['tripo', 'meshy-walk', 'meshy', 'procedural'].includes(params.get('dog')) ? params.get('dog') : 'tripo-walk';
ui.model.addEventListener('change', () => setDog(ui.model.value));
setDog(ui.model.value);

let bubbleTimer = 0;
let audioCtx = null;
let barkTimers = [];

// Ladrido real (grabado del perro): tres ladridos; la boca/cabeza se mueve en cada uno
const BARK_URL = 'sounds/bark.mp3';
const BARK_ONSETS = [0.02, 0.34, 0.71]; // segundos dentro del audio
let barkBuffer = null;
async function loadBark() {
  barkBuffer ??= fetch(BARK_URL)
    .then((r) => r.arrayBuffer())
    .then((data) => audioCtx.decodeAudioData(data))
    .catch(() => null);
  return barkBuffer;
}

function bark() {
  if (!dog) return;
  try {
    audioCtx ??= new AudioContext();
    audioCtx.resume();
  } catch {
    audioCtx = null;
  }
  const play = async () => {
    const buffer = audioCtx && (await loadBark());
    barkTimers.forEach(clearTimeout);
    if (!buffer) {
      if (audioCtx) synthBark();
      dog.bark();
      showBubble(0.9);
      return;
    }
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start();
    barkTimers = BARK_ONSETS.map((t) => setTimeout(() => dog?.bark(), t * 1000));
    showBubble(buffer.duration + 0.1);
  };
  play();
}

function showBubble(seconds) {
  bubbleTimer = seconds;
  ui.bubble.classList.add('show');
}

// Respaldo si el audio no se puede cargar: ladrido sintetizado
function synthBark() {
  const t = audioCtx.currentTime;
  for (const [delay, f] of [[0, 520], [0.16, 600]]) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(f, t + delay);
    osc.frequency.exponentialRampToValueAtTime(f * 0.55, t + delay + 0.11);
    gain.gain.setValueAtTime(0.0001, t + delay);
    gain.gain.exponentialRampToValueAtTime(0.25, t + delay + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.12);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t + delay);
    osc.stop(t + delay + 0.13);
  }
}

// ---------- Movimiento ----------
const state = {
  angle: 0, // ángulo sobre el camino circular (modo automático)
  heading: Math.PI, // orientación del perro
  speed: 0,
  pos: new THREE.Vector3(PATH_RADIUS, 0, 0),
};

const clock = new THREE.Clock();
const headWorld = new THREE.Vector3();
const prevTarget = new THREE.Vector3();

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;
  const maxSpeed = parseFloat(ui.speed.value);

  let targetSpeed = paused ? 0 : maxSpeed;

  if (ui.manual.checked) {
    const fwd = keys.has('KeyW') || keys.has('ArrowUp');
    const back = keys.has('KeyS') || keys.has('ArrowDown');
    const left = keys.has('KeyA') || keys.has('ArrowLeft');
    const right = keys.has('KeyD') || keys.has('ArrowRight');
    targetSpeed = fwd ? Math.max(maxSpeed, 0.3) : back ? -0.3 : 0;
    if (left) state.heading += 2.2 * dt;
    if (right) state.heading -= 2.2 * dt;
    // al girar sin avanzar, da pasitos
    if (!fwd && !back && (left || right)) targetSpeed = 0.15;
  }

  // el modelo de Meshy está sentado: se queda en su lugar
  const canWalk = dog?.canWalk ?? false;
  if (!canWalk) targetSpeed = 0;
  state.speed += (targetSpeed - state.speed) * Math.min(1, dt * 4);

  if (!canWalk) {
    // sin moverse ni girar
  } else if (ui.manual.checked) {
    state.pos.x += Math.sin(state.heading) * state.speed * dt;
    state.pos.z += Math.cos(state.heading) * state.speed * dt;
    state.pos.clampLength(0, 16);
  } else {
    // Sigue el camino circular, corrigiendo suavemente si venía del modo manual
    state.angle -= (state.speed / PATH_RADIUS) * dt;
    const goal = new THREE.Vector3(Math.cos(state.angle) * PATH_RADIUS, 0, Math.sin(state.angle) * PATH_RADIUS);
    const tangent = new THREE.Vector3(Math.sin(state.angle), 0, -Math.cos(state.angle));
    const toGoal = goal.clone().sub(state.pos);
    const dir = tangent.clone().addScaledVector(toGoal, 1.5).normalize();
    const desired = Math.atan2(dir.x, dir.z);
    let diff = desired - state.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    state.heading += diff * Math.min(1, dt * 3);
    state.pos.x += Math.sin(state.heading) * state.speed * dt;
    state.pos.z += Math.cos(state.heading) * state.speed * dt;
  }

  if (dog) {
    dog.group.position.copy(state.pos);
    dog.group.rotation.y = state.heading;
    dog.update(dt, state.speed, time);
  }

  // La sombra sigue al perro
  sun.position.copy(SUN_DIR).multiplyScalar(9).add(state.pos);
  sun.target.position.copy(state.pos);

  // Cámara que acompaña
  if (ui.follow.checked) {
    prevTarget.copy(controls.target);
    controls.target.lerp(new THREE.Vector3(state.pos.x, 0.5, state.pos.z), Math.min(1, dt * 3));
    camera.position.add(controls.target.clone().sub(prevTarget));
  }
  controls.update();

  // Globo "¡Guau!" sobre la cabeza
  if (bubbleTimer > 0 && dog) {
    bubbleTimer -= dt;
    dog.head.getWorldPosition(headWorld);
    headWorld.y += 0.45;
    headWorld.project(camera);
    ui.bubble.style.left = `${(headWorld.x * 0.5 + 0.5) * window.innerWidth}px`;
    ui.bubble.style.top = `${(-headWorld.y * 0.5 + 0.5) * window.innerHeight}px`;
    if (bubbleTimer <= 0) ui.bubble.classList.remove('show');
  }

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Acceso para depurar desde la consola
window.shorkie = { scene, camera, controls, state, get dog() { return dog; } };

tick();
