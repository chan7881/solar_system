// 화면 — 크기·거리 모두 실제 비율(km). 초점 천체를 원점에 두고 그린다(위치 계산은 JS 배정밀도, 그리기 직전에 뺀다).
import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { AU_KM, BODIES, VALID_FROM, VALID_TO, heliocentric, orbitTrail, julianDateTT, eclipticToScene, bodyAxes, ellipsoidRadius, hasRotation, raDecToScene } from './ephemeris.js';
import { RING_EDGES, RING_ALBEDO, ringMipLevels } from './rings.js';
import { MOONS, systemOffsets, moonTrailCache } from './moons.js';
import { RATES, REALTIME, clampRate, rateText, advanceMs, navGroups, systemOf, LAYERS, defaultLayers, bodyShown, GROUP_LAYER } from './nav.js';
import { SHAPED, SHAPE_REACH, parseShape } from './shapes.js';
import { DWARFS, COMETS, SMALL_BODIES, isSmallBody, smallBodyHelio, smallBodyTrail, parsePoints, pointPositions, oortCloud, OORT, groupAnchors } from './smallbodies.js';

const TRAIL_N = 360;
const ORBIT_OPACITY = 0.3; // 궤도(한 바퀴 고른 선)의 밝기 — 궤적(꼬리)보다 흐리게
const FOV = 45;

// ---------- 장면 ----------
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
// 먼 면은 평소 2e11km(약 1,300AU) — 오르트 구름이 보일 만큼 물러날 때만 늘린다(로그 깊이의 가까운 쪽 정밀도를 아끼려고, updateClouds)
const FAR_NEAR = 2e11;
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, FAR_NEAR);
const controls = new OrbitControls(camera, canvas);
controls.enablePan = false;
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.zoomSpeed = 1.2;
controls.rotateSpeed = 0.6;
controls.maxDistance = 400000 * AU_KM;

const sunLight = new THREE.PointLight(0xffffff, 3, 0, 0);
scene.add(sunLight);
scene.add(new THREE.AmbientLight(0xffffff, 0.04));

// 표면 지도(단순 원통 도법, 가운데 = 경도 0°, 동경+) — 출처는 textures/출처.md. 없는 천체는 단색.
const TEXTURED = new Set(['mercury', 'earth', 'mars', 'jupiter', 'saturn', 'moon', 'pluto', 'charon']);
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
// 타이탄: Cassini ISS 근적외선(938nm) 모자이크(흑백 — 연무를 뚫는 파장으로 본 밝기, 눈으로 보는 색이 아니다)
const SURFACE_UNDER = { venus: 'textures/venus_surface_2k.jpg', titan: 'textures/titan_surface_2k.jpg' };

// 위성은 구(평균 반지름)로 그린다 — 자세 모형(hasRotation)이 있는 것만 돌린다(달·타이탄·포보스·데이모스·카론). 나머지는 단색이라 돌려도 보이지 않는다
// 포보스·데이모스는 모양 모형(SHAPED, textures/<이름>_shape.bin)을 받으면 구를 그것으로 바꾼다 — 못 받으면 구로 둔다
function loadShape(b) {
  fetch(`textures/${b.key}_shape.bin`).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then(buf => {
    const { positions, index } = parseShape(buf);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    b.mesh.geometry.dispose();
    b.mesh.geometry = geo;
  }).catch(e => console.warn(`모양 모형을 못 불러옴: ${b.key} (${e}) — 구로 둔다`));
}
const ALL = [...BODIES, ...MOONS, ...SMALL_BODIES];
const bodies = ALL.map(b => {
  const fine = TEXTURED.has(b.key) || b.key in SURFACE_UNDER;
  // 하우메아는 3축 타원체(자세 모형이 없어 긴 축을 황도면에 눕혀 둔다 — 돌리지 않는다)
  const geo = b.abc ? new THREE.SphereGeometry(1, 48, 24).scale(b.abc[0], b.abc[2], b.abc[1])
    : b.parent ? new THREE.SphereGeometry(b.radius, ...(fine ? [96, 48] : [48, 24])) : ellipsoidGeometry(b.re, b.rp);
  const mat = b.key === 'sun'
    ? new THREE.MeshBasicMaterial({ color: b.color })
    : new THREE.MeshStandardMaterial({ color: b.color, roughness: 1, metalness: 0 });
  if (TEXTURED.has(b.key)) loadSurface(b.key, mat);
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  let trail = null, orbitLine = null;
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
    trail.renderOrder = 2; // 점 무리(0)보다 나중에 그려 궤도선이 점에 묻히지 않게
    scene.add(trail);
    // 궤도: 같은 점을 한 바퀴 고른 밝기로(궤적은 천체 뒤로 흐려지는 꼬리)
    orbitLine = new THREE.Line(g, new THREE.LineBasicMaterial({ color: c, transparent: true, depthWrite: false }));
    orbitLine.frustumCulled = false;
    orbitLine.renderOrder = 2;
    scene.add(orbitLine);
  }
  // 위치·궤도선 함수 — 행성(Standish)과 소천체(Horizons 요소)를 여기서 한 번 고른다(위성은 moons.js)
  const small = isSmallBody(b.key);
  return { ...b, reach: SHAPE_REACH[b.key] ?? b.reach ?? b.radius, mesh, trail, orbitLine,
    helio: small ? smallBodyHelio : heliocentric, orbit: small ? smallBodyTrail : orbitTrail, pos: [0, 0, 0], trailJd: NaN, moonTrail: b.parent ? moonTrailCache(b.key, TRAIL_N) : null };
});
const byKey = Object.fromEntries(bodies.map(b => [b.key, b]));
for (const k of SHAPED) loadShape(byKey[k]);

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
  paused: false,
  atEdge: false, // 계산 범위 끝에 닿아 멈췄음(빠르기를 바꾸면 풀림)
  focus: 'sun',
  view: null, // 사이드바의 「전체 보기」 중 고른 것(태양 중심 보기) — 다른 곳으로 가면 null
  layers: defaultLayers(),
  fly: null, // { from, to, t0, dur, d0, d1, bump, dir0, dir1 }
};

