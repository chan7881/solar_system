// 화면 — 크기·거리 모두 실제 비율(km). 초점 천체를 원점에 두고 그린다(위치 계산은 JS 배정밀도, 그리기 직전에 뺀다).
import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { AU_KM, BODIES, VALID_FROM, VALID_TO, heliocentric, orbitTrail, julianDateTT, eclipticToScene } from './ephemeris.js';

const MIN = 60, HOUR = 3600, DAY = 86400;
// 시간 빠르기(실제 1초에 흐르는 초) — 슬라이더 칸
const RATES = [-365.25 * DAY, -30 * DAY, -7 * DAY, -DAY, -HOUR, -MIN, 0, 1, MIN, HOUR, DAY, 7 * DAY, 30 * DAY, 365.25 * DAY];
const RATE_NAMES = ['1년', '1달', '1주', '1일', '1시간', '1분', '', '', '1분', '1시간', '1일', '1주', '1달', '1년'];
const REALTIME = 7;
const TRAIL_N = 360;
const FOV = 45;

// ---------- 장면 ----------
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 2e11);
const controls = new OrbitControls(camera, canvas);
controls.enablePan = false;
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.zoomSpeed = 1.2;
controls.rotateSpeed = 0.6;
controls.maxDistance = 400 * AU_KM;

const sunLight = new THREE.PointLight(0xffffff, 3, 0, 0);
scene.add(sunLight);
scene.add(new THREE.AmbientLight(0xffffff, 0.04));

