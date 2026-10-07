import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createShorkie } from './dog.js';

// ---------- Escena ----------
const container = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#dfe9f2');
scene.fog = new THREE.Fog('#dfe9f2', 12, 40);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.05, 200);
camera.position.set(2.6, 1.6, 3.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 1;
controls.maxDistance = 14;
controls.maxPolarAngle = Math.PI * 0.49;
controls.target.set(0, 0.5, 0);

// Iluminación ambiental (IBL) para reflejos y luz suave en ojos, nariz y pelo
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

scene.add(new THREE.HemisphereLight('#eef5ff', '#a89878', 0.9));
const sun = new THREE.DirectionalLight('#fff1dc', 2.6);
sun.position.set(4, 8, 3);
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
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(40, 64),
  new THREE.MeshStandardMaterial({ color: '#c9dcae', roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const PATH_RADIUS = 3;
const path = new THREE.Mesh(
  new THREE.RingGeometry(PATH_RADIUS - 0.35, PATH_RADIUS + 0.35, 96),
  new THREE.MeshStandardMaterial({ color: '#e6d6bb', roughness: 1 })
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
    grass.setColorAt(i, c.setHSL(0.24 + Math.random() * 0.06, 0.4, 0.45 + Math.random() * 0.15));
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
const dog = createShorkie({ quality });
scene.add(dog.group);

// ---------- UI ----------
const ui = {
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

let bubbleTimer = 0;
let audioCtx = null;
function bark() {
  dog.bark();
  bubbleTimer = 0.9;
  ui.bubble.classList.add('show');
  try {
    audioCtx ??= new AudioContext();
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
  } catch {
    // Sin audio: no pasa nada
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

  state.speed += (targetSpeed - state.speed) * Math.min(1, dt * 4);

  if (ui.manual.checked) {
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

  dog.group.position.copy(state.pos);
  dog.group.rotation.y = state.heading;
  dog.update(dt, state.speed, time);

  // La sombra sigue al perro
  sun.position.set(state.pos.x + 4, 8, state.pos.z + 3);
  sun.target.position.copy(state.pos);

  // Cámara que acompaña
  if (ui.follow.checked) {
    prevTarget.copy(controls.target);
    controls.target.lerp(new THREE.Vector3(state.pos.x, 0.5, state.pos.z), Math.min(1, dt * 3));
    camera.position.add(controls.target.clone().sub(prevTarget));
  }
  controls.update();

  // Globo "¡Guau!" sobre la cabeza
  if (bubbleTimer > 0) {
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
window.shorkie = { scene, camera, controls, dog, state };

tick();