// ---------- 위치 ----------
const basis = new THREE.Matrix4(), vx = new THREE.Vector3(), vy = new THREE.Vector3(), vz = new THREE.Vector3();
// 위성이 있는 행성·왜행성: 궤도 요소가 주는 점은 계 질량중심 → 몸체 중심은 위성 질량만큼 반대로 옮긴다(지구 약 4700km·명왕성 약 2100km)
// ⚠️ 위성을 넣는 천체는 요소도 질량중심으로 받아야 한다(tools/fetch_smallbodies.py TARGETS — 명왕성은 '9'). 몸체 요소에 이 보정을 더하면 두 번 옮긴다.
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
    const h = b.helio(b.key, jd).map(v => v * AU_KM), o = sys[b.key]?.planet ?? [0, 0, 0];
    b.pos = eclipticToScene([h[0] + o[0], h[1] + o[1], h[2] + o[2]]);
    if (hasRotation(b.key)) orient(b, jd); // 에리스·하우메아·마케마케·혜성은 자세 모형이 없다
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
  const pts = b.parent ? b.moonTrail(jd) : b.orbit(b.key, jd, TRAIL_N);
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
// 무대(사이드바에 밀린 나머지) 크기와 그중 보이는 영역(조작부 위)의 높이 · 세로·가로 반화각
let stageW = innerWidth, stageH = innerHeight, viewH = innerHeight;
const halfV = () => (FOV / 2) * Math.PI / 180;
const halfH = (w = stageW) => Math.atan(Math.tan(halfV()) * w / viewH);
const pxPerRad = () => (viewH / 2) / Math.tan(halfV());
// 천체가 좁은 쪽 화면의 약 60%를 차지하는 거리
const viewDist = (b, w) => b.reach / Math.sin(Math.min(halfV(), halfH(w)) * 0.6);
// 전체 보기: 반지름 rAU의 원반(태양계 전체는 해왕성 궤도 약 30AU → 33AU)이 기울여 본 화면에 들어오는 거리
const OVERVIEW_TILT = 55 * Math.PI / 180;
const overviewFit = rAU => w => Math.max(rAU * AU_KM / Math.tan(halfH(w)), rAU * AU_KM * Math.sin(OVERVIEW_TILT) * 1.3 / Math.tan(halfV())); // 세로는 가까운 쪽이 원근으로 커져서 여유 1.3배
const overviewDist = overviewFit(33);

// 날아가기 3단계 — ① 두 천체가 함께 보일 만큼 물러나고 ② 옆으로 옮겨 가고 ③ 다가간다.
// 단계마다 걸리는 시간은 거리 배율(로그)에 비례한다. 이미 충분히 멀면 ①은 0초.
function flyTo(key, opts = {}) {
  // 날아가는 중에 누르면 도착한 뒤에 이어서 간다(중간 위치에서 튀지 않게)
  if (state.fly) { state.fly.next = key === state.fly.to && !opts.view ? null : { key, opts }; return; }
  // 손으로 돌리다 남은 관성을 먼저 털어 낸다 — 남겨 두면 도착한 뒤에 화면이 저절로 돈다
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = damping;
  const from = state.focus;
  state.focus = key;
  state.view = opts.view ?? null;
  markFocus();
  // 사이드바를 여닫는 중이면 무대 폭이 바뀌는 중이다 — 거리는 전환이 끝난 뒤의 폭으로 잰다
  const fw = finalStageW();
  const d0 = camera.position.length();
  const d1 = opts.dist?.(fw) ?? viewDist(byKey[key], fw);
  const gap = Math.hypot(...byKey[key].pos.map((v, i) => v - byKey[from].pos[i]));
  const D = Math.max(d0, d1, (gap / Math.tan(Math.min(halfV(), halfH(fw)))) * 1.3);
  const w = [Math.log(D / d0), gap > 0 ? 2 : 0, Math.log(D / d1)];
  const total = w[0] + w[1] + w[2] || 1;
  const dur = Math.min(3600, 900 + 260 * total);
  const dir0 = camera.position.clone().normalize();
  const dir1 = opts.dir ? opts.dir.clone().normalize() : dir0.clone();
  state.fly = { from, to: key, t0: performance.now(), dur, d0, d1, D, cut: [w[0] / total, (w[0] + w[1]) / total], dir0, dir1 };
  controls.enabled = false;
  updateAtmoButton();
  if (!state.atmosphere) applyAtmosphere(); // 대기를 끈 채로 왔으면 새 초점의 지도를 받기 시작
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
    controls.minDistance = byKey[state.focus].reach * 1.15;
    updateAtmoButton();
    if (f.next) flyTo(f.next.key, f.next.opts);
  }
  return [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m];
}