const bodies = BODIES.map((b, idx) => {
  const geo = new THREE.SphereGeometry(b.radius, 96, 48);
  const mat = b.key === 'sun'
    ? new THREE.MeshBasicMaterial({ color: b.color })
    : new THREE.MeshStandardMaterial({ color: b.color, roughness: 1, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  let trail = null;
  if (b.key !== 'sun') {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((TRAIL_N + 1) * 3), 3));
    const col = new Float32Array((TRAIL_N + 1) * 4);
    const c = new THREE.Color(b.color).lerp(new THREE.Color(0xffffff), 0.35);
    for (let k = 0; k <= TRAIL_N; k++) {
      col.set([c.r, c.g, c.b, Math.pow(1 - k / TRAIL_N, 1.5) * 0.9], k * 4);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    trail = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
    trail.frustumCulled = false;
    scene.add(trail);
  }
  return { ...b, idx, mesh, trail, pos: [0, 0, 0], trailJd: NaN };
});
const byKey = Object.fromEntries(bodies.map(b => [b.key, b]));

// ---------- 상태 ----------
const state = {
  simMs: Date.now(),
  rateIdx: REALTIME,
  live: true,
  focus: 'sun',
  fly: null, // { from, to, t0, dur, d0, d1, bump, dir0, dir1 }
};

// ---------- 위치 ----------
function updatePositions(jd) {
  for (const b of bodies) {
    const p = eclipticToScene(heliocentric(b.key, jd));
    b.pos = [p[0] * AU_KM, p[1] * AU_KM, p[2] * AU_KM];
  }
}

function updateTrail(b, jd) {
  if (!b.trail || b.trailJd === jd) return;
  b.trailJd = jd;
  const pts = orbitTrail(b.key, jd, TRAIL_N);
  const p0 = pts[0];
  const arr = b.trail.geometry.attributes.position.array;
  // 행성 기준 상대 좌표로 넣는다 — 행성 가까이에서도 float32 오차가 작다
  for (let k = 0; k <= TRAIL_N; k++) {
    const s = eclipticToScene([pts[k][0] - p0[0], pts[k][1] - p0[1], pts[k][2] - p0[2]]);
    arr[k * 3] = s[0] * AU_KM; arr[k * 3 + 1] = s[1] * AU_KM; arr[k * 3 + 2] = s[2] * AU_KM;
  }
  b.trail.geometry.attributes.position.needsUpdate = true;
}

// ---------- 카메라 이동 ----------
const ease = s => s * s * (3 - 2 * s);
// 보이는 영역(조작부 위)의 세로·가로 반화각
let viewH = innerHeight;
const halfV = () => (FOV / 2) * Math.PI / 180;
const halfH = () => Math.atan(Math.tan(halfV()) * innerWidth / viewH);
const pxPerRad = () => (viewH / 2) / Math.tan(halfV());
// 천체가 좁은 쪽 화면의 약 60%를 차지하는 거리
const viewDist = b => b.radius / Math.sin(Math.min(halfV(), halfH()) * 0.6);
// 전체 보기: 해왕성 궤도(약 30AU)가 기울여 본 화면에 들어오는 거리
const OVERVIEW_TILT = 55 * Math.PI / 180;
const overviewDist = () => Math.max(33 * AU_KM / Math.tan(halfH()), 33 * AU_KM * Math.sin(OVERVIEW_TILT) * 1.3 / Math.tan(halfV())); // 세로는 가까운 쪽이 원근으로 커져서 여유 1.3배

// 날아가기 3단계 — ① 두 천체가 함께 보일 만큼 물러나고 ② 옆으로 옮겨 가고 ③ 다가간다.
// 단계마다 걸리는 시간은 거리 배율(로그)에 비례한다. 이미 충분히 멀면 ①은 0초.
function flyTo(key, opts = {}) {
  if (state.fly) return; // 날아가는 중에는 새 요청을 받지 않는다(중간 위치에서 튀지 않게)
  const from = state.focus;
  const d0 = camera.position.length();
  const d1 = opts.dist ?? viewDist(byKey[key]);
  const gap = Math.hypot(...byKey[key].pos.map((v, i) => v - byKey[from].pos[i]));
  const D = Math.max(d0, d1, (gap / Math.tan(Math.min(halfV(), halfH()))) * 1.3);
  const w = [Math.log(D / d0), gap > 0 ? 2 : 0, Math.log(D / d1)];
  const total = w[0] + w[1] + w[2] || 1;
  const dur = opts.instant ? 0 : Math.min(3600, 900 + 260 * total);
  const dir0 = camera.position.clone().normalize();
  const dir1 = opts.dir ? opts.dir.clone().normalize() : dir0.clone();
  state.fly = { from, to: key, t0: performance.now(), dur, d0, d1, D, cut: [w[0] / total, (w[0] + w[1]) / total], dir0, dir1 };
  state.focus = key;
  controls.enabled = false;
  markFocus();
}

function focusPosition(now) {
  const f = state.fly;
  if (!f) return byKey[state.focus].pos;
  const s = f.dur ? Math.min(1, (now - f.t0) / f.dur) : 1;
  const [c1, c2] = f.cut;
  const lerpLog = (x, y, t) => Math.exp(Math.log(x) + (Math.log(y) - Math.log(x)) * t);
  let d, m; // 카메라 거리, 옮겨 간 정도(0~1)
  if (s < c1) { d = lerpLog(f.d0, f.D, ease(s / c1)); m = 0; }
  else if (s < c2) { d = f.D; m = ease((s - c1) / (c2 - c1)); }
  else { d = c2 < 1 ? lerpLog(f.D, f.d1, ease((s - c2) / (1 - c2))) : f.d1; m = 1; }
  const a = byKey[f.from].pos, b = byKey[f.to].pos;
  const dir = f.dir0.clone().lerp(f.dir1, ease(s));
  if (dir.lengthSq() < 1e-6) dir.copy(f.dir1); // 정반대 방향일 때 0 벡터 방지
  dir.normalize();
  camera.position.copy(dir.multiplyScalar(d));
  if (s >= 1) {
    state.fly = null;
    controls.enabled = true;
    controls.minDistance = byKey[state.focus].radius * 1.15;
  }
  return [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m];
}

// ---------- 이름표 ----------
const labelLayer = document.getElementById('labels');
const PRIORITY = ['sun', 'jupiter', 'saturn', 'earth', 'uranus', 'neptune', 'venus', 'mars', 'mercury'];
for (const b of bodies) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'label';
  el.innerHTML = `<span class="ring"></span><span class="name">${b.name}</span>`;
  el.addEventListener('click', () => flyTo(b.key));
  labelLayer.appendChild(el);
  b.label = el;
  b.ring = el.querySelector('.ring');
  b.nameEl = el.querySelector('.name');
}

