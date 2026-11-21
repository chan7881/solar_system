// 화면 — 크기·거리 모두 실제 비율(km). 초점 천체를 원점에 두고 그린다(위치 계산은 JS 배정밀도, 그리기 직전에 뺀다).
import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { AU_KM, BODIES, VALID_FROM, VALID_TO, heliocentric, orbitTrail, julianDateTT, eclipticToScene, bodyAxes, ellipsoidRadius, hasRotation } from './ephemeris.js';
import { RING_EDGES, RING_ALBEDO, ringMipLevels } from './rings.js';
import { MOONS, systemOffsets, moonTrailCache } from './moons.js';

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

// 표면 지도(단순 원통 도법, 가운데 = 경도 0°, 동경+) — 출처는 textures/출처.md. 없는 천체는 단색.
const TEXTURED = new Set(['mercury', 'earth', 'mars', 'jupiter', 'saturn', 'moon']);
const texLoader = new THREE.TextureLoader();
// 지도를 받아 질감으로 돌려준다(Promise). 받은 뒤에 재질에 넣는 것은 부르는 쪽이 한다.
function loadTexture(url) {
  return new Promise((resolve, reject) => texLoader.load(url, tex => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    resolve(tex);
  }, undefined, reject));
}
function setMap(mat, tex, color) {
  mat.map = tex;
  mat.color.set(tex ? 0xffffff : color);
  mat.needsUpdate = true;
}
function loadSurface(key, mat) {
  const url = `textures/${key}_2k.jpg`;
  loadTexture(url).then(tex => setMap(mat, tex), () => console.warn(`표면 지도를 못 불러옴: ${url} — 단색으로 둔다`));
}

// 회전 타원체 몸체. 구의 꼭짓점 방향(지도의 v = 행성 중심 위도)을 그대로 두고 그 방향의 타원체 거리로 옮긴다 —
// 지도 위도가 행성 중심 위도라서(textures/출처.md) 이렇게 해야 위도가 맞는다. 법선은 타원체 면의 법선.
function ellipsoidGeometry(re, rp) {
  const geo = new THREE.SphereGeometry(1, 96, 48);
  const pos = geo.attributes.position, nor = geo.attributes.normal, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = ellipsoidRadius(re, rp, Math.asin(THREE.MathUtils.clamp(v.y, -1, 1)));
    v.multiplyScalar(r);
    pos.setXYZ(i, v.x, v.y, v.z);
    nor.setXYZ(i, v.x / (re * re), v.y / (rp * rp), v.z / (re * re));
  }
  geo.normalizeNormals();
  geo.computeBoundingSphere();
  return geo;
}

// 짙은 대기에 가려 겉에서는 표면이 안 보이는 천체 — 「대기 끄기」를 누르면 표면 지도로 바꾼다(처음 누를 때 받는다).
// 금성: Magellan 레이더 지도(흑백, 레이더 반사 세기 — 눈으로 보는 색이 아니다)
const SURFACE_UNDER = { venus: 'textures/venus_surface_2k.jpg' };

// 위성은 구(평균 반지름)로 그린다 — 자세 모형(hasRotation)이 있는 것만 돌린다(지금은 달). 나머지는 단색이라 돌려도 보이지 않는다
const ALL = [...BODIES, ...MOONS];
const bodies = ALL.map(b => {
  const geo = b.parent ? new THREE.SphereGeometry(b.radius, ...(TEXTURED.has(b.key) ? [96, 48] : [48, 24])) : ellipsoidGeometry(b.re, b.rp);
  const mat = b.key === 'sun'
    ? new THREE.MeshBasicMaterial({ color: b.color })
    : new THREE.MeshStandardMaterial({ color: b.color, roughness: 1, metalness: 0 });
  if (TEXTURED.has(b.key)) loadSurface(b.key, mat);
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
  return { ...b, mesh, trail, pos: [0, 0, 0], trailJd: NaN, moonTrail: b.parent ? moonTrailCache(b.key, TRAIL_N) : null };
});
const byKey = Object.fromEntries(bodies.map(b => [b.key, b]));