// ---------- 이름표 ----------
const labelLayer = document.getElementById('labels');
// 겹치면 앞쪽이 이긴다 — 행성 다음에 위성·왜행성·혜성(큰 것부터 — 혜성 핵은 맨 뒤)
const PRIORITY = ['sun', 'jupiter', 'saturn', 'earth', 'uranus', 'neptune', 'venus', 'mars', 'mercury',
  ...[...MOONS, ...DWARFS, ...COMETS].sort((a, b) => b.radius - a.radius).map(m => m.key)];
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
  return { x: (tmp.x + 1) / 2 * stageW, y: (1 - tmp.y) / 2 * stageH, ndcX: tmp.x, front, dist };
}
function updateLabels() {
  const W = stageW, H = stageH;
  const ppr = pxPerRad();
  const placed = [];
  const order = [state.focus, ...PRIORITY.filter(k => k !== state.focus)];
  const scr = {};
  for (const b of bodies) { scr[b.key] = project(b); scr[b.key].pr = (b.reach / scr[b.key].dist) * ppr; }
  // 더 가까운 천체의 원판 뒤에 숨은 천체 — 이름표가 원판 위에 떠 보이지 않게
  const discs = bodies.filter(b => b.mesh.visible && scr[b.key].front && scr[b.key].pr > 4);
  const behind = (b, x, y, dist) => discs.some(o => o !== b && scr[o.key].dist < dist && Math.hypot(scr[o.key].x - x, scr[o.key].y - y) < scr[o.key].pr);
  const L = state.layers;
  for (const key of order) {
    const b = byKey[key];
    // 레이어로 숨긴 천체, 이름표·아이콘을 둘 다 끈 경우는 표시하지 않는다
    if (!b.mesh.visible || (!L.labels && !L.icons)) { b.label.style.display = 'none'; continue; }
    const { x, y, ndcX, front, dist } = scr[key];
    // 조작부에 가린 아래쪽(viewH 밑)은 보이지 않는 것으로 친다
    const visible = front && Math.abs(ndcX) < 1.02 && y > -0.01 * H && y < viewH + 0.01 * H;
    const pr = scr[key].pr;
    b.pixelRadius = pr;
    // 겹침은 이름이 실제로 놓일 상자로 본다 — 큰 천체는 이름이 원판 위로 떨어져 있어 중심끼리 재면 못 잡는다
    const nameW = b.nameW || b.name.length * 15; // 숨어 있던 이름표는 너비를 잴 수 없어 어림한다
    const ringD = pr < 6 ? 14 : 0;
    const off = Math.max(ringD / 2, pr) + 6;
    const flip = ringD && x + off + nameW > W - 4; // 오른쪽 끝에서 잘리면 이름을 동그라미 왼쪽에 둔다
    const box = !L.labels ? [x - 7, y - 7, x + 7, y + 7] // 아이콘만
      : !ringD ? [x - nameW / 2, y - off - 18, x + nameW / 2, y - off]
      : flip ? [x - off - nameW, y - 9, x + 7, y + 9] : [x - 7, y - 9, x + off + nameW, y + 9];
    const clash = placed.some(q => box[0] < q[2] + 4 && q[0] < box[2] + 4 && box[1] < q[3] + 4 && q[1] < box[3] + 4);
    const p = b.parent && scr[b.parent];
    const huddled = p && p.front && key !== state.focus && Math.hypot(p.x - x, p.y - y) < MOON_SEP_PX;
    if (!visible || clash || huddled || dist < b.reach || behind(b, x, y, dist)) { b.label.style.display = 'none'; continue; }
    placed.push(box);
    b.label.style.display = '';
    b.label.style.transform = `translate(${x}px, ${y}px)`;
    b.ring.style.width = b.ring.style.height = ringD + 'px';
    b.ring.style.display = ringD && L.icons ? '' : 'none';
    b.nameEl.style.display = L.labels ? '' : 'none';
    if (L.labels) b.nameW ||= b.nameEl.offsetWidth;
    b.nameEl.style.transform = !ringD ? `translate(-50%, ${-off - 18}px)`
      : flip ? `translate(calc(-100% - ${off}px), -50%)` : `translate(${off}px, -50%)`;
  }
  return placed;
}