const tmp = new THREE.Vector3();
function updateLabels() {
  const W = innerWidth, H = innerHeight;
  const ppr = pxPerRad();
  const placed = [];
  const order = [state.focus, ...PRIORITY.filter(k => k !== state.focus)];
  for (const key of order) {
    const b = byKey[key];
    tmp.copy(b.mesh.position);
    const dist = tmp.distanceTo(camera.position);
    // 앞뒤는 카메라 좌표로 판정한다 — 먼 천체는 투영 z가 반올림돼 1이 되므로 z<1로는 못 가린다
    tmp.applyMatrix4(camera.matrixWorldInverse);
    const front = tmp.z < 0;
    tmp.applyMatrix4(camera.projectionMatrix);
    const visible = front && Math.abs(tmp.x) < 1.02 && Math.abs(tmp.y) < 1.02;
    const x = (tmp.x + 1) / 2 * W, y = (1 - tmp.y) / 2 * H;
    const pr = (b.radius / dist) * ppr;
    b.pixelRadius = pr;
    const clash = placed.some(p => Math.hypot(p[0] - x, p[1] - y) < 26);
    if (!visible || clash || dist < b.radius) { b.label.style.display = 'none'; continue; }
    placed.push([x, y]);
    b.label.style.display = '';
    b.label.style.transform = `translate(${x}px, ${y}px)`;
    const ringD = pr < 6 ? 14 : 0;
    b.ring.style.width = b.ring.style.height = ringD + 'px';
    b.ring.style.display = ringD ? '' : 'none';
    const off = Math.max(ringD / 2, pr) + 6;
    // 오른쪽 끝에서 잘리면 이름을 동그라미 왼쪽에 둔다
    const flip = ringD && x + off + (b.nameW ||= b.nameEl.offsetWidth) > W - 4;
    b.nameEl.style.transform = !ringD ? `translate(-50%, ${-off - 18}px)`
      : flip ? `translate(calc(-100% - ${off}px), -50%)` : `translate(${off}px, -50%)`;
  }
}

// ---------- 화면 조작부 ----------
const bodiesNav = document.getElementById('bodies');
const navButtons = {};
for (const b of bodies) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = b.name;
  btn.addEventListener('click', () => flyTo(b.key));
  bodiesNav.appendChild(btn);
  navButtons[b.key] = btn;
}
const overviewBtn = document.createElement('button');
overviewBtn.type = 'button';
overviewBtn.textContent = '전체';
const OVERVIEW_DIR = new THREE.Vector3(0, Math.sin(OVERVIEW_TILT), Math.cos(OVERVIEW_TILT));
overviewBtn.addEventListener('click', () => flyTo('sun', { dist: overviewDist(), dir: OVERVIEW_DIR }));
bodiesNav.appendChild(overviewBtn);

function markFocus() {
  for (const b of bodies) {
    navButtons[b.key].setAttribute('aria-pressed', String(b.key === state.focus));
    b.label.classList.toggle('focus', b.key === state.focus);
  }
}

const liveBtn = document.getElementById('live');
const rateInput = document.getElementById('rate');
const whenInput = document.getElementById('when');
const dateEl = document.getElementById('date');
const rateEl = document.getElementById('rate-text');
rateInput.max = String(RATES.length - 1);
const pad = n => String(n).padStart(2, '0');
const toLocalInput = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
whenInput.min = toLocalInput(VALID_FROM);
whenInput.max = toLocalInput(VALID_TO);