// ---------- 토성 고리 ----------
// 토성 몸체의 자식으로 적도면(로컬 XZ)에 둔다. 밝기·비침·그림자 식은 src/rings.js와 같다(테스트는 그쪽에).
// 계산은 토성 로컬 좌표(km): 고리면 법선 = +Y, 해·카메라 방향은 매 장면 CPU에서 로컬로 바꿔 넣는다.
const ringU = {
  uTau: { value: null }, uR0: { value: 0 }, uR1: { value: 1 },
  uSunL: { value: new THREE.Vector3(1, 0, 0) }, uCamL: { value: new THREE.Vector3(0, 1, 0) },
  uRe: { value: byKey.saturn.re }, uRp: { value: byKey.saturn.rp }, uLight: { value: 3 / Math.PI }, // 해 빛 세기 3(PointLight)과 같은 눈금
};
const RING_GLSL = /* glsl */`
  uniform sampler2D uTau; uniform float uR0, uR1;
  uniform vec3 uSunL;
  float ringTau(float r) {
    if (r < uR0 || r > uR1) return 0.0;
    return texture2D(uTau, vec2((r - uR0) / (uR1 - uR0), 0.5)).r;
  }`;
const ringMat = new THREE.ShaderMaterial({
  uniforms: ringU,
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  // 미리 곱한 알파: 결과 = 고리 빛 + 배경 × 비침(T)
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  vertexShader: /* glsl */`
    #include <common>
    #include <logdepthbuf_pars_vertex>
    varying vec3 vP;
    void main() {
      vP = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */`
    #include <common>
    #include <logdepthbuf_pars_fragment>
    ${RING_GLSL}
    uniform vec3 uCamL; uniform float uRe, uRp, uLight;
    varying vec3 vP;
    void main() {
      #include <logdepthbuf_fragment>
      float r = length(vP.xz);
      float tau = ringTau(r);
      if (tau <= 0.0) discard;
      vec3 v = normalize(uCamL - vP);
      float mu = max(1e-3, abs(v.y)), mu0 = max(1e-3, abs(uSunL.y));
      float T = exp(-tau / mu);
      float F;
      if (v.y * uSunL.y > 0.0) F = 2.0 * mu0 / (mu + mu0) * (1.0 - exp(-tau * (1.0 / mu + 1.0 / mu0)));
      else if (abs(mu - mu0) < 1e-4) F = 2.0 * tau / mu * T;
      else F = 2.0 * mu0 / (mu - mu0) * (T - exp(-tau / mu0));
      // 토성 그림자(해 쪽으로 간 빛줄기가 회전 타원체 몸체에 막힘) — y를 늘여 구 문제로 바꾼다(src/rings.js inPlanetShadow)
      vec3 pp = vec3(vP.x, vP.y * uRe / uRp, vP.z), ss = vec3(uSunL.x, uSunL.y * uRe / uRp, uSunL.z);
      float qa = dot(ss, ss), qb = dot(pp, ss);
      if (qb < 0.0 && qb * qb - qa * (dot(pp, pp) - uRe * uRe) > 0.0) F = 0.0;
      // 고리별 반사율·색(src/rings.js RING_ALBEDO)
      vec4 a = r < ${RING_EDGES.cb.toFixed(1)} ? vec4(${albedoVec(0)})
             : r < ${RING_EDGES.bOut.toFixed(1)} ? vec4(${albedoVec(1)})
             : r < ${RING_EDGES.aIn.toFixed(1)} ? vec4(${albedoVec(2)}) : vec4(${albedoVec(3)});
      gl_FragColor = vec4(a.rgb * a.a * F * uLight, 1.0 - T);
      #include <colorspace_fragment>
    }`,
});
// 색(tint)은 사진을 보고 고른 화면 색(sRGB)이라 선형 값으로 바꿔 넣는다
function albedoVec(i) {
  const { w, tint } = RING_ALBEDO[i], c = new THREE.Color().setRGB(...tint, THREE.SRGBColorSpace);
  return [c.r, c.g, c.b, w].map(x => x.toFixed(4)).join(', ');
}
const ringMesh = new THREE.Mesh(new THREE.BufferGeometry(), ringMat);
ringMesh.visible = false;
byKey.saturn.mesh.add(ringMesh);

// 토성 표면에 지는 고리 그림자: 표면 점에서 해 쪽 빛줄기가 고리면을 지나는 반지름의 τ로 햇빛을 줄인다.
// 햇빛(직접광)에만 곱한다 — 주변광은 남겨 밤 쪽과 같은 방식으로 어두워지게(해는 유일한 직접광)
byKey.saturn.mesh.material.onBeforeCompile = sh => {
  Object.assign(sh.uniforms, { uTau: ringU.uTau, uR0: ringU.uR0, uR1: ringU.uR1, uSunL: ringU.uSunL });
  sh.vertexShader = 'varying vec3 vP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position;');
  sh.fragmentShader = `varying vec3 vP;\n${RING_GLSL}\n` + sh.fragmentShader.replace('#include <lights_fragment_end>', `
    #include <lights_fragment_end>
    if (vP.y * uSunL.y < 0.0 && abs(uSunL.y) > 1e-6) {
      vec3 q = vP - uSunL * (vP.y / uSunL.y);
      float ringT = exp(-ringTau(length(q.xz)) / abs(uSunL.y));
      reflectedLight.directDiffuse *= ringT;
      reflectedLight.directSpecular *= ringT;
    }`);
};

fetch('textures/saturn_rings.json').then(r => r.json()).then(p => {
  // 멀리서 보면 수천 줄의 결이 화소보다 가늘어 물결무늬가 생긴다 → 밉맵. 투과율로 평균한 단계를 CPU에서 만든다
  // (GPU 자동 밉맵은 τ를 그대로 평균해 간극이 메워지고, R16F는 모바일에서 자동 생성이 안 될 수 있다)
  const half = a => Uint16Array.from(a, v => THREE.DataUtils.toHalfFloat(v));
  const levels = ringMipLevels(p.tau);
  const tex = new THREE.DataTexture(half(levels[0]), p.n, 1, THREE.RedFormat, THREE.HalfFloatType);
  tex.mipmaps = levels.map(l => ({ data: half(l), width: l.length, height: 1 }));
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  ringU.uTau.value = tex; ringU.uR0.value = p.r0; ringU.uR1.value = p.r1;
  // 고리 경계 밖(단면 양 끝의 잡음 수준 τ)은 그리지 않는다. XY → 로컬 XZ(법선 +Y = 북극)
  ringMesh.geometry = new THREE.RingGeometry(RING_EDGES.cIn, RING_EDGES.aOut, 720, 1).rotateX(-Math.PI / 2);
  ringMesh.visible = true;
}).catch(e => console.warn('토성 고리 단면을 못 불러옴 — 고리 없이 둔다', e));

const qInv = new THREE.Quaternion();
function updateRings() {
  const m = byKey.saturn.mesh;
  qInv.copy(m.quaternion).invert();
  ringU.uSunL.value.copy(byKey.sun.mesh.position).sub(m.position).normalize().applyQuaternion(qInv);
  ringU.uCamL.value.copy(camera.position).sub(m.position).applyQuaternion(qInv);
}

// ---------- 상태 ----------
const state = {
  atmosphere: true,
  simMs: Date.now(),
  rateIdx: REALTIME,
  live: true,
  focus: 'sun',
  fly: null, // { from, to, t0, dur, d0, d1, bump, dir0, dir1 }
};

// ---------- 위치 ----------
const basis = new THREE.Matrix4(), vx = new THREE.Vector3(), vy = new THREE.Vector3(), vz = new THREE.Vector3();
// 위성이 있는 행성: 궤도 요소가 주는 점은 계 질량중심 → 행성 중심은 위성 질량만큼 반대로 옮긴다(지구는 약 4700km)
const PARENTS = [...new Set(MOONS.map(m => m.parent))];
// 자세: 구의 +Y = 북극, +X = 경도 0°, −Z = 동경 90° (SphereGeometry의 u=0.5가 +X, u가 커질수록 동쪽)
function orient(b, jd) {
  const { pole, prime, east } = bodyAxes(b.key, jd);
  vx.fromArray(eclipticToScene(prime));
  vy.fromArray(eclipticToScene(pole));
  vz.fromArray(eclipticToScene(east)).negate();
  b.mesh.quaternion.setFromRotationMatrix(basis.makeBasis(vx, vy, vz));
}
function updatePositions(jd) {
  const sys = {};
  for (const k of PARENTS) sys[k] = systemOffsets(k, jd);
  for (const b of bodies) {
    if (b.parent) continue; // 위성은 행성이 다 옮겨진 뒤에(아래)
    const h = heliocentric(b.key, jd).map(v => v * AU_KM), o = sys[b.key]?.planet ?? [0, 0, 0];
    b.pos = eclipticToScene([h[0] + o[0], h[1] + o[1], h[2] + o[2]]);
    orient(b, jd);
  }
  for (const b of bodies) {
    if (!b.parent) continue;
    const c = byKey[b.parent].pos, r = eclipticToScene(sys[b.parent].moons[b.key]);
    b.pos = [c[0] + r[0], c[1] + r[1], c[2] + r[2]];
    if (hasRotation(b.key)) orient(b, jd);
  }
}

function updateTrail(b, jd) {
  if (!b.trail || b.trailJd === jd) return;
  b.trailJd = jd;
  // 행성은 태양 중심(AU), 위성은 행성 중심(km) 궤도 — 위성 궤도선은 행성을 따라 움직이는 닫힌 고리로 보인다
  const pts = b.parent ? b.moonTrail(jd) : orbitTrail(b.key, jd, TRAIL_N);
  const scale = b.parent ? 1 : AU_KM;
  const p0 = pts[0];
  const arr = b.trail.geometry.attributes.position.array;
  // 천체 기준 상대 좌표로 넣는다 — 가까이에서도 float32 오차가 작다
  for (let k = 0; k <= TRAIL_N; k++) {
    const s = eclipticToScene([pts[k][0] - p0[0], pts[k][1] - p0[1], pts[k][2] - p0[2]]);
    arr[k * 3] = s[0] * scale; arr[k * 3 + 1] = s[1] * scale; arr[k * 3 + 2] = s[2] * scale;
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
  // 날아가는 중에 누르면 도착한 뒤에 이어서 간다(중간 위치에서 튀지 않게)
  if (state.fly) { state.fly.next = key === state.fly.to ? null : key; return; }
  // 손으로 돌리다 남은 관성을 먼저 털어 낸다 — 남겨 두면 도착한 뒤에 화면이 저절로 돈다
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = damping;
  const from = state.focus;
  // 위성 줄이 나타나거나 사라지면 조작부 높이가 바뀐다 — 거리를 재기 전에 바꾸고 화면 크기를 다시 잡는다
  state.focus = key;
  markFocus();
  if (Math.max(100, innerHeight - panelEl.offsetHeight) !== viewH) resize();
  const d0 = camera.position.length();
  const d1 = opts.dist?.() ?? viewDist(byKey[key]);
  const gap = Math.hypot(...byKey[key].pos.map((v, i) => v - byKey[from].pos[i]));
  const D = Math.max(d0, d1, (gap / Math.tan(Math.min(halfV(), halfH()))) * 1.3);
  const w = [Math.log(D / d0), gap > 0 ? 2 : 0, Math.log(D / d1)];
  const total = w[0] + w[1] + w[2] || 1;
  const dur = Math.min(3600, 900 + 260 * total);
  const dir0 = camera.position.clone().normalize();
  const dir1 = opts.dir ? opts.dir.clone().normalize() : dir0.clone();
  state.fly = { from, to: key, t0: performance.now(), dur, d0, d1, D, cut: [w[0] / total, (w[0] + w[1]) / total], dir0, dir1 };
  controls.enabled = false;
  updateAtmoButton();
}

function focusPosition(now) {
  const f = state.fly;
  if (!f) return byKey[state.focus].pos;
  // 그림 틀 시각이 누른 시각보다 앞설 수 있다 — 0 아래로 내려가면 거리가 NaN이 된다
  const s = THREE.MathUtils.clamp((now - f.t0) / f.dur, 0, 1);
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
    updateAtmoButton();
    if (f.next) flyTo(f.next);
  }
  return [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m];
}

// ---------- 이름표 ----------
const labelLayer = document.getElementById('labels');
// 겹치면 앞쪽이 이긴다 — 행성 다음에 위성(큰 것부터)
const PRIORITY = ['sun', 'jupiter', 'saturn', 'earth', 'uranus', 'neptune', 'venus', 'mars', 'mercury',
  ...MOONS.slice().sort((a, b) => b.radius - a.radius).map(m => m.key)];
// 위성 이름표는 행성에서 화면으로 이만큼(px) 떨어져 보일 때만 — 멀리서 보면 행성 이름표에 겹쳐 묻힌다
const MOON_SEP_PX = 28;
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
// 천체의 화면 위치 — 앞뒤는 카메라 좌표로 판정한다(먼 천체는 투영 z가 반올림돼 1이 되므로 z<1로는 못 가린다)
function project(b) {
  tmp.copy(b.mesh.position);
  const dist = tmp.distanceTo(camera.position);
  tmp.applyMatrix4(camera.matrixWorldInverse);
  const front = tmp.z < 0;
  tmp.applyMatrix4(camera.projectionMatrix);
  return { x: (tmp.x + 1) / 2 * innerWidth, y: (1 - tmp.y) / 2 * innerHeight, ndcX: tmp.x, front, dist };
}
function updateLabels() {
  const W = innerWidth, H = innerHeight;
  const ppr = pxPerRad();
  const placed = [];
  const order = [state.focus, ...PRIORITY.filter(k => k !== state.focus)];
  const scr = {};
  for (const b of bodies) scr[b.key] = project(b);
  for (const key of order) {
    const b = byKey[key];
    const { x, y, ndcX, front, dist } = scr[key];
    // 조작부에 가린 아래쪽(viewH 밑)은 보이지 않는 것으로 친다
    const visible = front && Math.abs(ndcX) < 1.02 && y > -0.01 * H && y < viewH + 0.01 * H;
    const pr = (b.radius / dist) * ppr;
    b.pixelRadius = pr;
    // 겹침은 이름이 실제로 놓일 상자로 본다 — 큰 천체는 이름이 원판 위로 떨어져 있어 중심끼리 재면 못 잡는다
    const nameW = b.nameW || b.name.length * 15; // 숨어 있던 이름표는 너비를 잴 수 없어 어림한다
    const ringD = pr < 6 ? 14 : 0;
    const off = Math.max(ringD / 2, pr) + 6;
    const flip = ringD && x + off + nameW > W - 4; // 오른쪽 끝에서 잘리면 이름을 동그라미 왼쪽에 둔다
    const box = !ringD ? [x - nameW / 2, y - off - 18, x + nameW / 2, y - off]
      : flip ? [x - off - nameW, y - 9, x + 7, y + 9] : [x - 7, y - 9, x + off + nameW, y + 9];
    const clash = placed.some(q => box[0] < q[2] + 4 && q[0] < box[2] + 4 && box[1] < q[3] + 4 && q[1] < box[3] + 4);
    const p = b.parent && scr[b.parent];
    const huddled = p && p.front && key !== state.focus && Math.hypot(p.x - x, p.y - y) < MOON_SEP_PX;
    if (!visible || clash || huddled || dist < b.radius) { b.label.style.display = 'none'; continue; }
    placed.push(box);
    b.label.style.display = '';
    b.label.style.transform = `translate(${x}px, ${y}px)`;
    b.ring.style.width = b.ring.style.height = ringD + 'px';
    b.ring.style.display = ringD ? '' : 'none';
    b.nameW ||= b.nameEl.offsetWidth;
    b.nameEl.style.transform = !ringD ? `translate(-50%, ${-off - 18}px)`
      : flip ? `translate(calc(-100% - ${off}px), -50%)` : `translate(${off}px, -50%)`;
  }
}

// ---------- 화면 조작부 ----------
const bodiesNav = document.getElementById('bodies');
const moonsNav = document.getElementById('moons');
const navButtons = {};
for (const b of bodies) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = b.name;
  btn.addEventListener('click', () => flyTo(b.key));
  (b.parent ? moonsNav : bodiesNav).appendChild(btn);
  navButtons[b.key] = btn;
}
const overviewBtn = document.createElement('button');
overviewBtn.type = 'button';
overviewBtn.textContent = '전체';
const OVERVIEW_DIR = new THREE.Vector3(0, Math.sin(OVERVIEW_TILT), Math.cos(OVERVIEW_TILT));
overviewBtn.addEventListener('click', () => flyTo('sun', { dist: overviewDist, dir: OVERVIEW_DIR }));
bodiesNav.appendChild(overviewBtn);

// 위성 줄: 위성이 있는 행성이나 그 위성에 가 있을 때 그 계의 위성만 보인다
function markFocus() {
  const f = byKey[state.focus], system = f.parent ?? f.key;
  let any = false;
  for (const b of bodies) {
    navButtons[b.key].setAttribute('aria-pressed', String(b.key === state.focus));
    b.label.classList.toggle('focus', b.key === state.focus);
    if (b.parent) { const show = b.parent === system; navButtons[b.key].hidden = !show; any ||= show; }
  }
  moonsNav.hidden = !any;
}

// 대기 켜기·끄기 — 표면이 대기에 가려진 천체에 다가가 있을 때만 단추를 보인다
const atmoBtn = document.getElementById('atmo');
const surfaceTex = {}; // key → Promise<Texture>
function applyAtmosphere() {
  atmoBtn.textContent = state.atmosphere ? '대기 끄기' : '대기 켜기';
  atmoBtn.setAttribute('aria-pressed', String(!state.atmosphere));
  for (const [key, url] of Object.entries(SURFACE_UNDER)) {
    const b = byKey[key];
    if (state.atmosphere) { setMap(b.mesh.material, null, b.color); continue; }
    // 받는 동안에는 대기 색을 그대로 둔다(빈 질감을 넣으면 까맣게 된다)
    (surfaceTex[key] ||= loadTexture(url)).then(tex => {
      if (!state.atmosphere) setMap(b.mesh.material, tex);
    }, () => {
      delete surfaceTex[key];
      console.warn(`표면 지도를 못 불러옴: ${url} — 대기를 다시 켠다`);
      state.atmosphere = true; applyAtmosphere(); // 단추와 화면이 어긋나지 않게
    });
  }
}
atmoBtn.addEventListener('click', () => { state.atmosphere = !state.atmosphere; applyAtmosphere(); updateAtmoButton(); });
// 표면이 가려진 천체에 다가가 있을 때 단추를 보인다. 대기를 끈 채로 떠나면 다시 켤 수 있게 계속 보인다
function updateAtmoButton() {
  atmoBtn.hidden = !!state.fly || (state.atmosphere && !(state.focus in SURFACE_UNDER));
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
  const dt = THREE.MathUtils.clamp((now - lastT) / 1000, 0, 0.25); // 그림 틀 시각이 앞설 수 있어 음수를 막는다
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
      // 행성이 화면에서 커지면 궤도선이 행성을 뚫고 지나가 보이므로 흐리게 한다
      const pr = (b.radius / b.mesh.position.distanceTo(camera.position)) * ppr;
      let op = THREE.MathUtils.clamp(1 - (pr - 3) / 25, 0, 1);
      if (b.parent) {
        // 위성 궤도가 화면에서 행성 둘레의 작은 얼룩일 때는 감춘다(궤도 반지름 12→30px에서 나타남)
        const P = byKey[b.parent];
        const orbitPx = Math.hypot(...b.pos.map((v, i) => v - P.pos[i])) / P.mesh.position.distanceTo(camera.position) * ppr;
        op *= THREE.MathUtils.clamp((orbitPx - 12) / 18, 0, 1) * 0.7;
      }
      b.trail.material.opacity = op;
      b.trail.visible = b.trail.material.opacity > 0.01;
      if (b.trail.visible) updateTrail(b, jd); // 안 보이는 궤도선은 다시 계산하지 않는다
      b.trail.position.copy(b.mesh.position);
    }
  }
  if (!state.fly) controls.update();
  else camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  updateRings(); // 이번 장면의 카메라 위치로(고리 앞·뒷면 판정)
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
new ResizeObserver(resize).observe(panelEl); // 글꼴·안전 영역이 늦게 잡혀 조작부 높이가 바뀌는 경우
resize();
// 글꼴이 늦게 뜨면 이름 너비가 달라지므로 다시 잰다
document.fonts?.ready.then(() => { for (const b of bodies) b.nameW = 0; });

// 처음 화면: 태양계 전체
camera.position.copy(OVERVIEW_DIR).multiplyScalar(overviewDist());
controls.minDistance = byKey.sun.radius * 1.15;
updatePositions(julianDateTT(state.simMs));
markFocus();
applyAtmosphere();

renderer.setAnimationLoop(t => { step(t); draw(); });

// 자동 확인용(백그라운드 탭에서는 requestAnimationFrame이 돌지 않는다)
window.__app = { state, step, draw, flyTo, camera, bodies: byKey, RATES, applyAtmosphere };