// ---------- 화면 조작부 ----------
// 사이드바 — 태양 · 행성(누르면 그 아래 위성이 펼쳐짐) · 기타. 넓은 화면은 무대를 밀어내고, 폰은 위에 덮는다
const stageEl = document.getElementById('stage');
const sbList = document.getElementById('sb-list');
const NARROW = matchMedia('(max-width: 759px)');
const navButtons = {}; // key → 목록 단추
const subs = {};       // 모천체 key → { tog, box }
const OVERVIEW_DIR = new THREE.Vector3(0, Math.sin(OVERVIEW_TILT), Math.cos(OVERVIEW_TILT));
const css = c => '#' + new THREE.Color(c).getHexString();

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function itemButton(b, onClick) {
  const btn = el('button', 'sb-item');
  btn.type = 'button';
  const sw = el('span', 'sw');
  sw.style.background = css(b.color);
  btn.append(sw, el('span', null, b.name));
  btn.addEventListener('click', onClick);
  return btn;
}
function choose(key, opts) {
  flyTo(key, opts);
  if (NARROW.matches) setSidebar(false); // 폰에서는 고르면 닫아 화면을 보이게
}
function setExpanded(key, open) {
  const s = subs[key];
  if (!s) return;
  s.tog.setAttribute('aria-expanded', String(open));
  s.box.hidden = !open;
}
function addEntry(parentEl, { body, moons }) {
  const row = el('div', 'sb-row');
  const btn = itemButton(body, () => choose(body.key));
  navButtons[body.key] = btn;
  row.appendChild(btn);
  parentEl.appendChild(row);
  if (!moons.length) return;
  const tog = el('button', 'sb-tog');
  tog.type = 'button';
  tog.setAttribute('aria-label', `${body.name}의 위성 ${moons.length}개 펼치기`);
  tog.innerHTML = `<span>위성 ${moons.length}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const box = el('div', 'sb-sub');
  box.id = `sub-${body.key}`;
  tog.setAttribute('aria-controls', box.id);
  for (const m of moons) {
    const mb = itemButton(m, () => choose(m.key));
    navButtons[m.key] = mb;
    box.appendChild(mb);
  }
  tog.addEventListener('click', () => setExpanded(body.key, box.hidden));
  row.appendChild(tog);
  parentEl.appendChild(box);
  subs[body.key] = { tog, box };
  setExpanded(body.key, false);
}

// ---------- 소천체 무리(점) ----------
// 소행성대·힐다·트로이·카이퍼대: JPL SBDB 궤도 요소(textures/small_bodies.bin) · 오르트 구름: 모형(src/smallbodies.js)
// 크기를 바꾸지 않는 점(화소 단위). 천체에 바짝 다가가면 별처럼 보여 헷갈리므로 흐리게 감춘다
// 점은 실제 크기가 아니라 화소 하나라 실제보다 빽빽해 보인다 → 반투명으로 두고, 궤도선(renderOrder 2)을 점 위에 그린다
// 색 구분(레이어 「무리별 색 구분」)을 끄면 모두 흰 점. 무리를 끄면 그 점의 알파를 0으로
const GROUP_COLORS = [0xd4d4d4, 0xe8a23c, 0x4fc95c, 0x8fb2e0]; // 소행성대 · 힐다 · 트로이 · 카이퍼대
const GROUP_NAMES = ['소행성대', '힐다', '트로이군', '카이퍼대'];
const OORT_COLOR = 0x7d8fb0;
const PLAIN = 0xffffff;
const CLOUD_ALPHA = 0.32, OORT_ALPHA = 0.5;
const cloudMat = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false });
const cloud = new THREE.Points(new THREE.BufferGeometry(), cloudMat);
cloud.frustumCulled = false;
cloud.visible = false;
scene.add(cloud);
const cloudState = { P: null, jd: NaN };
// 색·알파(무리 켜짐) — 레이어를 바꿀 때만 다시 넣는다
function paintCloud() {
  const P = cloudState.P;
  if (!P) return;
  const L = state.layers, attr = cloud.geometry.attributes.color, c = new THREE.Color();
  for (let k = 0; k < P.count; k++) {
    const g = P.group[k];
    c.set(L.groupColors ? GROUP_COLORS[g] : PLAIN);
    attr.array.set([c.r, c.g, c.b, L[GROUP_LAYER[g]] ? 1 : 0], k * 4);
  }
  attr.needsUpdate = true;
  oort.material.color.set(L.groupColors ? OORT_COLOR : PLAIN);
}
fetch('textures/small_bodies.bin').then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then(buf => {
  const P = parsePoints(buf);
  cloud.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P.count * 3), 3));
  cloud.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(P.count * 4), 4));
  cloudState.P = P;
  paintCloud();
}).catch(e => console.warn('소천체 무리를 못 불러옴 — 점 없이 둔다', e));
const OORT_N = 30000;
const oort = new THREE.Points(new THREE.BufferGeometry(),
  new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, color: PLAIN, transparent: true, depthWrite: false }));
{
  const p = oortCloud(OORT_N); // AU, 장면 좌표
  for (let i = 0; i < p.length; i++) p[i] *= AU_KM;
  oort.geometry.setAttribute('position', new THREE.BufferAttribute(p, 3));
}
oort.frustumCulled = false;
scene.add(oort);
// 위치는 태양 중심(km)으로 두고 물체째 태양 자리에 놓는다. 시각이 0.01일 넘게 바뀔 때만 다시 계산한다
function updateClouds(jd) {
  const sun = byKey.sun.mesh.position;
  const P = cloudState.P;
  if (P) {
    // 초점 천체 크기의 50배 안이면 감추고 500배 밖이면 다 보인다(로그로 이어짐)
    const op = THREE.MathUtils.clamp(Math.log10(camera.position.length() / (50 * byKey[state.focus].reach)), 0, 1);
    cloudMat.opacity = op * CLOUD_ALPHA;
    cloud.visible = op > 0.01 && (state.layers.belt || state.layers.kuiper);
    cloud.position.copy(sun);
    if (cloud.visible && !(Math.abs(jd - cloudState.jd) < 0.01)) { // 감춰져 있으면 계산하지 않는다
      const attr = cloud.geometry.attributes.position;
      pointPositions(P, jd, attr.array, AU_KM);
      attr.needsUpdate = true;
      const J = byKey.jupiter.mesh.position; // 이름표 자리(트로이 L4·L5·힐다)는 목성 황경 기준
      cloudState.anchors = groupAnchors(P, attr.array, Math.atan2(-(J.z - sun.z), J.x - sun.x));
      cloudState.jd = jd;
    }
  }
  // 오르트 구름은 태양에서 300AU 밖으로 물러나면 나타나 3,000AU에서 다 보인다
  const so = THREE.MathUtils.clamp(Math.log10(camera.position.distanceTo(sun) / (300 * AU_KM)), 0, 1);
  oort.material.opacity = so * OORT_ALPHA;
  oort.visible = so > 0.01 && state.layers.oort;
  oort.position.copy(sun);
  const far = oort.visible ? Math.max(FAR_NEAR, camera.position.distanceTo(sun) + 1.2 * OORT.rOut * AU_KM) : FAR_NEAR;
  if (far !== camera.far) { camera.far = far; camera.updateProjectionMatrix(); }
}
// ---------- 무리 이름표 ----------
// 누를 수 없는 이름. 천체 이름표가 먼저 자리를 잡고 겹치면 무리 이름을 숨긴다.
// 소행성대·카이퍼대는 고리 가장자리, 트로이·힐다는 무리 한가운데, 오르트 구름은 위쪽.
// 태양에서 화면으로 minPx 넘게 떨어져 보일 때만 — 멀리서 보면 무리가 태양 둘레에 뭉쳐 이름이 겹친다
const GROUP_TAGS = [
  { key: 'belt', name: '소행성대', g: 0, ring: 'beltR', minPx: 50 },
  { key: 'hilda', name: '힐다', g: 1, minPx: 110 },
  { key: 'L4', name: '트로이군', g: 2, minPx: 110 },
  { key: 'L5', name: '트로이군', g: 2, minPx: 110 },
  { key: 'kuiper', name: '카이퍼대', g: 3, ring: 'kuiperR', minPx: 60 },
  { key: 'oort', name: '오르트 구름', minPx: 0 },
];
for (const t of GROUP_TAGS) {
  t.el = el('div', 'glabel', t.name);
  t.el.style.display = 'none';
  labelLayer.prepend(t.el);
}
const gv = new THREE.Vector3(), gs = new THREE.Vector3();
function toScreen(v) {
  tmp.copy(v).applyMatrix4(camera.matrixWorldInverse);
  const front = tmp.z < 0;
  tmp.applyMatrix4(camera.projectionMatrix);
  return { x: (tmp.x + 1) / 2 * stageW, y: (1 - tmp.y) / 2 * stageH, front };
}
function updateGroupLabels(placed = []) {
  const L = state.layers, A = cloudState.anchors, sun = byKey.sun.mesh.position;
  const cloudOn = cloud.visible && cloudMat.opacity > 0.5 * CLOUD_ALPHA;
  const oortOn = oort.visible && oort.material.opacity > 0.6 * OORT_ALPHA;
  const s = toScreen(sun);
  for (const t of GROUP_TAGS) {
    const hide = () => { t.el.style.display = 'none'; };
    const isOort = t.key === 'oort';
    if (!L.labels || !(isOort ? oortOn && L.oort : cloudOn && A && L[GROUP_LAYER[t.g]])) { hide(); continue; }
    // 고리는 화면 아래 방향을 황도면에 눕힌 쪽(카메라 쪽 가장자리) 밑에, 거기가 화면 밖이면 맞은편 가장자리 위에
    const tries = t.ring ? [-1, 1] : [0];
    let box = null, p;
    for (const side of tries) {
      if (isOort) gv.set(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(0.45 * OORT.rOut * AU_KM);
      else if (t.ring) {
        gs.set(0, side, 0).applyQuaternion(camera.quaternion).setY(0);
        if (gs.lengthSq() < 1e-12) gs.set(0, 0, -side);
        gv.copy(gs.normalize()).multiplyScalar(A[t.ring] * AU_KM);
      } else if (A[t.key]) gv.fromArray(A[t.key]);
      else break;
      p = toScreen(gv.add(sun));
      const hw = t.name.length * 7, top = side < 0 ? p.y + 4 : side > 0 ? p.y - 22 : p.y - 9;
      const b = [p.x - hw, top, p.x + hw, top + 18];
      if (p.front && b[0] > 2 && b[2] < stageW - 2 && b[1] > 0 && b[3] < viewH) { box = b; break; } // 다 들어올 때만
    }
    if (!box) { hide(); continue; }
    const near = s.front && Math.hypot(p.x - s.x, p.y - s.y) < t.minPx;
    const clash = placed.some(q => box[0] < q[2] + 4 && q[0] < box[2] + 4 && box[1] < q[3] + 4 && q[1] < box[3] + 4);
    if (near || clash) { hide(); continue; }
    placed.push(box);
    t.el.style.display = '';
    t.el.style.color = L.groupColors ? '#' + new THREE.Color(isOort ? OORT_COLOR : GROUP_COLORS[t.g]).getHexString() : '';
    t.el.style.transform = `translate(${p.x}px, ${box[1]}px) translateX(-50%)`;
  }
  return placed;
}
// ---------- 별자리(레이어, 처음엔 꺼짐) ----------
// 선과 이름은 d3-celestial(J2000 적경·적위) — tools/make_constellations.py. 별은 그리지 않는다(별 배경을 두지 않기로 함).
// 무한히 먼 방향이므로 카메라를 중심으로 한 구에 붙여 카메라와 함께 옮긴다. 불투명 물체 중 맨 먼저, 깊이 검사 없이 그려
// 천체(나중에 그림)가 늘 그 위를 덮는다
const SKY_R = 1e6;
const skyLines = new THREE.LineSegments(new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0x34496b, depthTest: false, depthWrite: false }));
skyLines.renderOrder = -1;
skyLines.frustumCulled = false;
skyLines.visible = false;
scene.add(skyLines);
const skyNames = []; // { el, dir }
fetch('textures/constellations.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(({ lines, names }) => {
  const seg = [];
  for (const ln of lines) for (let i = 2; i < ln.length; i += 2) {
    seg.push(...raDecToScene(ln[i - 2], ln[i - 1]), ...raDecToScene(ln[i], ln[i + 1]));
  }
  skyLines.geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(seg, v => v * SKY_R), 3));
  for (const [name, ra, dec] of names) {
    const e = el('div', 'cname', name);
    e.style.display = 'none';
    labelLayer.prepend(e); // 천체 이름표가 위에 오게
    skyNames.push({ el: e, dir: new THREE.Vector3(...raDecToScene(ra, dec)) });
  }
}).catch(e => console.warn('별자리를 못 불러옴', e));
// placed: 천체 이름표 상자들 — 겹치는 별자리 이름은 숨긴다(천체 이름이 먼저)
function updateSky(placed = []) {
  const on = state.layers.constellations;
  skyLines.visible = on;
  skyLines.position.copy(camera.position);
  for (const n of skyNames) {
    if (!on) { n.el.style.display = 'none'; continue; }
    tmp.copy(n.dir).transformDirection(camera.matrixWorldInverse); // 카메라 좌표의 방향
    if (tmp.z >= 0) { n.el.style.display = 'none'; continue; }
    tmp.applyMatrix4(camera.projectionMatrix);
    const x = (tmp.x + 1) / 2 * stageW, y = (1 - tmp.y) / 2 * stageH;
    const hw = n.el.textContent.length * 6.5;
    const clash = placed.some(q => x - hw < q[2] && q[0] < x + hw && y - 9 < q[3] && q[1] < y + 9);
    if (clash || Math.abs(tmp.x) > 1.05 || y < 0 || y > viewH) { n.el.style.display = 'none'; continue; }
    placed.push([x - hw, y - 9, x + hw, y + 9]);
    n.el.style.display = '';
    n.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  }
}

// 사이드바 「전체 보기」 — 모두 태양을 가운데 두고 태양계 전체와 같은 기울기로, 거리만 그 무리가 화면에 차게
// 오르트 구름은 공 모양이라 기울기와 상관없이 바깥 반지름이 들어오는 거리
const fitSphere = rAU => w => rAU * AU_KM / Math.sin(Math.min(halfV(), halfH(w)));
const VIEWS = [
  { key: 'all', name: '태양계 전체', dist: overviewDist },
  { key: 'belt', name: '소행성대', layer: 'belt', dist: overviewFit(5.6) },
  { key: 'kuiper', name: '카이퍼대', layer: 'kuiper', dist: overviewFit(55) },
  { key: 'oort', name: '오르트 구름', layer: 'oort', dist: fitSphere(OORT.rOut * 1.05) },
];
const viewButtons = {};
function chooseView(v) {
  // 그 무리를 꺼 두었으면 켠다 — 안 켜면 빈 화면으로 날아간다
  if (v.layer && !state.layers[v.layer]) setLayer(v.layer, true);
  choose('sun', { dist: v.dist, dir: OVERVIEW_DIR, view: v.key });
}

{
  const g = navGroups(bodies);
  sbList.appendChild(el('div', 'sb-sec', '전체 보기'));
  for (const v of VIEWS) {
    const btn = itemButton({ name: v.name, color: 0x445066 }, () => chooseView(v));
    btn.querySelector('.sw').style.borderRadius = '2px';
    viewButtons[v.key] = btn;
    sbList.appendChild(btn);
  }
  sbList.appendChild(el('div', 'sb-sec', '태양'));
  if (g.sun) addEntry(sbList, { body: g.sun, moons: [] });
  sbList.appendChild(el('div', 'sb-sec', '행성'));
  for (const e of g.planets) addEntry(sbList, e);
  sbList.appendChild(el('div', 'sb-sec', '왜행성'));
  for (const e of g.dwarfs) addEntry(sbList, e);
  sbList.appendChild(el('div', 'sb-sec', '혜성'));
  for (const e of g.comets) addEntry(sbList, e);
  if (g.other.length) { // 행성·위성이 아닌 천체가 생기면 「기타」로 모은다
    sbList.appendChild(el('div', 'sb-sec', '기타'));
    for (const e of g.other) addEntry(sbList, e);
  }
}

const sidebarEl = document.getElementById('sidebar');
function setSidebar(open) {
  document.body.classList.toggle('sb-open', open);
  if (open && NARROW.matches) document.body.classList.remove('ly-open'); // 폰에서는 한쪽만 연다
  document.getElementById('sb-open').setAttribute('aria-expanded', String(open));
}
// 전환이 끝난 뒤의 무대 폭 — 넓은 화면에서 열려 있으면 사이드바 폭만큼 밀린다
const finalStageW = () => {
  const wide = !NARROW.matches, cl = document.body.classList;
  return innerWidth - (wide && cl.contains('sb-open') && !cl.contains('ui-off') ? sidebarEl.offsetWidth : 0)
    - (wide && cl.contains('ly-open') ? document.getElementById('layers').offsetWidth : 0);
};
document.getElementById('sb-close').addEventListener('click', () => setSidebar(false));
document.getElementById('sb-open').addEventListener('click', () => setSidebar(true));
// 폰에서 열린 목록 바깥은 덮개가 받는다 — 누르면 닫기만 하고 아래의 이름표·단추는 눌리지 않는다
document.getElementById('scrim').addEventListener('click', () => { setSidebar(false); setLayerPanel(false); });
// 처음 상태는 index.html 첫머리 스크립트가 정한다(그리기 전에). 폭이 760px를 넘나들면 그 폭의 기본 상태로
NARROW.addEventListener('change', () => setSidebar(!NARROW.matches));
setSidebar(document.body.classList.contains('sb-open'));

// 보는 천체 표시 — 그 천체가 속한 계를 펼친다(다른 계는 사용자가 연 그대로 둔다)
function markFocus() {
  // 「전체 보기」로 왔으면 태양 대신 그 보기 단추에 표시한다
  for (const [k, btn] of Object.entries(viewButtons)) btn.setAttribute('aria-current', String(k === state.view));
  for (const b of bodies) {
    navButtons[b.key]?.setAttribute('aria-current', String(b.key === state.focus && !state.view));
    b.label.classList.toggle('focus', b.key === state.focus);
  }
  const sys = systemOf(bodies, state.focus);
  if (sys) setExpanded(sys, true);
}

// 대기 켜기·끄기 — 표면이 대기에 가려진 천체에 다가가 있을 때만 단추를 보인다
const atmoBtn = document.getElementById('atmo');
const atmoStateEl = document.getElementById('atmo-state');
const surfaceTex = {}; // key → Promise<Texture>
function applyAtmosphere() {
  atmoBtn.setAttribute('aria-checked', String(state.atmosphere));
  atmoStateEl.textContent = state.atmosphere ? '켬' : '끔';
  for (const [key, url] of Object.entries(SURFACE_UNDER)) {
    const b = byKey[key];
    if (state.atmosphere) { setMap(b.mesh.material, null, b.color); continue; }
    // 지도는 그 천체에 갈 때 처음 받는다(한 곳에서 끄면 다른 천체 지도까지 받지 않게) — 날아가기를 시작할 때 다시 부른다
    if (key !== state.focus && !surfaceTex[key]) continue;
    // 받는 동안에는 대기 색을 그대로 둔다(빈 질감을 넣으면 까맣게 된다)
    (surfaceTex[key] ||= loadTexture(url)).then(tex => {
      if (!state.atmosphere) setMap(b.mesh.material, tex);
    }, () => {
      delete surfaceTex[key];
      console.warn(`표면 지도를 못 불러옴: ${url}`);
      // 보고 있는 천체가 실패했으면 대기를 다시 켠다(단추와 화면이 어긋나지 않게). 이미 떠났으면 대기 색 그대로 둔다
      if (key === state.focus && !state.atmosphere) { state.atmosphere = true; applyAtmosphere(); updateAtmoButton(); }
    });
  }
}
atmoBtn.addEventListener('click', () => { state.atmosphere = !state.atmosphere; applyAtmosphere(); updateAtmoButton(); });
// 표면이 가려진 천체에 다가가 있을 때 단추를 보인다. 대기를 끈 채로 떠나면 다시 켤 수 있게 계속 보인다
function updateAtmoButton() {
  atmoBtn.hidden = !!state.fly || (state.atmosphere && !(state.focus in SURFACE_UNDER));
}

// ---------- 레이어 창(오른쪽) ----------
const lyList = document.getElementById('ly-list');
const layerButtons = {};
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LAYER_NAME = Object.fromEntries(LAYERS.map(l => [l.key, l.name]));
function layerItem(key, sw = false) {
  const b = el('button', 'ly-item');
  b.type = 'button';
  b.setAttribute('role', sw ? 'switch' : 'checkbox');
  b.innerHTML = sw ? `<span>${LAYER_NAME[key]}</span><span class="sw-track" aria-hidden="true"><span class="sw-knob"></span></span><span class="sw-state"></span>`
    : `<span class="ly-box">${CHECK}</span><span>${LAYER_NAME[key]}</span>`;
  b.addEventListener('click', () => setLayer(key, !state.layers[key]));
  layerButtons[key] = b;
  return b;
}
const legend = el('div', 'legend');
legend.innerHTML = [...GROUP_NAMES.map((n, i) => [n, GROUP_COLORS[i]]), ['오르트 구름', OORT_COLOR]]
  .map(([n, c]) => `<span><i style="background:${css(c)}"></i>${n}</span>`).join('');
{
  const sec = t => lyList.appendChild(el('div', 'sb-sec', t));
  lyList.appendChild(layerItem('ui'));
  sec('천체');
  for (const k of ['planets', 'dwarfs', 'comets']) lyList.appendChild(layerItem(k));
  sec('소천체 무리');
  for (const k of ['belt', 'kuiper', 'oort']) lyList.appendChild(layerItem(k));
  lyList.append(layerItem('groupColors', true), legend); // 무리 전체(소행성대~오르트 구름)에 걸리는 색 구분
  sec('표시');
  for (const k of ['trails', 'orbits', 'labels', 'icons', 'constellations']) lyList.appendChild(layerItem(k));
}
function setLayers(patch) {
  Object.assign(state.layers, patch);
  const L = state.layers;
  for (const [k, b] of Object.entries(layerButtons)) {
    b.setAttribute('aria-checked', String(L[k]));
    const st = b.querySelector('.sw-state');
    if (st) st.textContent = L[k] ? '켬' : '끔';
  }
  legend.hidden = !L.groupColors;
  document.body.classList.toggle('ui-off', !L.ui);
  paintCloud();
}
const setLayer = (key, on) => setLayers({ [key]: on });
setLayers({});

const lyOpenBtn = document.getElementById('ly-open');
function setLayerPanel(open) {
  document.body.classList.toggle('ly-open', open);
  lyOpenBtn.setAttribute('aria-expanded', String(open));
  if (open && NARROW.matches) setSidebar(false); // 폰에서는 한쪽만 연다
}
lyOpenBtn.addEventListener('click', () => setLayerPanel(!document.body.classList.contains('ly-open')));
document.getElementById('ly-close').addEventListener('click', () => setLayerPanel(false));

const liveBtn = document.getElementById('live');
const pauseBtn = document.getElementById('pause');
const rateInput = document.getElementById('rate');
const whenInput = document.getElementById('when');
const dateEl = document.getElementById('date');
const rateEl = document.getElementById('rate-text');
rateInput.max = String(RATES.length - 1);
rateInput.value = String(state.rateIdx);
const pad = n => String(n).padStart(2, '0');
const toLocalInput = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
whenInput.min = toLocalInput(VALID_FROM);
whenInput.max = toLocalInput(VALID_TO);

// 빠르기를 바꾸면 멈춤은 풀리고, 실제 빠르기가 아니면 실시간에서 벗어난다
function setRate(i) {
  state.rateIdx = clampRate(i);
  rateInput.value = String(state.rateIdx);
  state.paused = false; state.atEdge = false;
  if (state.rateIdx !== REALTIME) state.live = false;
}
liveBtn.addEventListener('click', () => {
  state.simMs = Date.now(); setRate(REALTIME); state.live = true;
});
pauseBtn.addEventListener('click', () => {
  state.paused = !state.paused; state.atEdge = false;
  if (state.paused) state.live = false; // 멈추면 그 시각에 머문다
});
document.getElementById('slower').addEventListener('click', () => setRate(state.rateIdx - 1));
document.getElementById('faster').addEventListener('click', () => setRate(state.rateIdx + 1));
rateInput.addEventListener('input', () => setRate(+rateInput.value));
whenInput.addEventListener('click', () => { try { whenInput.showPicker(); } catch { /* 폰은 눌러서 바로 뜬다 */ } });
whenInput.addEventListener('change', () => {
  const ms = new Date(whenInput.value).getTime();
  if (Number.isFinite(ms)) { state.simMs = Math.min(VALID_TO, Math.max(VALID_FROM, ms)); state.live = false; state.atEdge = false; }
});

const dateFmt = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
let lastWhen = '';
function updateClock() {
  dateEl.textContent = dateFmt.format(state.simMs);
  rateEl.textContent = state.atEdge ? '멈춤 · 1800~2050년 끝' : rateText(state);
  rateEl.classList.toggle('live', state.live);
  rateInput.classList.toggle('real', state.rateIdx === REALTIME);
  liveBtn.setAttribute('aria-pressed', String(state.live));
  pauseBtn.setAttribute('aria-pressed', String(state.paused));
  const pl = state.paused ? '다시 흐르게' : '멈춤';
  if (pauseBtn.getAttribute('aria-label') !== pl) { pauseBtn.setAttribute('aria-label', pl); pauseBtn.title = pl; }
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
  else state.simMs += advanceMs(state, dt);
  if (state.simMs < VALID_FROM || state.simMs > VALID_TO) { // 계산 범위(1800~2050)를 넘어가려 하면 끝에서 멈춘다
    state.simMs = Math.min(VALID_TO, Math.max(VALID_FROM, state.simMs));
    state.paused = true; state.live = false; state.atEdge = true;
  }
  const jd = julianDateTT(state.simMs);
  updatePositions(jd);
  const fp = focusPosition(now);
  const ppr = pxPerRad();
  const L = state.layers;
  for (const b of bodies) {
    const rel = [b.pos[0] - fp[0], b.pos[1] - fp[1], b.pos[2] - fp[2]];
    b.mesh.position.set(rel[0], rel[1], rel[2]);
    if (b.key === 'sun') sunLight.position.copy(b.mesh.position);
    // 날아가는 동안에는 출발한 천체도 남긴다(레이어를 끈 천체에서 떠날 때 갑자기 사라지지 않게)
    b.mesh.visible = bodyShown(bodies, b.key, L, state.focus) || b.key === state.fly?.from;
    if (b.trail) {
      // 행성이 화면에서 커지면 궤도선이 행성을 뚫고 지나가 보이므로 흐리게 한다
      const pr = (b.reach / b.mesh.position.distanceTo(camera.position)) * ppr;
      let op = THREE.MathUtils.clamp(1 - (pr - 3) / 25, 0, 1);
      if (b.parent) {
        // 위성 궤도가 화면에서 행성 둘레의 작은 얼룩일 때는 감춘다(궤도 반지름 12→30px에서 나타남)
        const P = byKey[b.parent];
        const orbitPx = Math.hypot(...b.pos.map((v, i) => v - P.pos[i])) / P.mesh.position.distanceTo(camera.position) * ppr;
        op *= THREE.MathUtils.clamp((orbitPx - 12) / 18, 0, 1) * 0.7;
      }
      b.trail.material.opacity = op;
      b.orbitLine.material.opacity = op * ORBIT_OPACITY;
      b.trail.visible = b.mesh.visible && L.trails && op > 0.01;
      b.orbitLine.visible = b.mesh.visible && L.orbits && op > 0.01;
      if (b.trail.visible || b.orbitLine.visible) updateTrail(b, jd); // 안 보이는 궤도선은 다시 계산하지 않는다
      b.trail.position.copy(b.mesh.position);
      b.orbitLine.position.copy(b.mesh.position);
    }
  }
  if (!state.fly) controls.update();
  else camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  updateClouds(jd);
  updateRings(); // 이번 장면의 카메라 위치로(고리 앞·뒷면 판정)
  updateSky(updateGroupLabels(updateLabels()));
  updateClock();
}

function draw() { renderer.render(scene, camera); }

// 무대 크기에 맞추고, 화면 중심을 조작부 위 보이는 영역의 가운데로 옮긴다(세로 화각 45°도 그 영역 기준)
const panelEl = document.getElementById('panel');
function resize() {
  stageW = Math.max(1, stageEl.clientWidth); stageH = Math.max(1, stageEl.clientHeight);
  viewH = Math.max(100, stageH - panelEl.offsetHeight);
  stageEl.style.setProperty('--panel-h', panelEl.offsetHeight + 'px');
  renderer.setSize(stageW, stageH, false);
  camera.aspect = stageW / viewH;
  camera.setViewOffset(stageW, viewH, 0, 0, stageW, stageH);
  camera.updateProjectionMatrix();
}
// 창 크기·사이드바 밀어내기(0.25초 동안 폭이 바뀜)·조작부 높이가 늦게 잡히는 경우 모두 관찰자가 잡는다.
// setSize는 캔버스를 비우므로 그 자리에서 다시 그린다 — 안 그리면 전환 중에 검은 화면이 깜빡인다
function refit() {
  resize();
  if (!booted) return;
  updateSky(updateGroupLabels(updateLabels()));
  draw();
}
let booted = false;
const ro = new ResizeObserver(refit);
ro.observe(stageEl);
ro.observe(panelEl);
resize();
// 글꼴이 늦게 뜨면 이름 너비가 달라지므로 다시 잰다
document.fonts?.ready.then(() => { for (const b of bodies) b.nameW = 0; });

// 처음 화면: 태양계 전체
camera.position.copy(OVERVIEW_DIR).multiplyScalar(overviewDist());
controls.minDistance = byKey.sun.reach * 1.15;
state.view = 'all';
updatePositions(julianDateTT(state.simMs));
markFocus();
applyAtmosphere();

booted = true;
renderer.setAnimationLoop(t => { step(t); draw(); });

// 자동 확인용(백그라운드 탭에서는 requestAnimationFrame이 돌지 않는다)
window.__app = { state, step, draw, flyTo, camera, bodies: byKey, RATES, applyAtmosphere, setSidebar, setLayers, setLayer, cloud, oort, skyLines, VIEWS, chooseView, choose };