liveBtn.addEventListener('click', () => {
  state.live = true; state.simMs = Date.now(); state.rateIdx = REALTIME; rateInput.value = String(REALTIME);
});
rateInput.addEventListener('input', () => {
  state.rateIdx = +rateInput.value;
  if (state.rateIdx !== REALTIME) state.live = false;
});
whenInput.addEventListener('change', () => {
  const ms = new Date(whenInput.value).getTime();
  if (Number.isFinite(ms)) { state.simMs = Math.min(VALID_TO, Math.max(VALID_FROM, ms)); state.live = false; }
});

function rateText(i) {
  if (RATES[i] === 0) return '정지';
  if (i === REALTIME) return state.live ? '실시간' : '실제 빠르기';
  return (RATES[i] < 0 ? '거꾸로 · ' : '') + `1초에 ${RATE_NAMES[i]}`;
}
const dateFmt = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
let lastWhen = '';
function updateClock() {
  dateEl.textContent = dateFmt.format(state.simMs);
  rateEl.textContent = rateText(state.rateIdx);
  liveBtn.setAttribute('aria-pressed', String(state.live));
  if (document.activeElement !== whenInput) {
    const v = toLocalInput(state.simMs);
    if (v !== lastWhen) { whenInput.value = v; lastWhen = v; }
  }
}

// ---------- 한 장면 ----------
let lastT = performance.now();
function step(now = performance.now()) {
  const dt = Math.min(0.25, (now - lastT) / 1000);
  lastT = now;
  if (state.live) state.simMs = Date.now();
  else state.simMs += RATES[state.rateIdx] * dt * 1000;
  if (state.simMs <= VALID_FROM || state.simMs >= VALID_TO) {
    state.simMs = Math.min(VALID_TO, Math.max(VALID_FROM, state.simMs));
    state.rateIdx = 6; rateInput.value = '6';
  }
  const jd = julianDateTT(state.simMs);
  updatePositions(jd);
  const fp = focusPosition(now);
  const ppr = pxPerRad();
  for (const b of bodies) {
    const rel = [b.pos[0] - fp[0], b.pos[1] - fp[1], b.pos[2] - fp[2]];
    b.mesh.position.set(rel[0], rel[1], rel[2]);
    if (b.key === 'sun') sunLight.position.copy(b.mesh.position);
    if (b.trail) {
      updateTrail(b, jd);
      b.trail.position.copy(b.mesh.position);
      // 행성이 화면에서 커지면 궤도선이 행성을 뚫고 지나가 보이므로 흐리게 한다
      const pr = (b.radius / b.mesh.position.distanceTo(camera.position)) * ppr;
      b.trail.material.opacity = THREE.MathUtils.clamp(1 - (pr - 3) / 25, 0, 1);
      b.trail.visible = b.trail.material.opacity > 0.01;
    }
  }
  if (!state.fly) controls.update();
  else camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  updateLabels();
  updateClock();
}

function draw() { renderer.render(scene, camera); }

// 화면 중심을 조작부 위 보이는 영역의 가운데로 옮긴다(세로 화각 45°도 그 영역 기준)
const panelEl = document.getElementById('panel');
function resize() {
  const W = innerWidth, H = innerHeight;
  viewH = Math.max(100, H - panelEl.offsetHeight);
  renderer.setSize(W, H, false);
  camera.aspect = W / viewH;
  camera.setViewOffset(W, viewH, 0, 0, W, H);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// 처음 화면: 태양계 전체
camera.position.copy(OVERVIEW_DIR).multiplyScalar(overviewDist());
controls.minDistance = byKey.sun.radius * 1.15;
updatePositions(julianDateTT(state.simMs));
markFocus();

renderer.setAnimationLoop(t => { step(t); draw(); });

// 자동 확인용(백그라운드 탭에서는 requestAnimationFrame이 돌지 않는다)
window.__app = { state, step, draw, flyTo, camera, bodies: byKey, RATES };
