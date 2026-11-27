// 화면 — 크기·거리 모두 실제 비율(km). 초점 천체를 원점에 두고 그린다(위치 계산은 JS 배정밀도, 그리기 직전에 뺀다).
import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { AU_KM, BODIES, VALID_FROM, VALID_TO, heliocentric, orbitTrail, julianDateTT, eclipticToScene, bodyAxes, ellipsoidRadius, hasRotation, raDecToScene, rotationAngles } from './ephemeris.js';
import { RING_EDGES, ringSlantLevels } from './rings.js';
import { NIGHT_GLSL, RIM_GLSL } from './atmosphere.js';
import { RING_LIGHT_GLSL, RING_SHADOW_GLSL, RING_SLANT_GLSL, ringAlbedoGLSL } from './rings_glsl.js';
import { MOONS, systemOffsets, moonTrailCache } from './moons.js';
import { RATES, REALTIME, clampRate, rateText, advanceMs, navGroups, systemOf, LAYERS, defaultLayers, bodyShown, GROUP_LAYER } from './nav.js';
import { SHAPED, SHAPE_REACH, parseShape, shapeUV } from './shapes.js';
import { production, ionLength, comaRadius, ionDirection, dustTail, dustSamples, stateFrom } from './comets.js';
import { distanceKm, distanceText, diameterOf, fmtDiameter, ratioText, defaultPair, compareLayout, visibleMid, extremeText, fmtKm, fmtAU, fmtDay } from './tools.js';
import { toScreen as flareScreen, ghosts, GHOSTS, BLOOM, bloomScales, coreSigma, veilScale, visibleFraction, flareGain, bloomGain } from './flare.js';
import { refDistance, lightScale } from './exposure.js';
import { PV, surfaceGain, colorStats, albedoRef, albedoRatio, realToMap } from './albedo.js';
import { MAP_STATS } from './map_stats.js';
import { LIMB_GLSL } from './sun.js';
import { PHASE_GLSL } from './phase.js';
import { RING_SETS, ringEdgeRadii, buildProfile, dustMipLevels, adamsArcLon, localPhiOfLon, ADAMS_ARC_GLSL, ADAMS_ARC_FD, NEPTUNE_RINGS } from './jovian_rings.js';
import { orbitOf, orbitMarks, orbitView, orbitFit, ellipsePoint, apsisNames, orbitCenter, orbitPeriodYears, periodText } from './orbit.js';
import { HAUMEA_POLE, HAUMEA_RING } from './dwarfs.js';
import { DWARFS, COMETS, SMALL_BODIES, isSmallBody, smallBodyHelio, smallBodyTrail, parsePoints, pointPositions, oortCloud, OORT, groupAnchors } from './smallbodies.js';

const TRAIL_N = 360;
const ORBIT_OPACITY = 0.3; // 궤도(한 바퀴 고른 선)의 밝기 — 궤적(꼬리)보다 흐리게
const FOV = 45;

// ---------- 장면 ----------
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
// 본 장면은 반정밀 부동소수 화면(sceneRT)에 선형으로 그린 뒤 화면용(sRGB)으로 바꾼다 — 반투명(고리·구름)이 빛의 세기로 섞이게.
// 그 화면을 못 만드는 GPU는 예전처럼 캔버스에 바로 그린다(반투명이 sRGB 값으로 섞임)
const LINEAR = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
// 화면 표시용(궤도선·궤적·점 무리·재기 선)은 빛이 아니라 표시라 예전 모습을 지킨다 — 검은 하늘 위에서 a·c(sRGB) ≈ a^2.2·c(선형)
const uiAlpha = mat => {
  if (LINEAR) mat.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>
  gl_FragColor.a = pow(gl_FragColor.a, 2.2);`);
  };
  return mat;
};
const scene = new THREE.Scene();
const OCCLUDE = 1; // 혜성 코마·꼬리를 가리는 몸체의 층(drawGlow가 이 층만 깊이로 먼저 그린다)
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
const TEXTURED = new Set(['mercury', 'earth', 'mars', 'jupiter', 'saturn', 'moon', 'pluto', 'charon', 'io', 'europa', 'ganymede', 'callisto',
  'mimas', 'enceladus', 'tethys', 'dione', 'rhea', 'iapetus', 'neptune', 'ceres', 'triton', 'miranda', 'ariel', 'umbriel', 'titania', 'oberon',
  'hyperion']); // 히페리온은 모양 모형에 입힌다(shapeUV — 가운데에서 본 경도·위도)
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
  loadTexture(url).then(tex => {
    if (SHAPED.has(key)) tex.wrapS = THREE.RepeatWrapping; // 모양 모형은 이음매 면의 u가 1을 넘는다(shapeUV)
    setMap(mat, tex);
  }, () => console.warn(`표면 지도를 못 불러옴: ${url} — 단색으로 둔다`));
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
// 「대기」 스위치를 보이는 천체 — 지구는 표면을 가리지 않고 가장자리 빛(atmoMesh)만 켜고 끈다
const HAS_ATMO = new Set([...Object.keys(SURFACE_UNDER), 'earth']);

// 위성은 구(평균 반지름)로 그린다 — 자세 모형(hasRotation)이 있는 것만 돌린다(달·갈릴레이 위성·토성 위성·포보스·데이모스·카론, 히페리온은 보기용 회전 — 긴 축을 황도 북극에 두고 관측 빠르기로). 나머지는 단색이라 돌려도 보이지 않는다
// 포보스·데이모스·히페리온·혜성 핵은 모양 모형(SHAPED, textures/<이름>_shape.bin)을 받으면 구를 그것으로 바꾼다 — 못 받으면 구로 둔다
function loadShape(b) {
  fetch(`textures/${b.key}_shape.bin`).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then(buf => {
    const shape = parseShape(buf);
    const { positions, index, uv } = TEXTURED.has(b.key) ? shapeUV(shape) : shape; // 지도가 있으면 지도 좌표를 붙인다
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    b.mesh.geometry.dispose();
    b.mesh.geometry = geo;
  }).catch(e => console.warn(`모양 모형을 못 불러옴: ${b.key} (${e}) — 구로 둔다`));
}
// 태양 가장자리 어두워짐(src/sun.js): 화면 공간 법선과 시선의 코사인으로 선형 색에 곱한다(sceneRT가 선형이라 빛 세기로 곱해진다)
function limbDarken(mat) {
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vLdN;
varying vec3 vLdP;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
  vLdN = normalize(normalMatrix * normal);
  vLdP = mvPosition.xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vLdN;
varying vec3 vLdP;
${LIMB_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  diffuseColor.rgb *= limbDarkening(dot(normalize(vLdN), normalize(-vLdP)));`);
  };
}
const ALL = [...BODIES, ...MOONS, ...SMALL_BODIES];
const bodies = ALL.map(b => {
  const fine = TEXTURED.has(b.key) || b.key in SURFACE_UNDER;
  // 하우메아는 3축 타원체(자세는 아래 「하우메아 자세·고리」 — 짧은 축을 고리 극에, 자전은 돌리지 않는다)
  const geo = b.abc ? new THREE.SphereGeometry(1, 48, 24).scale(b.abc[0], b.abc[2], b.abc[1])
    : b.parent ? new THREE.SphereGeometry(b.radius, ...(fine ? [96, 48] : [48, 24])) : ellipsoidGeometry(b.re, b.rp);
  const mat = b.key === 'sun'
    ? new THREE.MeshBasicMaterial({ color: b.color })
    : new THREE.MeshStandardMaterial({ color: b.color, roughness: 1, metalness: 0 });
  if (TEXTURED.has(b.key)) loadSurface(b.key, mat);
  if (b.key === 'sun') {
    limbDarken(mat);
    // 흑점(고정 무늬): SDO/HMI 연속광 2024-04-27~05-23 한 자전 합성(tools/make_sunspots.py) — 선형 세기라 색(0xfff4e0)에 그대로 곱한다
    loadTexture('textures/sun_spots_2k.jpg').then(tex => { mat.map = tex; mat.needsUpdate = true; }, () => console.warn('흑점 지도를 못 불러옴 — 무늬 없이 둔다'));
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.layers.enable(OCCLUDE);
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
    trail = new THREE.Line(g, uiAlpha(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })));
    trail.frustumCulled = false;
    trail.renderOrder = 2; // 점 무리(0)보다 나중에 그려 궤도선이 점에 묻히지 않게
    scene.add(trail);
    // 궤도: 같은 점을 한 바퀴 고른 밝기로(궤적은 천체 뒤로 흐려지는 꼬리)
    orbitLine = new THREE.Line(g, uiAlpha(new THREE.LineBasicMaterial({ color: c, transparent: true, depthWrite: false })));
    orbitLine.frustumCulled = false;
    orbitLine.renderOrder = 2;
    scene.add(orbitLine);
  }
  // 위치·궤도선 함수 — 행성(Standish)과 소천체(Horizons 요소)를 여기서 한 번 고른다(위성은 moons.js)
  const small = isSmallBody(b.key);
  // 밝기 배율(albedo.js): 지도·단색의 밝기 기준을 실제 반사율 비로 맞춘다 — gain은 혼자 볼 때 화면 평균을 DISPLAY_MEAN으로, ref는 초점 대비 비
  const sg = b.key === 'sun' ? { gain: 1, display: 1 } : surfaceGain(b.key, MAP_STATS[b.key] ?? colorStats(b.color));
  const albedo = { gain: sg.gain, ref: b.key === 'sun' ? NaN : albedoRef(PV[b.key], sg.display),
    ring: b.key === 'sun' ? 1 : realToMap(PV[b.key], MAP_STATS[b.key] ?? colorStats(b.color)) }; // ring: 고리 빛(실제 I/F)을 이 몸체 지도 눈금으로
  return { ...b, reach: SHAPE_REACH[b.key] ?? b.reach ?? b.radius, mesh, trail, orbitLine, albedo, expo: { value: 1 }, // expo: 햇빛 노출 배율(exposure.js) — 재질·고리·구름·가장자리 빛이 같이 쓴다
    helio: small ? smallBodyHelio : heliocentric, orbit: small ? smallBodyTrail : orbitTrail, pos: [0, 0, 0], trailJd: NaN, moonTrail: b.parent ? moonTrailCache(b.key, TRAIL_N) : null };
});
const byKey = Object.fromEntries(bodies.map(b => [b.key, b]));
for (const k of SHAPED) loadShape(byKey[k]);

// ---------- 토성 고리 ----------
// 토성 몸체의 자식으로 적도면(로컬 XZ)에 둔다. 밝기·비침·그림자 식은 src/rings_glsl.js(테스트가 src/rings.js와 대조).
// 계산은 토성 로컬 좌표(km): 고리면 법선 = +Y, 해·카메라 방향은 매 장면 CPU에서 로컬로 바꿔 넣는다.
const ringU = {
  uTauA: { value: null }, uTauB: { value: null }, uR0: { value: 0 }, uR1: { value: 1 },
  uSunL: { value: new THREE.Vector3(1, 0, 0) }, uCamL: { value: new THREE.Vector3(0, 1, 0) },
  uRe: { value: byKey.saturn.re }, uRp: { value: byKey.saturn.rp }, uLight: { value: 3 / Math.PI * byKey.saturn.albedo.ring }, // 해 빛 세기 3(PointLight)과 같은 눈금 × 실제 I/F → 토성 지도 눈금(albedo.js realToMap)
  uExpo: byKey.saturn.expo,
  uShadowOn: { value: 1 }, // 「그림자」 레이어 — 토성 그림자(고리 위)·고리 그림자(토성 위)
};
const flatU = { value: 0 }; // 「그림자」를 끄면 1 — 모든 천체의 밤면을 N·L = 0.5 밝기까지 끌어올린다
const RING_GLSL = /* glsl */`
  uniform sampler2D uTauA, uTauB; uniform float uR0, uR1;
  uniform vec3 uSunL; uniform float uShadowOn;
  // 반지름 r의 기울기별 τ_eff 여덟 개(rings.js ringSlantLevels) — 범위 밖은 0
  vec4 ringTauA(float r) {
    if (r < uR0 || r > uR1) return vec4(0.0);
    return texture2D(uTauA, vec2((r - uR0) / (uR1 - uR0), 0.5));
  }
  vec4 ringTauB(float r) {
    if (r < uR0 || r > uR1) return vec4(0.0);
    return texture2D(uTauB, vec2((r - uR0) / (uR1 - uR0), 0.5));
  }`;
// 색(tint)은 사진을 보고 고른 화면 색(sRGB)이라 선형 값으로 바꿔 넣는다
const RING_ALBEDO_GLSL = ringAlbedoGLSL(t => { const c = new THREE.Color().setRGB(...t, THREE.SRGBColorSpace); return [c.r, c.g, c.b]; });
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
    ${RING_LIGHT_GLSL}
    ${RING_SLANT_GLSL}
    ${RING_ALBEDO_GLSL}
    ${PHASE_GLSL}
    uniform vec3 uCamL; uniform float uRe, uRp, uLight, uExpo;
    varying vec3 vP;
    void main() {
      #include <logdepthbuf_fragment>
      float r = length(vP.xz);
      vec4 ta = ringTauA(r), tb = ringTauB(r);
      if (ta.x <= 0.0) discard;
      vec3 v = normalize(uCamL - vP);
      vec2 tf = ringViewSlant(ta, tb, v, uSunL);
      float T = tf.x, F = tf.y;
      F *= saturnPhaseRatio(acos(clamp(dot(v, uSunL), -1.0, 1.0))); // 위상 함수(phase.js — Dones et al. 1993 A고리 멱함수, α = 0에서 1)
      if (uShadowOn > 0.5 && inPlanetShadow(vP, uSunL, uRe, uRp)) F = 0.0; // 토성 그림자
      vec4 a = ringAlbedo(r);
      gl_FragColor = vec4(a.rgb * a.a * F * uLight * uExpo, 1.0 - T);
      #include <colorspace_fragment>
    }`,
});
// 고리 가장자리를 궤도선처럼 그린다(레이어 「고리 강조」, 처음 끔). 목성형·하우메아는 좁은 고리를 한 줄로(ringEdgeRadii). 고리 평면(로컬 XZ)의 원, 반지름은 km, 행성 자세를 따른다.
const ringLines = [];
function ringEdgeLines(parent, radii, color) {
  const c = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35);
  for (const r of [...new Set(radii)]) {
    const pts = [];
    for (let i = 0; i <= 360; i++) pts.push(new THREE.Vector3(r * Math.cos(i * Math.PI / 180), 0, r * Math.sin(i * Math.PI / 180)));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), uiAlpha(new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.7, depthWrite: false })));
    line.frustumCulled = false; line.renderOrder = 2.6; line.visible = false;
    parent.add(line); ringLines.push(line);
  }
}
const ringMesh = new THREE.Mesh(new THREE.BufferGeometry(), ringMat);
ringMesh.visible = false;
byKey.saturn.mesh.add(ringMesh);
ringEdgeLines(byKey.saturn.mesh, Object.values(RING_EDGES), byKey.saturn.color);
// 고리는 깊이를 안 쓰므로 궤도선(2)보다 나중에 그려야 고리 뒤의 선이 비침만큼 가려진다(먼저 그리면 선이 고리 위에 그대로 덮인다).
// 고리 앞을 지나는 선은 토성 자신의 궤도선뿐인데, 고리가 크게 보일 때는 이미 흐려져 사라진다(step의 궤도선 흐리기). 거리 선(3)은 그 뒤
ringMesh.renderOrder = 2.5;

// 토성 표면에 지는 고리 그림자: 표면 점에서 해 쪽 빛줄기가 고리면을 지나는 반지름의 τ로 햇빛을 줄인다.
// 햇빛(직접광)에만 곱한다 — 주변광은 남겨 밤 쪽과 같은 방식으로 어두워지게(해는 유일한 직접광)
byKey.saturn.mesh.material.onBeforeCompile = sh => {
  Object.assign(sh.uniforms, { uTauA: ringU.uTauA, uTauB: ringU.uTauB, uR0: ringU.uR0, uR1: ringU.uR1, uSunL: ringU.uSunL, uShadowOn: ringU.uShadowOn });
  sh.vertexShader = 'varying vec3 vP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position;');
  sh.fragmentShader = `varying vec3 vP;\n${RING_GLSL}\n${RING_SHADOW_GLSL}\n${RING_LIGHT_GLSL}\n${RING_SLANT_GLSL}\n` +sh.fragmentShader.replace('#include <lights_fragment_end>', `
    #include <lights_fragment_end>
    float ringR = ringShadowRadius(vP, uSunL);
    if (uShadowOn > 0.5 && ringR >= 0.0) {
      float ringT = ringShadowT(ringSlantTau(ringTauA(ringR), ringTauB(ringR), uSunL.y), uSunL.y); // 비스듬한 햇빛의 τ_eff — 틈새로 새는 빛
      reflectedLight.directDiffuse *= ringT;
      reflectedLight.directSpecular *= ringT;
    }`);
};

// ---------- 해왕성 대흑점(GDS-89) 무늬 레이어 ----------
// Voyager 2 사진 PIA00046(1989-08-20)에서 띠 지도와의 차이만 뽑은 RGBA(textures/neptune_gds_2k.png, tools/make_neptune_gds.py).
// 띠 지도 위에 알파로 얹는다 — 1989년 모습 그대로 고정(대흑점은 1996년 이전에 사라졌다). 시간을 돌려도 같은 자리, 같은 모양.
const gdsU = { uGds: { value: null }, uGdsOn: { value: 0 } };
loadTexture('textures/neptune_gds_2k.png').then(tex => { gdsU.uGds.value = tex; gdsU.uGdsOn.value = 1; },
  () => console.warn('대흑점 무늬를 못 불러옴 — 띠만 둔다'));
byKey.neptune.mesh.material.onBeforeCompile = sh => {
  sh.uniforms.uGds = gdsU.uGds; sh.uniforms.uGdsOn = gdsU.uGdsOn;
  sh.vertexShader = 'varying vec2 vUvG;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvUvG = uv;');
  sh.fragmentShader = 'varying vec2 vUvG; uniform sampler2D uGds; uniform float uGdsOn;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
    #include <map_fragment>
    if (uGdsOn > 0.5) { vec4 g = texture2D(uGds, vUvG); diffuseColor.rgb = mix(diffuseColor.rgb, g.rgb, g.a); }`);
};

// ---------- 지구 밤 불빛·대기 가장자리 빛 (src/atmosphere.js) ----------
// 둘 다 지구 고정 좌표에서 계산한다 — 태양 방향(uSunL)·카메라(uCamL)를 지구 회전의 역으로 돌려 넣는다(updateEarthAtmo).
// 밤 불빛: NASA Black Marble 2016 흑백 세기(textures/earth_night_2k.jpg)에 나트륨등 색을 입혀 낮 쪽에서는 0, 박명을 지나 다 켜진다.
// 법선은 타원체 면의 법선이라 셰이더의 mu가 측지 위도 기준 sin(태양 고도)와 같다(tests/atmosphere.test.mjs의 sunMu와 같은 값).
const srgb = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
const earthU = {
  uExpo: byKey.earth.expo, uFlat: flatU,
  uSunL: { value: new THREE.Vector3(1, 0, 0) },
  uCamL: { value: new THREE.Vector3(0, 0, 1) },
  uNight: { value: null },
  uNightOn: { value: 0 }, // 질감을 받고 「지구 밤 불빛」 레이어가 켜져 있을 때 1
  uNightColor: { value: srgb(1.0, 0.8, 0.5).multiplyScalar(1.6) },
  uRimK: { value: 1 + 100 / 6378.137 }, // 대기 껍질 = 지구 반지름 + 100km(카르만 선)
  uRimColor: { value: srgb(0.4, 0.65, 1.0).multiplyScalar(1.2) },
  // 구름(2026-11-22): NASA GIBS VIIRS 가시광에서 뽑은 투명도(textures/earth_clouds_4k.jpg, tools/make_clouds.py). 고정 — 시간을 돌려도 안 움직인다.
  uCloud: { value: null },
  uCloudOn: { value: 0 },
  uCloudOpacity: { value: 0.92 }, // 구름 껍질의 최대 불투명도 — 낮추면 아래 지표·밤 불빛이 더 비친다
  uShadow: { value: 0.4 },        // 구름 그림자가 지표를 어둡게 하는 정도(구름 투명도 1일 때)
};
const CLOUD_H_KM = 10; // 구름 껍질 높이(대류권 윗부분 — 가장자리에서 지표와 떠 보이게)
loadTexture('textures/earth_night_2k.jpg').then(tex => { earthU.uNight.value = tex; },
  () => console.warn('밤 불빛 질감을 못 불러옴 — 밤 쪽은 어둡게 둔다'));
loadTexture('textures/earth_clouds_4k.jpg').then(tex => {
  tex.colorSpace = THREE.NoColorSpace; // 투명도 자료 — 밝기를 그대로 읽는다(색 변환 없음)
  tex.needsUpdate = true;
  earthU.uCloud.value = tex;
}, () => console.warn('구름 질감을 못 불러옴 — 구름 없이 둔다'));
byKey.earth.mesh.material.onBeforeCompile = sh => {
  Object.assign(sh.uniforms, { uSunL: earthU.uSunL, uNight: earthU.uNight, uNightOn: earthU.uNightOn, uNightColor: earthU.uNightColor,
    uCloud: earthU.uCloud, uCloudOn: earthU.uCloudOn, uShadow: earthU.uShadow });
  sh.vertexShader = 'varying vec3 vNl; varying vec2 vUvN;\n' +
    sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvNl = normal; vUvN = uv;');
  sh.fragmentShader = `varying vec3 vNl; varying vec2 vUvN;\nuniform vec3 uSunL; uniform sampler2D uNight; uniform float uNightOn; uniform vec3 uNightColor; uniform sampler2D uCloud; uniform float uCloudOn; uniform float uShadow;\n${NIGHT_GLSL}\n` +
    sh.fragmentShader.replace('#include <map_fragment>', `
    #include <map_fragment>
    // 구름 그림자: 같은 구름 지도를 지표 바로 아래(어긋남 0)에 흐리게(mip 편향) 겹쳐 어둡게 한다. 구름 높이 10km의 그림자는 낮은 태양에서도
    // 4K 지도(한 칸 약 10km) 한두 칸만 밀려서, 따로 구운 그림자 질감이나 광선 계산 없이 이 질감 읽기 한 번으로 충분하다.
    // 지도 값은 a^(1/2.2)로 담겨 있다(make_clouds.py) — 가리는 몫은 선형 a
    if (uCloudOn > 0.5) diffuseColor.rgb *= 1.0 - uShadow * pow(texture2D(uCloud, vUvN, 1.5).r, 2.2);
    `).replace('#include <emissivemap_fragment>', `
    #include <emissivemap_fragment>
    if (uNightOn > 0.5) {
      float lit = texture2D(uNight, vUvN).r;
      totalEmissiveRadiance += uNightColor * lit * nightWeight(dot(normalize(vNl), uSunL));
    }`);
};
const atmoMesh = new THREE.Mesh(ellipsoidGeometry(byKey.earth.re * earthU.uRimK.value, byKey.earth.rp * earthU.uRimK.value), new THREE.ShaderMaterial({
  uniforms: earthU,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */`
    #include <common>
    #include <logdepthbuf_pars_vertex>
    varying vec3 vP; varying vec3 vN;
    void main() {
      vP = position; vN = normal;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */`
    #include <common>
    #include <logdepthbuf_pars_fragment>
    ${RIM_GLSL}
    uniform vec3 uSunL; uniform vec3 uCamL; uniform float uRimK, uExpo; uniform vec3 uRimColor;
    varying vec3 vP; varying vec3 vN;
    void main() {
      #include <logdepthbuf_fragment>
      vec3 n = normalize(vN);
      float g = rimGlow(abs(dot(n, normalize(uCamL - vP))), dot(n, uSunL), uRimK);
      gl_FragColor = vec4(uRimColor * g * uExpo, 1.0);
      #include <colorspace_fragment>
    }`,
}));
// 구름 껍질: 지표 위 CLOUD_H_KM 높이. 태양 쪽만 밝고(낮) 박명엔 붉게, 밤 쪽은 거의 검게 — 아래 밤 불빛 위를 불투명도만큼 덮는다.
const CLOUD_K = 1 + CLOUD_H_KM / 6378.137;
const cloudMesh = new THREE.Mesh(ellipsoidGeometry(byKey.earth.re * CLOUD_K, byKey.earth.rp * CLOUD_K), new THREE.ShaderMaterial({
  uniforms: earthU,
  transparent: true, depthWrite: false,
  vertexShader: /* glsl */`
    #include <common>
    #include <logdepthbuf_pars_vertex>
    varying vec3 vN; varying vec2 vUvC;
    void main() {
      vN = normal; vUvC = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */`
    #include <common>
    #include <logdepthbuf_pars_fragment>
    uniform sampler2D uCloud; uniform vec3 uSunL; uniform float uCloudOpacity, uExpo, uFlat;
    varying vec3 vN; varying vec2 vUvC;
    void main() {
      #include <logdepthbuf_fragment>
      // 구름 투명도 지도는 sRGB 합성에 맞춰 뽑았다 — 선형 합성에서는 검은 바다 위 밝기가 같도록 2.2승(구름 그림자는 그대로)
      float a = ${LINEAR ? 'pow(texture2D(uCloud, vUvC).r, 2.2)' : 'texture2D(uCloud, vUvC).r'} * uCloudOpacity;
      float mu = dot(normalize(vN), uSunL);
      float day = smoothstep(-0.1, 0.35, mu);
      if (uFlat > 0.5) { day = max(day, 0.5); mu = max(mu, 0.5); }
      vec3 tint = mix(vec3(1.0, 0.5, 0.28), vec3(1.0, 0.99, 0.97), smoothstep(0.0, 0.25, mu));
      vec3 col = tint * (0.012 + 0.9 * day) * uExpo;
      gl_FragColor = vec4(col, a);
      #include <colorspace_fragment>
    }`,
}));
cloudMesh.renderOrder = 2.4; // 가장자리 빛(2.5)보다 먼저 — 그 빛이 구름 위에 더해진다
byKey.earth.mesh.add(cloudMesh);
atmoMesh.renderOrder = 2.5; // 궤도선(2) 다음 — 고리와 같은 까닭(깊이를 안 써서 먼저 그리면 뒤의 선이 덮는다)
byKey.earth.mesh.add(atmoMesh);
function updateEarthAtmo() {
  const m = byKey.earth.mesh;
  atmoMesh.visible = m.visible && state.atmosphere;
  earthU.uCloudOn.value = earthU.uCloud.value && state.atmosphere ? 1 : 0; // 「대기」 스위치와 함께 켜고 끈다
  cloudMesh.visible = m.visible && earthU.uCloudOn.value === 1;
  earthU.uNightOn.value = earthU.uNight.value && state.layers.nightLights && state.layers.shadows ? 1 : 0; // 그림자 끔(밤면을 밝힘)이면 밤 불빛도 안 켠다
  if (!m.visible) return;
  qInv.copy(m.quaternion).invert();
  earthU.uSunL.value.copy(byKey.sun.mesh.position).sub(m.position).normalize().applyQuaternion(qInv);
  earthU.uCamL.value.copy(camera.position).sub(m.position).applyQuaternion(qInv);
}

fetch('textures/saturn_rings.json').then(r => r.json()).then(p => {
  // 멀리서 보면 수천 줄의 결이 화소보다 가늘어 물결무늬가 생긴다 → 밉맵. 투과율로 평균한 단계를 CPU에서 만든다
  // (GPU 자동 밉맵은 τ를 그대로 평균해 간극이 메워지고, R16F는 모바일에서 자동 생성이 안 될 수 있다)
  // 고리는 알갱이 무리라 칸을 줄일 때 빛길 기울기마다 평균이 다르다 → 기울기 8개의 τ_eff(rings.js ringSlantLevels)를 RGBA 두 장(기울기 0~3, 4~7)에
  [ringU.uTauA.value, ringU.uTauB.value] = slantTextures(p.tau); ringU.uR0.value = p.r0; ringU.uR1.value = p.r1;
  // 고리 경계 밖(단면 양 끝의 잡음 수준 τ)은 그리지 않는다. XY → 로컬 XZ(법선 +Y = 북극)
  ringMesh.geometry = new THREE.RingGeometry(RING_EDGES.cIn, RING_EDGES.aOut, 720, 1).rotateX(-Math.PI / 2);
  ringMesh.visible = true;
}).catch(e => console.warn('토성 고리 단면을 못 불러옴 — 고리 없이 둔다', e));

// 밉맵을 손으로 넣은 1줄짜리 반정밀 RGBA 텍스처. mips[k] = 단계 k의 Float32Array(칸 × 4)
function mipTexture(mips) {
  const lv = mips.map(a => ({ data: Uint16Array.from(a, x => THREE.DataUtils.toHalfFloat(x)), width: a.length / 4, height: 1 }));
  const tex = new THREE.DataTexture(lv[0].data, lv[0].width, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mipmaps = lv;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
// 단면 τ → 기울기 8개 τ_eff 텍스처 두 장(rings.js ringSlantLevels — 0~3, 4~7). scale: 반정밀에 담기 전 곱하는 수
function slantTextures(tau, scale = 1) {
  const levels = ringSlantLevels(tau);
  return [0, 1].map(h => mipTexture(levels.map(l => Float32Array.from({ length: l.length / 2 }, (_, i) => scale * l[(i >> 2) * 8 + h * 4 + (i & 3)]))));
}

const qInv = new THREE.Quaternion();
function updateRings() {
  const m = byKey.saturn.mesh;
  qInv.copy(m.quaternion).invert();
  ringU.uSunL.value.copy(byKey.sun.mesh.position).sub(m.position).normalize().applyQuaternion(qInv);
  ringU.uCamL.value.copy(camera.position).sub(m.position).applyQuaternion(qInv);
}

// ---------- 목성·천왕성·해왕성 고리 ----------
// 고리 표·단면·애덤스 호는 src/jovian_rings.js, 위상 함수는 src/phase.js(수치 출처 textures/출처.md 「목성형 고리」).
// 빛·비침 식은 토성 고리와 같고(ringViewSlant), 반사율만 위상각에 따라 큰 알갱이·먼지를 섞은 W(α).
// 밝기는 실제 값 그대로(배율 없음). 가장자리는 레이어 「고리 강조」가 궤도선처럼 그린다(ringEdgeLines).
// 한계: 고리가 행성 표면에 드리우는 그림자는 넣지 않았다(행성이 고리에 드리우는 그림자만).
// 색: 목성·해왕성 고리는 「매우 붉다」(de Pater et al. 2018 두 장 모두) — 화면 색은 근사, 천왕성은 회색
const RING_TINT = { jupiter: [1.0, 0.82, 0.66], uranus: [1, 1, 1], neptune: [1.0, 0.82, 0.66] };
// 목성 고리는 τ가 1e-9~6e-6이라 반정밀(가장 작은 수 약 6e-8)에 못 담는다 → 1e4배로 담고 셰이더에서 나눈다(모두 얇아 선형)
const TAU_SCALE = { jupiter: 1e4, uranus: 1, neptune: 1 };
const jRings = [];
for (const [key, sets] of Object.entries(RING_SETS)) {
  const b = byKey[key];
  for (const set of sets) {
    const p = buildProfile(set.rings, set.r0, set.r1, set.n), sc = TAU_SCALE[key];
    const [tA, tB] = slantTextures(p.tau, sc);
    const dTex = mipTexture(dustMipLevels(p.tau, p.dust).map(d => Float32Array.from({ length: d.length * 4 }, (_, i) => d[i >> 2])));
    const tint = new THREE.Color().setRGB(...RING_TINT[key], THREE.SRGBColorSpace);
    const u = {
      uTauA: { value: tA }, uTauB: { value: tB }, uDust: { value: dTex }, uR0: { value: p.r0 }, uR1: { value: p.r1 }, uTauScale: { value: sc },
      uArcA: { value: tA }, uArcB: { value: tB }, uArcOn: { value: 0 }, uArcPhi: { value: 0 },
      uSunL: { value: new THREE.Vector3(1, 0, 0) }, uCamL: { value: new THREE.Vector3(0, 1, 0) },
      uRe: { value: b.re }, uRp: { value: b.rp }, uLight: { value: 3 / Math.PI * b.albedo.ring }, uExpo: b.expo, uShadowOn: ringU.uShadowOn,
      uLargeKind: { value: set.large.kind === 'jupiter' ? 1 : 0 }, uW0: { value: set.large.w0 ?? 0 },
      uTint: { value: new THREE.Vector3(tint.r, tint.g, tint.b) },
    };
    if (set.arcs) { // 애덤스 고리만 호 τ(0.1)로 채운 단면 — 셰이더가 경도에 따라 (호 τ / 0.1)배 더한다
      const adams = NEPTUNE_RINGS.find(g => g.name === '애덤스');
      [u.uArcA.value, u.uArcB.value] = slantTextures(buildProfile([{ ...adams, tau: 0.1 }], set.r0, set.r1, set.n).tau);
      u.uArcOn.value = 1;
    }
    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      vertexShader: ringMat.vertexShader,
      fragmentShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_fragment>
        ${RING_LIGHT_GLSL}
        ${RING_SLANT_GLSL}
        ${PHASE_GLSL}
        ${ADAMS_ARC_GLSL}
        uniform sampler2D uTauA, uTauB, uDust, uArcA, uArcB;
        uniform vec3 uSunL, uCamL, uTint;
        uniform float uR0, uR1, uTauScale, uArcOn, uArcPhi, uRe, uRp, uLight, uExpo, uShadowOn, uLargeKind, uW0;
        varying vec3 vP;
        void main() {
          #include <logdepthbuf_fragment>
          float r = length(vP.xz);
          if (r < uR0 || r > uR1) discard;
          vec2 uv = vec2((r - uR0) / (uR1 - uR0), 0.5);
          vec4 ta = texture2D(uTauA, uv) / uTauScale, tb = texture2D(uTauB, uv) / uTauScale;
          float fd = texture2D(uDust, uv).x;
          if (uArcOn > 0.5) { // 애덤스 고리 호 — 프라테르니테 가운데부터 공전 방향으로 잰 경도 차(°)
            float dl = mod(degrees(uArcPhi - atan(vP.z, vP.x)) + 180.0, 360.0) - 180.0;
            float k = adamsArcTau(dl) / 0.1;
            if (k > 0.0) {
              vec4 aa = texture2D(uArcA, uv) * k, ab = texture2D(uArcB, uv) * k;
              fd = (ta.x * fd + aa.x * ${ADAMS_ARC_FD.toFixed(2)}) / max(1e-12, ta.x + aa.x);
              ta += aa; tb += ab;
            }
          }
          if (ta.x <= 0.0) discard;
          vec3 v = normalize(uCamL - vP);
          vec2 tf = ringViewSlant(ta, tb, v, uSunL);
          float F = tf.y * mixedW(acos(clamp(dot(v, uSunL), -1.0, 1.0)), fd, uLargeKind, uW0);
          if (uShadowOn > 0.5 && inPlanetShadow(vP, uSunL, uRe, uRp)) F = 0.0;
          gl_FragColor = vec4(uTint * (F * uLight * uExpo), 1.0 - tf.x);
          #include <colorspace_fragment>
        }`,
    });
    const lo = Math.max(set.r0, Math.min(...set.rings.map(g => g.r0 ?? g.r - g.w / 2)));
    const hi = Math.min(set.r1, Math.max(...set.rings.map(g => g.r1 ?? g.r + g.w / 2)));
    const mesh = new THREE.Mesh(new THREE.RingGeometry(lo, hi, 1440, 1).rotateX(-Math.PI / 2), mat);
    mesh.renderOrder = 2.5;
    b.mesh.add(mesh);
    jRings.push({ key, u, mesh });
    ringEdgeLines(b.mesh, ringEdgeRadii(set.rings), b.color);
  }
}
function updateJovianRings(jd) {
  for (const { key, u } of jRings) {
    const m = byKey[key].mesh;
    if (!m.visible) continue;
    qInv.copy(m.quaternion).invert();
    u.uSunL.value.copy(byKey.sun.mesh.position).sub(m.position).normalize().applyQuaternion(qInv);
    u.uCamL.value.copy(camera.position).sub(m.position).applyQuaternion(qInv);
    if (u.uArcOn.value) u.uArcPhi.value = localPhiOfLon(rotationAngles(key, jd).W, adamsArcLon(jd));
  }
}

// ---------- 하우메아 자세·고리 ----------
// 고리·히이아카 궤도가 적도면에 있다(Ortiz et al. 2017) → 짧은 축(로컬 +Y)을 고리 극에 맞춘다.
// 자전 위상은 모른다(자세 모형 없음) — 긴 축(로컬 +X)은 적도면 위 아무 방향에 고정해 두고 돌리지 않는다.
{
  const yAx = new THREE.Vector3(...raDecToScene(HAUMEA_POLE.ra, HAUMEA_POLE.dec));
  const xAx = new THREE.Vector3(0, 1, 0).cross(yAx).normalize(), zAx = new THREE.Vector3().crossVectors(xAx, yAx);
  byKey.haumea.mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAx, yAx, zAx));
}
// 고리: 하우메아 몸체의 자식으로 적도면(로컬 XZ)에. 빛 식은 토성 고리와 같다(rings_glsl.js ringView) — τ·알갱이 반사율은 dwarfs.js.
// 그림자는 몸체(3축 타원체)가 고리에 드리우는 것만 — 고리가 몸체에 드리우는 그림자는 얇아서(τ 0.08) 넣지 않았다.
const hRingU = {
  uSunL: { value: new THREE.Vector3(1, 0, 0) }, uCamL: { value: new THREE.Vector3(0, 1, 0) },
  uAbc: { value: new THREE.Vector3(byKey.haumea.abc[0], byKey.haumea.abc[2], byKey.haumea.abc[1]) }, // 로컬 x·y·z 반지름
  uLight: { value: 3 / Math.PI * byKey.haumea.albedo.ring }, uExpo: byKey.haumea.expo, uShadowOn: ringU.uShadowOn,
};
const hRingMat = new THREE.ShaderMaterial({
  uniforms: hRingU,
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  vertexShader: ringMat.vertexShader,
  fragmentShader: /* glsl */`
    #include <common>
    #include <logdepthbuf_pars_fragment>
    ${RING_LIGHT_GLSL}
    uniform vec3 uSunL, uCamL, uAbc; uniform float uLight, uExpo, uShadowOn;
    varying vec3 vP;
    // 점 p에서 해 쪽(s)으로 간 빛줄기가 원점 중심 3축 타원체에 막히는가 — 축마다 나눠 단위 구 문제로
    bool inBodyShadow(vec3 p, vec3 s) {
      vec3 P = vec3(p.x / uAbc.x, p.y / uAbc.y, p.z / uAbc.z), S = vec3(s.x / uAbc.x, s.y / uAbc.y, s.z / uAbc.z);
      float b = dot(P, S);
      if (b > 0.0) return false;
      return b * b - dot(S, S) * (dot(P, P) - 1.0) > 0.0;
    }
    void main() {
      #include <logdepthbuf_fragment>
      vec3 v = normalize(uCamL - vP);
      vec2 tf = ringView(${HAUMEA_RING.tau.toFixed(5)}, v, uSunL);
      float F = tf.y;
      if (uShadowOn > 0.5 && inBodyShadow(vP, uSunL)) F = 0.0;
      float w = ${HAUMEA_RING.albedo.toFixed(4)}; // 고리 색 자료가 없어 회색
      gl_FragColor = vec4(vec3(w * F * uLight * uExpo), 1.0 - tf.x);
      #include <colorspace_fragment>
    }`,
});
const hRingMesh = new THREE.Mesh(new THREE.RingGeometry(HAUMEA_RING.rIn, HAUMEA_RING.rOut, 720, 1).rotateX(-Math.PI / 2), hRingMat);
hRingMesh.renderOrder = 2.5;
byKey.haumea.mesh.add(hRingMesh);
ringEdgeLines(byKey.haumea.mesh, ringEdgeRadii([{ r0: HAUMEA_RING.rIn, r1: HAUMEA_RING.rOut }]), byKey.haumea.color);
function updateHaumeaRing() {
  const m = byKey.haumea.mesh;
  qInv.copy(m.quaternion).invert();
  hRingU.uSunL.value.copy(byKey.sun.mesh.position).sub(m.position).normalize().applyQuaternion(qInv);
  hRingU.uCamL.value.copy(camera.position).sub(m.position).applyQuaternion(qInv);
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
const overviewDist = overviewFit(33); // 목성형 행성(해왕성 궤도까지) 보기 = 처음 화면

// 날아가기 3단계 — ① 두 천체가 함께 보일 만큼 물러나고 ② 옆으로 옮겨 가고 ③ 다가간다.
// 단계마다 걸리는 시간은 거리 배율(로그)에 비례한다. 이미 충분히 멀면 ①은 0초.
// opts.target: 바라보는 점(초점 천체 기준, 기본 원점) · opts.up: 화면 위쪽(기본 황도 북극 +Y) — 궤도 보기가 쓴다.
// 다른 곳으로 날아가면 둘 다 기본으로 돌아온다
const Y_UP = new THREE.Vector3(0, 1, 0), ORIGIN = new THREE.Vector3();
function setUp(v) {
  camera.up.copy(v);
  controls._quat.setFromUnitVectors(camera.up, Y_UP); // OrbitControls는 만들 때의 up만 기억한다 — 바꾸면 함께 고친다
  controls._quatInverse.copy(controls._quat).invert();
}
function flyTo(key, opts = {}) {
  // 날아가는 중에 누르면 도착한 뒤에 이어서 간다(중간 위치에서 튀지 않게)
  if (state.fly) { state.fly.next = key === state.fly.to && !opts.view && !opts.target ? null : { key, opts }; return; }
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
  const tg0 = controls.target.clone(), tg1 = opts.target ? opts.target.clone() : ORIGIN.clone();
  const up0 = camera.up.clone(), up1 = opts.up ? opts.up.clone().normalize() : Y_UP.clone();
  const d0 = camera.position.distanceTo(tg0);
  const d1 = opts.dist?.(fw) ?? viewDist(byKey[key], fw);
  const gap = Math.hypot(...byKey[key].pos.map((v, i) => v - byKey[from].pos[i]));
  const D = Math.max(d0, d1, (gap / Math.tan(Math.min(halfV(), halfH(fw)))) * 1.3);
  const w = [Math.log(D / d0), gap > 0 ? 2 : 0, Math.log(D / d1)];
  const total = w[0] + w[1] + w[2] || 1;
  const dur = Math.min(3600, 900 + 260 * total);
  const dir0 = camera.position.clone().sub(tg0).normalize();
  const dir1 = opts.dir ? opts.dir.clone().normalize() : dir0.clone();
  // 궤도 보기처럼 황도 극 가까이에서 내려다보다 떠나면 시선이 돌아올 up(+Y)과 거의 나란해 lookAt이 휘청인다 —
  // 지금 화면 위쪽의 반대편으로 눕혀 60° 높이에서 보게 한다(화면 방향이 이어지게)
  if (!opts.dir && Math.abs(dir1.dot(up1)) > 0.95) {
    const h = up0.clone().addScaledVector(up1, -up0.dot(up1)).negate();
    if (h.lengthSq() < 1e-6) h.set(0, 0, 1);
    dir1.copy(up1).multiplyScalar(Math.sin(Math.PI / 3) * Math.sign(dir1.dot(up1))).addScaledVector(h.normalize(), Math.cos(Math.PI / 3)).normalize();
  }
  state.fly = { from, to: key, t0: performance.now(), dur, d0, d1, D, cut: [w[0] / total, (w[0] + w[1]) / total], dir0, dir1, tg0, tg1, up0, up1 };
  controls.enabled = false;
  updateAtmoButton();
  if (!state.atmosphere) applyAtmosphere(); // 대기를 끈 채로 왔으면 새 초점의 지도를 받기 시작
}

// 노출의 반사율 기준이 될 초점(날아가는 중이면 출발·도착 사이를 옮겨 간 정도 m으로 섞는다) — updateExposure가 읽는다
let expoMix = null;
function focusPosition(now) {
  const f = state.fly;
  expoMix = null;
  if (!f) return byKey[state.focus].pos;
  // 그림 틀 시각이 누른 시각보다 앞설 수 있다 — 0 아래로 내려가면 거리가 NaN이 된다
  const s = THREE.MathUtils.clamp((now - f.t0) / f.dur, 0, 1);
  const [c1, c2] = f.cut;
  const lerpLog = (x, y, t) => Math.exp(Math.log(x) + (Math.log(y) - Math.log(x)) * t);
  let d, m; // 카메라 거리, 옮겨 간 정도(0~1)
  if (s < c1) { d = lerpLog(f.d0, f.D, ease(s / c1)); m = 0; }
  else if (s < c2) { d = f.D; m = ease((s - c1) / (c2 - c1)); }
  else { d = c2 < 1 ? lerpLog(f.D, f.d1, ease((s - c2) / (1 - c2))) : f.d1; m = 1; }
  expoMix = { from: f.from, to: f.to, m };
  const a = byKey[f.from].pos, b = byKey[f.to].pos;
  const dir = f.dir0.clone().lerp(f.dir1, ease(s));
  if (dir.lengthSq() < 1e-6) dir.copy(f.dir1); // 정반대 방향일 때 0 벡터 방지
  dir.normalize();
  const es = ease(s);
  controls.target.lerpVectors(f.tg0, f.tg1, es);
  camera.position.copy(dir.multiplyScalar(d)).add(controls.target);
  const up = f.up0.clone().lerp(f.up1, es);
  setUp(up.lengthSq() < 1e-6 ? f.up1 : up.normalize()); // 뒤집힌 방향끼리면 중간이 0 — 도착 방향으로
  if (s >= 1) {
    state.fly = null;
    setUp(f.up1);
    controls.enabled = true;
    controls.minDistance = byKey[state.focus].reach * 1.15 + controls.target.length();
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
const cloudMat = uiAlpha(new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false }));
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
  uiAlpha(new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, color: PLAIN, transparent: true, depthWrite: false })));
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
  // 안쪽에서 바깥으로(확대 → 축소)
  { key: 'terrestrial', name: '지구형 행성', dist: overviewFit(1.8) }, // 화성 궤도 원일점 1.67AU
  { key: 'belt', name: '소행성대', layer: 'belt', dist: overviewFit(5.6) },
  { key: 'jovian', name: '목성형 행성', dist: overviewDist }, // 해왕성 원일점 30.3AU
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

// 대기 켜기·끄기 — 대기가 있는 천체(HAS_ATMO)에 다가가 있을 때만 단추를 보인다
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
// 대기가 있는 천체에 다가가 있을 때 단추를 보인다. 대기를 끈 채로 떠나면 다시 켤 수 있게 계속 보인다
function updateAtmoButton() {
  atmoBtn.hidden = !!state.fly || (state.atmosphere && !HAS_ATMO.has(state.focus));
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
  for (const k of ['trails', 'orbits', 'labels', 'icons', 'constellations', 'nightLights', 'shadows', 'sunFlare']) lyList.appendChild(layerItem(k));
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
  ringU.uShadowOn.value = L.shadows ? 1 : 0;
  for (const l of ringLines) l.visible = !!L.ringEdges;
  flatU.value = L.shadows ? 0 : 1;
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

// ---------- 도구: 거리 재기 · 크기 비교 ----------
// 고르는 목록 — 사이드바와 같은 순서(태양 · 행성 · 위성 · 왜행성 · 혜성). 위성은 모천체 이름을 붙인다
function fillPicker(sel, withSun = true) {
  const g = navGroups(bodies);
  const add = (label, list) => {
    if (!list.length) return;
    const og = document.createElement('optgroup');
    og.label = label;
    for (const b of list) {
      const o = el('option', null, b.parent ? `${b.name} (${byKey[b.parent].name})` : b.name);
      o.value = b.key;
      og.appendChild(o);
    }
    sel.appendChild(og);
  };
  if (withSun) add('태양', [g.sun]);
  add('행성', g.planets.map(e => e.body));
  add('위성', [...g.planets, ...g.dwarfs, ...g.comets, ...g.other].flatMap(e => e.moons));
  add('왜행성', g.dwarfs.map(e => e.body));
  add('혜성', g.comets.map(e => e.body));
  add('기타', g.other.map(e => e.body));
}
const distEl = document.getElementById('dist');
const compareEl = document.getElementById('compare');
const orbitEl = document.getElementById('orbit');
const toolBtn = document.getElementById('tool-btn');
const toolMenu = document.getElementById('tool-menu');
const toolItems = [...toolMenu.querySelectorAll('[data-tool]')];
const TOOL_NAMES = { dist: '거리 재기', size: '크기 비교', orbit: '궤도 보기' };
const pickers = {
  dist: [document.getElementById('dist-a'), document.getElementById('dist-b')],
  size: [document.getElementById('cmp-a'), document.getElementById('cmp-b')],
};
state.tool = null; // 'dist' | 'size' | null
state.pair = { dist: defaultPair('sun'), size: defaultPair('sun') };
for (const [tool, sels] of Object.entries(pickers)) {
  sels.forEach((sel, i) => {
    fillPicker(sel);
    sel.addEventListener('change', () => {
      state.pair[tool][i] = sel.value;
      if (tool === 'size') buildCompare();
      else lastDist = '';
    });
  });
}
// 도구를 열 때마다 「지구 · 지금 보는 천체」로 시작한다(궤도 보기는 지금 보는 천체, 태양이면 지구)
function setTool(t) {
  setToolMenu(false);
  state.tool = t;
  if (t && NARROW.matches) { setSidebar(false); setLayerPanel(false); } // 폰에서는 한쪽만 연다
  if (t === 'orbit') {
    orbitEl.hidden = false; // 카드 높이를 재려면 먼저 보여야 한다(goOrbit)
    state.orbitKey = state.focus === 'sun' ? 'earth' : state.focus;
    orbitSel.value = state.orbitKey;
    lastOrbit = '';
    goOrbit();
  } else if (t) {
    state.pair[t] = defaultPair(state.focus);
    pickers[t].forEach((sel, i) => { sel.value = state.pair[t][i]; });
  }
  orbitEl.hidden = t !== 'orbit';
  distEl.hidden = t !== 'dist';
  toolBtn.setAttribute('aria-pressed', String(!!t));
  document.getElementById('tool-name').textContent = t ? TOOL_NAMES[t] : '도구';
  for (const it of toolItems) it.setAttribute('aria-checked', String(it.dataset.tool === t));
  compareEl.hidden = t !== 'size';
  document.body.classList.toggle('cmp-open', t === 'size');
  lastDist = '';
  if (t === 'dist') distTop = distEl.offsetTop;
  if (t === 'size') buildCompare();
  if (booted) draw();
}
// 「도구」 단추: 쓰는 도구가 있으면 끄고, 없으면 목록을 펼친다. 목록 밖을 누르거나 Esc면 접는다
function setToolMenu(open) {
  toolMenu.hidden = !open;
  toolBtn.setAttribute('aria-expanded', String(open));
  if (open) toolItems[0].focus();
}
toolMenu.addEventListener('keydown', e => {
  const i = toolItems.indexOf(document.activeElement), n = toolItems.length;
  const go = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: n - 1 }[e.key];
  if (go === undefined) return;
  e.preventDefault();
  toolItems[(go + n) % n].focus();
});
toolBtn.addEventListener('click', () => {
  if (state.tool) setTool(null);
  else setToolMenu(toolMenu.hidden);
});
for (const it of toolItems) it.addEventListener('click', () => setTool(it.dataset.tool));
document.addEventListener('pointerdown', e => { if (!toolMenu.hidden && !e.target.closest('#tools')) setToolMenu(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !toolMenu.hidden) { setToolMenu(false); toolBtn.focus(); } });
for (const b of document.querySelectorAll('.tc-close')) b.addEventListener('click', () => setTool(null));
const distOn = () => state.tool === 'dist' && state.layers.ui; // 사용자 화면을 끄면 창과 함께 선·글자도 감춘다(닫기 단추가 없어지므로)
const orbitOn = () => state.tool === 'orbit' && state.layers.ui;
// 고른 천체는 레이어를 꺼 두었어도 보인다(궤도 보기는 그 천체와 중심 천체)
const toolShows = key => (distOn() && state.pair.dist.includes(key)) || (orbitOn() && (key === state.orbitKey || key === orbitCenterKey()));

// 거리 재기 — 두 천체 중심을 잇는 선 + 선 가운데 거리 · 창에는 km · AU · 빛이 가는 시간
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const MEASURE = cssVar('--measure') || '#ffd166';
const distLine = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)),
  uiAlpha(new THREE.LineBasicMaterial({ color: new THREE.Color(MEASURE), transparent: true, opacity: 0.9, depthWrite: false })));
distLine.frustumCulled = false;
distLine.renderOrder = 3;
distLine.visible = false;
scene.add(distLine);
const distTag = el('div', 'dlabel');
distTag.style.display = 'none';
labelLayer.appendChild(distTag);
const distKmEl = document.getElementById('dist-km'), distSubEl = document.getElementById('dist-sub');
let lastDist = '';
let distTop = 60; // 거리 창 위 끝(px) — 매 장면 읽으면 배치를 다시 계산하므로 열 때·크기 바뀔 때만 잰다
function updateDist() {
  const on = distOn();
  const [ka, kb] = state.pair.dist;
  distLine.visible = on && ka !== kb;
  distTag.style.display = 'none';
  if (!on) return;
  const A = byKey[ka], B = byKey[kb];
  const t = ka === kb ? { km: '같은 천체', sub: '' } : distanceText(distanceKm(A.pos, B.pos), AU_KM);
  const s = t.km + '|' + t.sub;
  if (s !== lastDist) { distKmEl.textContent = t.km; distSubEl.textContent = t.sub; lastDist = s; }
  if (ka === kb) return;
  const arr = distLine.geometry.attributes.position.array;
  A.mesh.position.toArray(arr, 0);
  B.mesh.position.toArray(arr, 3);
  distLine.geometry.attributes.position.needsUpdate = true;
  // 화면에 보이는 선 구간(날짜 줄 아래 ~ 조작부 위)의 가운데에 거리 — 그 구간이 짧으면(두 이름표 사이에 끼면) 쓰지 않는다.
  // 한쪽 끝이 카메라 뒤면 투영이 뒤집혀 쓰지 않는다. 거리 창 밑에 들면 창이 덮는다(값은 창에 있다)
  const pa = project(A), pb = project(B);
  if (!pa.front || !pb.front) return;
  const pm = visibleMid(pa.x, pa.y, pb.x, pb.y, 50, distTop + 24, stageW - 50, viewH - 8);
  if (!pm || pm.len < 120) return;
  distTag.textContent = t.km;
  distTag.style.display = '';
  distTag.style.transform = `translate(${pm.x}px, ${pm.y}px) translate(-50%, -150%)`;
}

// ---------- 궤도 보기 ----------
// 식은 src/orbit.js(테스트 tests/orbit.test.mjs). 타원·장반경·단반경 선은 중심 천체 기준 좌표(km)로 두고 물체째 중심 천체 자리에 놓는다.
// 고르면 중심 천체로 날아가 궤도면에 수직으로(황도 북쪽 편) 내려다보고, 근점을 왼쪽·장축을 가로로, 타원 중심을 카드 밖 빈 곳 가운데에 둔다
const ORB_N = 360;
const ORB_LINE = cssVar('--orb-line') || '#ff9f6e', ORB_AXIS = cssVar('--orb-axis') || '#7cc4ff';
const orbitSel = document.getElementById('orbit-body');
fillPicker(orbitSel, false);
state.orbitKey = 'earth';
const orbitCenterKey = () => orbitCenter(state.orbitKey);
let lastOrbit = '';
orbitSel.addEventListener('change', () => { state.orbitKey = orbitSel.value; lastOrbit = ''; goOrbit(); });
const orbGroup = new THREE.Group();
orbGroup.visible = false;
scene.add(orbGroup);
function orbLine(n, color, opacity, dashed = false) {
  const mat = uiAlpha(dashed ? new THREE.LineDashedMaterial({ color: new THREE.Color(color), transparent: true, opacity, depthWrite: false, dashSize: 1, gapSize: 1 })
    : new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity, depthWrite: false }));
  const line = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)), mat);
  line.frustumCulled = false;
  line.renderOrder = 3;
  orbGroup.add(line);
  return line;
}
const orbEllipse = orbLine(ORB_N + 1, ORB_LINE, 0.95);
const orbA = orbLine(2, ORB_AXIS, 1), orbB = orbLine(2, ORB_AXIS, 1), orbRest = orbLine(2, ORB_AXIS, 0.55, true); // 중심 → 원점 쪽은 점선
const orbTags = {
  a: el('div', 'olabel', '장반경 a'), b: el('div', 'olabel', '단반경 b'), c: el('div', 'olabel dim', '중심'),
  peri: el('div', 'olabel apsis'), apo: el('div', 'olabel apsis'),
};
orbTags.apo.style.alignItems = 'flex-end';
const orbDots = { peri: el('div', 'odot'), apo: el('div', 'odot') };
const orbCross = el('div', 'ocross');
orbCross.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" stroke-width="1.6"/></svg>';
const orbEls = [...Object.values(orbTags), ...Object.values(orbDots), orbCross];
for (const e of orbEls) { e.style.display = 'none'; labelLayer.appendChild(e); }
const orbOut = {
  a: document.getElementById('orb-a'), b: document.getElementById('orb-b'), peri: document.getElementById('orb-peri'),
  apo: document.getElementById('orb-apo'), e: document.getElementById('orb-e'), periK: document.getElementById('orb-peri-k'),
  apoK: document.getElementById('orb-apo-k'), note: document.getElementById('orb-note'),
};
const kmAU = km => { const au = fmtAU(km, AU_KM); return `<b>${fmtKm(km)}</b>${au ? ' · ' + au : ''}`; };
// 카드 값과 근점·원점 글자 — 바뀔 때만 다시 쓴다
function orbitCard(o, jd) {
  const [pk, ak] = apsisNames(o.center);
  const vals = [o.a, o.b, o.peri, o.apo].map(kmAU), e = `<span>${o.e.toFixed(4)}</span><span class="orb-per">주기 ${periodText(orbitPeriodYears(o))}</span>`, note = `${fmtDay(jd)} 기준 궤도`;
  const s = [...vals, e, pk, ak, note].join('|');
  if (s === lastOrbit) return;
  lastOrbit = s;
  [orbOut.a.innerHTML, orbOut.b.innerHTML, orbOut.peri.innerHTML, orbOut.apo.innerHTML] = vals;
  orbOut.e.innerHTML = e;
  orbOut.periK.textContent = pk; orbOut.apoK.textContent = ak;
  orbOut.note.textContent = note;
  orbTags.peri.innerHTML = `${pk}<span>${fmtKm(o.peri)}</span>`;
  orbTags.apo.innerHTML = `${ak}<span>${fmtKm(o.apo)}</span>`;
}
// 궤도를 둘 빈 곳(px) — 카드 옆에 넉넉한 자리가 있으면(넓은 화면) 옆, 아니면(폰) 카드 아래
function orbitBox(w) {
  const top = orbitEl.offsetTop, bottom = top + orbitEl.offsetHeight, right = orbitEl.offsetLeft + orbitEl.offsetWidth;
  return w - right >= 420 ? { l: right + 8, t: top, r: w - 8, b: viewH - 8 } : { l: 8, t: bottom + 8, r: w - 8, b: viewH - 8 };
}
const toScene = a => new THREE.Vector3(...eclipticToScene(a));
function goOrbit() {
  const jd = julianDateTT(state.simMs);
  const o = orbitOf(state.orbitKey, jd), v = orbitView(o), m = orbitMarks(o);
  orbitCard(o, jd); // 카드 높이가 값에 따라 정해지므로 재기 전에 채운다
  const w = finalStageW(), f = pxPerRad();
  const fit = orbitFit(o, orbitBox(w), w / 2, viewH / 2, f);
  const up = toScene(v.up), right = toScene(v.right);
  // 타원 중심이 빈 곳 가운데에 보이도록 바라보는 점을 옮긴다(궤도면이 시선에 수직이라 화소 = f·길이/d)
  const target = toScene(m.center).addScaledVector(right, -fit.dx * fit.d / f).addScaledVector(up, fit.dy * fit.d / f);
  flyTo(o.center, { dir: toScene(v.dir), up, target, dist: () => fit.d });
}
const orbV = new THREE.Vector3();
const orbCache = { jd: NaN, key: null, o: null, m: null };
function setLine(line, pts) {
  const arr = line.geometry.attributes.position.array;
  pts.forEach((p, k) => { const q = eclipticToScene(p); arr[k * 3] = q[0]; arr[k * 3 + 1] = q[1]; arr[k * 3 + 2] = q[2]; });
  line.geometry.attributes.position.needsUpdate = true;
}
function updateOrbit(jd) {
  const on = orbitOn();
  orbGroup.visible = on;
  if (!on) { for (const e of orbEls) e.style.display = 'none'; return; }
  if (orbCache.jd !== jd || orbCache.key !== state.orbitKey) {
    const o = orbitOf(state.orbitKey, jd), m = orbitMarks(o);
    Object.assign(orbCache, { jd, key: state.orbitKey, o, m });
    orbitCard(o, jd);
    setLine(orbEllipse, Array.from({ length: ORB_N + 1 }, (_, k) => ellipsePoint(o, (2 * Math.PI * k) / ORB_N)));
    setLine(orbA, [m.center, m.peri]);
    setLine(orbB, [m.center, m.minor]);
    setLine(orbRest, [m.center, m.apo]);
  }
  const { o, m } = orbCache;
  orbGroup.position.copy(byKey[o.center].mesh.position);
  // 점선 간격 — 화면에서 약 6px이 되도록 카메라 거리로 정한다
  orbRest.material.dashSize = orbRest.material.gapSize = camera.position.distanceTo(controls.target) * 6 / pxPerRad();
  orbRest.computeLineDistances();
  const scr = p => projectPoint(orbV.fromArray(eclipticToScene(p)).add(orbGroup.position));
  const S = {
    c: scr(m.center), peri: scr(m.peri), apo: scr(m.apo), minor: scr(m.minor),
    aMid: scr(m.center.map((v, i) => (v + m.peri[i]) / 2)), bMid: scr(m.center.map((v, i) => (v + m.minor[i]) / 2)),
  };
  const inView = q => q.front && q.x > -50 && q.x < stageW + 50 && q.y > -50 && q.y < viewH;
  const put = (e, q, tf) => { if (inView(q)) showAt(e, q.x, q.y, tf); else e.style.display = 'none'; };
  // 선이 화면에서 짧으면 이름이 선을 덮으므로 감춘다
  const aPx = Math.hypot(S.peri.x - S.c.x, S.peri.y - S.c.y), bPx = Math.hypot(S.minor.x - S.c.x, S.minor.y - S.c.y);
  put(orbCross, S.c, '');
  put(orbTags.c, S.c, S.minor.y > S.c.y ? ' translate(-50%, -190%)' : ' translate(-50%, 90%)'); // 단반경 선 반대쪽 — 초점 천체 이름표(같은 높이)를 피해 조금 떨어뜨린다
  if (aPx > 60) put(orbTags.a, S.aMid, ' translate(-50%, -130%)'); else orbTags.a.style.display = 'none';
  if (bPx > 30) put(orbTags.b, S.bMid, ' translate(8px, -50%)'); else orbTags.b.style.display = 'none';
  put(orbDots.peri, S.peri, ''); put(orbDots.apo, S.apo, '');
  // 근점은 왼쪽 끝이라 글자를 오른쪽으로, 원점은 왼쪽으로 펼친다 — 점 아래
  put(orbTags.peri, S.peri, ' translate(-6px, 10px)');
  put(orbTags.apo, S.apo, ' translate(calc(-100% + 6px), 10px)');
}

// 최소·최대 거리(계산 범위 1800~2050 전체) — 위성끼리는 수 초 걸려 웹 워커에서 셈하고 두 천체 짝마다 기억한다.
// 「그때 위치」를 켜면 그 순간 두 천체가 있던 자리를 점으로 찍고 잇는다(몸체는 두지 않는다)
const extEl = document.getElementById('dist-ext');
const extRow = { min: document.getElementById('dist-min'), max: document.getElementById('dist-max') };
const extShowBtn = document.getElementById('dist-ext-show');
const EXT_RANGE = [julianDateTT(VALID_FROM), julianDateTT(VALID_TO)];
const extCache = new Map(); // 「이름순 a|b」 → { pending } | { error } | { min, max } (위치는 장면 좌표, 천체 키로)
let extWorker = null, lastExt = '';
state.extShow = false;
extShowBtn.addEventListener('click', () => {
  state.extShow = !state.extShow;
  extShowBtn.setAttribute('aria-checked', String(state.extShow));
  if (booted) draw();
});
const extKey = (a, b) => [a, b].sort().join('|');
function extDone(id, data) {
  const [p, q] = id.split('|');
  const conv = e => ({ jd: e.jd, km: e.km, pos: { [p]: eclipticToScene(e.a), [q]: eclipticToScene(e.b) } });
  extCache.set(id, data.error ? { error: data.error } : { min: conv(data.result.min), max: conv(data.result.max) });
  lastExt = '';
  if (booted) draw();
}
function requestExt(a, b) {
  const id = extKey(a, b);
  if (extCache.has(id)) return extCache.get(id);
  extCache.set(id, { pending: true });
  try {
    if (!extWorker) {
      extWorker = new Worker(new URL('./extremes_worker.js', import.meta.url), { type: 'module' });
      extWorker.onmessage = ({ data }) => extDone(data.id, data);
      // 워커가 죽으면(모듈 워커를 못 띄우는 브라우저 등) 버린다 — 남겨 두면 다음 짝이 영영 「계산 중…」
      extWorker.onerror = () => {
        extWorker.terminate(); extWorker = null;
        for (const [k, v] of extCache) if (v.pending) extDone(k, { error: '워커' });
      };
    }
    const [p, q] = id.split('|');
    extWorker.postMessage({ id, a: p, b: q, jd0: EXT_RANGE[0], jd1: EXT_RANGE[1] });
  } catch { extDone(id, { error: '워커' }); }
  return extCache.get(id);
}
const extLines = {}, extDots = {}, extTags = {};
for (const k of ['min', 'max']) {
  const line = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)),
    uiAlpha(new THREE.LineBasicMaterial({ color: new THREE.Color(MEASURE), transparent: true, opacity: 0.45, depthWrite: false })));
  line.frustumCulled = false;
  line.renderOrder = 3;
  line.visible = false;
  scene.add(line);
  extLines[k] = line;
  extDots[k] = [el('div', 'xdot'), el('div', 'xdot')];
  extTags[k] = [el('div', 'xlabel'), el('div', 'xlabel')]; // 점마다 「지구(최소)」
  for (const e of [...extDots[k], ...extTags[k]]) { e.style.display = 'none'; labelLayer.appendChild(e); }
}
const extV = new THREE.Vector3();
function projectPoint(v) {
  extV.copy(v).applyMatrix4(camera.matrixWorldInverse);
  const front = extV.z < 0;
  extV.applyMatrix4(camera.projectionMatrix);
  return { x: (extV.x + 1) / 2 * stageW, y: (1 - extV.y) / 2 * stageH, front };
}
const showAt = (e, x, y, tf) => { e.style.display = ''; e.style.transform = `translate(${x}px, ${y}px)${tf}`; };
function updateExt(fp) {
  const [ka, kb] = state.pair.dist;
  const on = distOn() && ka !== kb;
  extEl.hidden = !on;
  const r = on ? requestExt(ka, kb) : null;
  const ready = r && r.min;
  if (on) {
    const s = r.pending ? '계산 중…' : r.error ? '계산하지 못함' : extremeText(r.min) + '|' + extremeText(r.max);
    if (s !== lastExt) {
      const [lo, hi] = ready ? s.split('|') : [s, s];
      extRow.min.textContent = lo; extRow.max.textContent = hi; lastExt = s;
    }
  }
  const show = ready && state.extShow;
  const tags = []; // { x, y, names, words }
  for (const k of ['min', 'max']) {
    extLines[k].visible = !!show;
    for (const e of [...extDots[k], ...extTags[k]]) e.style.display = 'none';
    if (!show) continue;
    // 장면 좌표는 초점 천체가 원점 — 그 순간의 위치에서 지금 초점 위치를 뺀다
    const pts = [ka, kb].map(key => { const p = r[k].pos[key]; return new THREE.Vector3(p[0] - fp[0], p[1] - fp[1], p[2] - fp[2]); });
    const arr = extLines[k].geometry.attributes.position.array;
    pts[0].toArray(arr, 0); pts[1].toArray(arr, 3);
    extLines[k].geometry.attributes.position.needsUpdate = true;
    const sp = pts.map(projectPoint);
    const word = k === 'min' ? '최소' : '최대';
    sp.forEach((p, i) => {
      if (!p.front) return;
      showAt(extDots[k][i], p.x, p.y, '');
      // 이름이 붙을 자리가 이미 있는 이름표와 겹치면(14px 안) 하나로 — 「지구·달(최소)」「지구(최소·최대)」
      const name = byKey[[ka, kb][i]].name;
      const near = tags.find(t => Math.hypot(t.x - p.x, t.y - p.y) < 14);
      if (!near) { tags.push({ x: p.x, y: p.y, names: [name], words: [word], el: extTags[k][i] }); return; }
      if (!near.names.includes(name)) near.names.push(name);
      if (!near.words.includes(word)) near.words.push(word);
    });
  }
  for (const t of tags) {
    t.el.textContent = `${t.names.join('·')}(${t.words.join('·')})`;
    showAt(t.el, t.x, t.y, ' translate(7px, -50%)');
  }
}

// 크기 비교 — 따로 둔 장면에 두 천체를 같은 축척으로 나란히. 북극을 위로(20° 앞으로 기울여 고리가 보이게),
// 경도 0°를 앞으로, 왼쪽 앞 위에서 빛을 비춘다. 몸체 모양·지도는 본 장면의 것을 함께 쓴다
const cmpScene = new THREE.Scene();
cmpScene.add(new THREE.AmbientLight(0xffffff, 0.04));
const cmpLight = new THREE.DirectionalLight(0xffffff, 3); // 해 빛 세기(PointLight 3)와 같은 눈금
cmpLight.position.set(-1, 0.5, 1.2);
cmpScene.add(cmpLight);
const cmpCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2e7);
cmpCam.position.set(0, 0, 1e7);
// 구의 +X(경도 0°)를 카메라 쪽(+Z)으로 돌린 뒤 북극을 카메라 쪽으로 20° 기울인다
const CMP_POSE = new THREE.Quaternion().setFromEuler(new THREE.Euler(20 * Math.PI / 180, -Math.PI / 2, 0, 'XYZ'));
const cmpHead = compareEl.querySelector('.cmp-head');
const cmpRatio = document.getElementById('cmp-ratio');
const cmpTags = ['a', 'b'].map(s => ({ tag: document.getElementById('cmp-tag-' + s), ring: document.getElementById('cmp-ring-' + s) }));
let cmpItems = [], cmpHeadH = 0;
function buildCompare() {
  for (const it of cmpItems) cmpScene.remove(it.obj);
  cmpItems = state.pair.size.map((k, i) => {
    const b = byKey[k];
    const obj = new THREE.Mesh(b.mesh.geometry, b.mesh.material);
    obj.quaternion.copy(CMP_POSE);
    const ring = k === 'saturn' && ringMesh.visible;
    if (ring) obj.add(new THREE.Mesh(ringMesh.geometry, ringMat));
    cmpScene.add(obj);
    const d = diameterOf(b, SHAPED.has(k));
    cmpTags[i].tag.querySelector('b').textContent = b.name;
    cmpTags[i].tag.querySelector('.d').textContent = fmtDiameter(d);
    // 반폭: 토성은 고리 바깥 끝까지
    return { b, obj, ring, d: d.km, w: ring ? RING_EDGES.aOut : b.reach, h: b.reach, half: cmpTags[i].tag.offsetWidth / 2 };
  });
  cmpHeadH = cmpHead.offsetHeight;
  const [A, B] = cmpItems;
  cmpRatio.textContent = ratioText(A.b, A.d, B.b, B.d);
}
// 모양 파일(포보스·데이모스·혜성 핵)·고리 단면이 비교 화면을 연 뒤에 도착하면 새로 짠다
const cmpStale = () => cmpItems.some(it => it.obj.geometry !== it.b.mesh.geometry || (it.b.key === 'saturn' && it.ring !== ringMesh.visible));
function drawCompare() {
  if (cmpStale()) buildCompare();
  const W = stageW, H = stageH;
  const L = compareLayout(cmpItems[0], cmpItems[1], W, cmpHeadH + 12, H - 120);
  cmpCam.left = -W / 2 / L.s; cmpCam.right = W / 2 / L.s;
  cmpCam.top = H / 2 / L.s; cmpCam.bottom = -H / 2 / L.s;
  cmpCam.updateProjectionMatrix();
  const hMax = Math.max(cmpItems[0].h, cmpItems[1].h);
  cmpItems.forEach((it, i) => {
    const x = i ? L.xB : L.xA;
    it.obj.position.set((x - W / 2) / L.s, (H / 2 - L.y) / L.s, 0);
    it.obj.updateMatrixWorld();
    // 토성 고리·지구 밤 불빛이 쓰는 해·카메라 방향을 이 장면 것으로(재질을 본 장면과 함께 쓴다 — 본 장면은 다음 step에서 되돌린다)
    const U = it.b.key === 'saturn' ? ringU : it.b.key === 'earth' ? earthU : null;
    if (U) {
      qInv.copy(it.obj.quaternion).invert();
      U.uSunL.value.copy(cmpLight.position).normalize().applyQuaternion(qInv);
      U.uCamL.value.copy(cmpCam.position).sub(it.obj.position).applyQuaternion(qInv);
    }
    const { tag, ring } = cmpTags[i];
    // 이름표는 천체 밑 가운데 — 화면 끝에서 잘리면 안쪽으로 당긴다
    const tx = Math.min(W - it.half - 8, Math.max(it.half + 8, x));
    tag.style.transform = `translate(${tx}px, ${L.y + hMax * L.s + 10}px) translate(-50%, 0)`;
    // 몇 화소밖에 안 되는 천체는 동그라미로 자리를 보인다
    const tiny = it.h * L.s < 6;
    ring.style.display = tiny ? 'block' : 'none';
    if (tiny) ring.style.transform = `translate(${x}px, ${L.y}px)`;
  });
  renderer.render(cmpScene, cmpCam);
}

// ---------- 혜성 코마·꼬리 ----------
// 식은 src/comets.js(테스트 tests/comets.test.mjs). 먼지 꼬리 = 노란 알갱이(복사압 β별 케플러 운동), 이온 꼬리 = 푸른 곧은 꼬리,
// 코마 = 핵 둘레의 뿌연 머리(기둥 밀도 ∝ 1/ρ). 모두 더하기 섞기(빛을 내거나 흩뜨리는 얇은 기체·먼지라 뒤를 가리지 않는다).
// 밝기: 실제로는 엔케가 헤일-밥보다 수천 배 어두워 화면에서 안 보이므로, 활동량의 로그로 눈금을 줄인다(COMET_GLOW).
// 먼지 알갱이마다의 밝기는 dustTail의 무게(떨어질 때의 활동량 × √β) ÷ 지금 활동량(근일점을 지난 뒤 오래된 알갱이가 더 밝을 수 있다).
const DUST_GAIN = 25, ION_GAIN = 0.3, HEAD_MAX = 2;
const MAX_POINT_PX = Math.min(512, renderer.getContext().getParameter(renderer.getContext().ALIASED_POINT_SIZE_RANGE)[1]);
const COMET_GLOW = q => THREE.MathUtils.clamp((Math.log10(q) - 26) / 5, 0, 1); // 1e26 분자/s에서 0, 1e31에서 1
const DUST_S = dustSamples();
const DUST_N = DUST_S.beta.length, ION_N = 4000;
// 이온 꼬리 표본: 꼬리 길이에 대한 거리 비(지수 분포 — 핵 쪽이 짙다)와 옆 퍼짐(정규 분포 두 개, 멀수록 넓다)
const ION_S = (() => {
  let s = 99; const R = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const g = () => Math.sqrt(-2 * Math.log(R() + 1e-12)) * Math.cos(2 * Math.PI * R());
  return Array.from({ length: ION_N }, () => [Math.min(1, -Math.log(1 - R() * 0.95) / 3), g(), g()]);
})();
const glowVS = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float aW, aS; // 무게 · 알갱이 덩이 크기(km — 핵에서 멀수록 넓게 퍼진다)
  uniform float uPpr, uSize, uGain, uMaxPx; // uMaxPx: 이 GPU의 가장 큰 점 크기 · uSize: 밝기 기준 크기(km) — 덩이가 크면 같은 빛이 넓게 퍼져 (uSize/aS)²로 흐려진다
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float px = aS * uPpr / max(-mv.z, 1e-3);
    float cp = clamp(px, 2.0, uMaxPx);
    vA = aW * uGain * (uSize / aS) * (uSize / aS) * min(1.0, (px / cp) * (px / cp)); // 2px보다 작게 보이면 크기 대신 밝기를 줄인다
    gl_PointSize = cp;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }`;
const glowFS = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColor;
  varying float vA;
  void main() {
    #include <logdepthbuf_fragment>
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float d2 = dot(c, c);
    if (d2 > 1.0) discard;
    gl_FragColor = vec4(uColor * exp(-3.0 * d2) * (1.0 - d2) * (1.0 - d2) * vA, 1.0); // 가장자리에서 0 — 겹친 덩이의 테두리가 안 보이게
  }`;
const glowMat = (color, gain) => new THREE.ShaderMaterial({
  uniforms: { uPpr: { value: 1 }, uSize: { value: 1 }, uGain: { value: gain }, uMaxPx: { value: MAX_POINT_PX }, uColor: { value: new THREE.Color(color) } },
  vertexShader: glowVS, fragmentShader: glowFS,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, // 깊이 판정은 한다(drawGlow가 먼저 그린 몸체 깊이)
});
// 코마: 카메라를 향한 사각형(정점 셰이더에서 화면 쪽으로 편다). ρ/Rc로 밝기 ∝ (1/ρ)·exp(−ρ/Rc)
const comaMat = () => new THREE.ShaderMaterial({
  uniforms: { uR: { value: 1 }, uGain: { value: 0 }, uColor: { value: new THREE.Color(0xd9efe4) } },
  vertexShader: /* glsl */`
    #include <common>
    #include <logdepthbuf_pars_vertex>
    uniform float uR;
    varying vec2 vQ;
    void main() {
      vQ = position.xy * 4.0; // 사각형은 코마 반지름의 4배까지
      vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      mv.xy += position.xy * uR * 4.0;
      gl_Position = projectionMatrix * mv;
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */`
    #include <common>
    #include <logdepthbuf_pars_fragment>
    uniform float uGain; uniform vec3 uColor;
    varying vec2 vQ;
    void main() {
      #include <logdepthbuf_fragment>
      float r = length(vQ);
      if (r > 4.0) discard;
      float I = 0.025 / max(r, 0.02) * exp(-r) * (1.0 - smoothstep(3.0, 4.0, r));
      gl_FragColor = vec4(uColor * I * uGain, 1.0);
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, // 깊이 판정은 한다(drawGlow가 먼저 그린 몸체 깊이)
});
// 코마·꼬리는 따로 모아(반정밀 부동소수 화면) 1 − e^(−x)로 눌러 본 장면 위에 더한다 — 핵 근처처럼 겹쳐 아주 밝은 곳이
// 하얗게 뭉개지지 않게(눈·사진기처럼 밝은 곳일수록 덜 밝아짐). 이 화면에는 본 장면 깊이를 옮길 수 없어서 몸체(OCCLUDE 층)를
// 깊이로만 먼저 그리고 꼬리를 깊이 판정한다 — 행성·위성 뒤의 꼬리가 가려진다. 고리는 반투명이라 넣지 않았다(고리 뒤 꼬리는 그대로 비친다)
const glowScene = new THREE.Scene();
// 반정밀 부동소수 화면에 그릴 수 없는 GPU(일부 옛 모바일)는 8비트로 — 밝은 곳이 1에서 잘리지만 꼬리는 보인다
const GLOW_TYPE = LINEAR ? THREE.HalfFloatType : THREE.UnsignedByteType;
const glowRT = new THREE.WebGLRenderTarget(1, 1, { type: GLOW_TYPE, depthBuffer: true, samples: 4 }); // 다중 표본 — 행성 가장자리에서 꼬리가 계단지지 않게
const occludeMat = new THREE.MeshBasicMaterial({ colorWrite: false });
const glowQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: { tGlow: { value: glowRT.texture } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */`
    #include <common>
    uniform sampler2D tGlow; varying vec2 vUv;
    void main() {
      vec3 x = texture2D(tGlow, vUv).rgb;
      gl_FragColor = vec4(1.0 - exp(-x), 1.0);
      #include <colorspace_fragment>
    }`,
  depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
}));
glowQuad.frustumCulled = false;
const glowQuadScene = new THREE.Scene().add(glowQuad);
const glowCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
function drawGlow() {
  if (!comets.some(C => C.dust.visible || C.coma.visible)) return;
  const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha(), ac = renderer.autoClear;
  renderer.autoClear = false; // 두 번째 그리기가 먼저 그린 몸체 깊이를 지우지 않게
  renderer.setRenderTarget(glowRT);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  // 몸체 깊이만 먼저(색은 안 씀) — 배경·조명·선·점은 OCCLUDE 층이 아니라 빠진다
  const bg = scene.background;
  scene.background = null; scene.overrideMaterial = occludeMat; camera.layers.set(OCCLUDE);
  renderer.render(scene, camera);
  scene.background = bg; scene.overrideMaterial = null; camera.layers.set(0);
  renderer.render(glowScene, camera);
  renderer.setRenderTarget(null);
  renderer.setClearColor(cc, ca); // 배경이 없는 크기 비교 장면이 투명하게 지워지지 않게
  renderer.render(glowQuadScene, glowCam);
  renderer.autoClear = ac;
}
// ---------- 태양 렌즈 효과 ----------
// 본 장면 위에 화면 겹침으로 더한다(가산). 식·표는 src/flare.js.
// 후광(블룸)은 원반 크기를 따라 커지고 늘 켜 둔다(노출 × 보이는 비율). 회절 광선은 쓰지 않는다. 넘친 핵·유령·베일은 화면 높이 기준 크기이고
// 원반이 화면을 채우면 줄인다. 가림은 깊이 버퍼가 아니라 몸체 타원체에 선분을 쏘아 낸다(GPU에서 읽어 오면 멈칫해서) — 고리·혜성 꼬리는 가리지 않는다
const flareU = {
  uSun: { value: new THREE.Vector2() }, uH: { value: 1 }, uRs: { value: 0 },
  uCore: { value: 1 }, uVeil: { value: 1 }, uGain: { value: 0 }, uGhostGain: { value: 0 }, uBloom: { value: 0 }, uSig: { value: BLOOM.map(() => 1) },
  uG: { value: GHOSTS.map(() => new THREE.Vector4()) }, uGC: { value: GHOSTS.map(g => new THREE.Vector3(...g.color)) },
};
const v3 = a => `vec3(${a.map(x => x.toFixed(3)).join(', ')})`;
const flareQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: flareU,
  vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */`
    #include <common>
    #define NG ${GHOSTS.length}
    uniform vec2 uSun; uniform float uH, uRs, uGain, uGhostGain, uBloom, uCore, uVeil; uniform float uSig[${BLOOM.length}];
    uniform vec4 uG[NG]; uniform vec3 uGC[NG];
    void main() {
      vec2 d = gl_FragCoord.xy - uSun;
      float rho = length(d);
      float e = max(rho - uRs, 0.0);   // 원반 가장자리 밖 거리(px) — 원반 안은 0
      float r = e / uH;
      // 후광(블룸): 원반 크기 + 화면 높이에 비례하는 네 겹(flare.js BLOOM·bloomScales) — 바깥 겹이 광선 자리를 덮는다
      vec3 bloom = ${BLOOM.map((g, i) => `${g.k.toFixed(3)} * exp(-e / uSig[${i}]) * ${v3(g.color)}`).join(' + ')};
      // 넘친 핵(하얗게 찬 둥근 자리) · 베일 글레어(태양 둘레 넓은 연자줏빛 안개, 화면 전체)
      float core = 5.0 * exp(-(e * e) / (uCore * uCore)); // 폭은 flare.js coreSigma(원반이 크면 줄임)
      vec3 veil = vec3(0.09, 0.045, 0.13) * exp(-r / 0.1) + vec3(0.04, 0.026, 0.06) * exp(-r / 0.35) + vec3(0.004, 0.003, 0.006); // 핵 둘레 자줏빛 + 넓은 안개 + 바닥
      vec3 x = uBloom * bloom + uGain * (vec3(1.0, 0.98, 0.95) * core + uVeil * veil);
      // 렌즈 유령: 속이 옅게 찬 원반 + 밝은 가장자리 고리(색마다 반지름이 조금 다른 무지갯빛)
      for (int i = 0; i < NG; i++) {
        float q = length(gl_FragCoord.xy - uG[i].xy) / uG[i].z;
        float disk = 1.0 - smoothstep(0.88, 1.0, q);
        vec3 qq = vec3(q - 0.96, q - 0.93, q - 0.90);
        vec3 rim = exp(-qq * qq / (0.04 * 0.04));
        x += uGhostGain * uG[i].w * uGC[i] * (0.35 * disk * (0.4 + 0.6 * q * q) + 0.45 * rim);
      }
      gl_FragColor = vec4(1.0 - exp(-x), 1.0);
      #include <colorspace_fragment>
    }`,
  depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
}));
flareQuad.frustumCulled = false;
const flareScene = new THREE.Scene().add(flareQuad);
const _fv = new THREE.Vector3(), _fs = new THREE.Vector2();
function occluders() {
  const list = [];
  for (const b of bodies) {
    if (b.key === 'sun' || !b.mesh.visible) continue;
    const radii = SHAPED.has(b.key) ? [b.reach, b.reach, b.reach]
      : b.abc ? [b.abc[0], b.abc[2], b.abc[1]] : b.parent ? [b.radius, b.radius, b.radius] : [b.re, b.rp, b.re];
    const p = b.mesh.position, q = b.mesh.quaternion;
    list.push({ c: [p.x, p.y, p.z], radii, q: [q.x, q.y, q.z, q.w] });
  }
  return list;
}
// 지금 화면의 렌즈 효과 값(자동 확인용으로도 쓴다)
const _fr = new THREE.Vector3();
function flareState() {
  const sun = byKey.sun;
  renderer.getDrawingBufferSize(_fs);
  const W = _fs.x, H = _fs.y, pr = renderer.getPixelRatio(), Hv = viewH * pr; // 크기 기준은 조작부 위 보이는 높이
  camera.updateMatrixWorld();
  const P = camera.projectionMatrix.elements;
  _fv.copy(sun.mesh.position).applyMatrix4(camera.matrixWorldInverse);
  const p = flareScreen([_fv.x, _fv.y, _fv.z], P, W, H);
  const c = flareScreen([0, 0, -1], P, W, H); // 광학 중심
  const cam = camera.position, sp = sun.mesh.position;
  const dist = cam.distanceTo(sp);
  // 원반 반지름(px): 시선에 수직인 방향으로 각반지름만큼 비킨 점을 투영한 거리
  let rs = 0;
  if (p && dist > sun.reach) {
    _fr.set(-_fv.z, 0, _fv.x).normalize().multiplyScalar(_fv.length() * Math.tan(Math.asin(sun.reach / dist))).add(_fv);
    const q = flareScreen([_fr.x, _fr.y, _fr.z], P, W, H);
    rs = q ? Math.hypot(q[0] - p[0], q[1] - p[1]) : 0;
  }
  const vis = p ? visibleFraction([cam.x, cam.y, cam.z], [sp.x, sp.y, sp.z], sun.reach, occluders()) : 0;
  const gain = flareGain(p, W, H, dist, sun.reach, camera.fov, vis, rs);
  const bloom = bloomGain(p, W, H, dist, sun.reach, vis, rs);
  return { p, c, W, H, Hv, rs, vis, gain, bloom, dist };
}
function drawFlare() {
  if (!state.layers.sunFlare || state.tool) return;
  const f = flareState();
  if (!(f.gain > 0.002 || f.bloom > 0.002)) return;
  flareU.uSun.value.set(f.p[0], f.H - f.p[1]);
  flareU.uH.value = f.Hv;
  flareU.uRs.value = f.rs;
  flareU.uCore.value = coreSigma(f.rs, f.Hv, f.dist);
  flareU.uVeil.value = veilScale(f.dist);
  flareU.uGain.value = f.gain;
  flareU.uGhostGain.value = 0.35 * f.gain;
  flareU.uBloom.value = f.bloom;
  flareU.uSig.value = bloomScales(f.rs, f.Hv, f.dist);
  ghosts(f.p, f.c, f.Hv).forEach((g, i) => flareU.uG.value[i].set(g.x, f.H - g.y, g.r, g.a));
  const ac = renderer.autoClear;
  renderer.autoClear = false;
  renderer.render(flareScene, glowCam);
  renderer.autoClear = ac;
}
const comets = COMETS.map(c => {
  const b = byKey[c.key];
  const dust = new THREE.Points(new THREE.BufferGeometry(), glowMat(0xffdca0, 0.5));
  dust.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST_N * 3), 3));
  dust.geometry.setAttribute('aW', new THREE.BufferAttribute(new Float32Array(DUST_N), 1));
  dust.geometry.setAttribute('aS', new THREE.BufferAttribute(new Float32Array(DUST_N), 1));
  const ion = new THREE.Points(new THREE.BufferGeometry(), glowMat(0x6fa8ff, 0.35));
  ion.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ION_N * 3), 3));
  ion.geometry.setAttribute('aW', new THREE.BufferAttribute(new Float32Array(ION_N).fill(1), 1));
  ion.geometry.setAttribute('aS', new THREE.BufferAttribute(new Float32Array(ION_N), 1));
  const coma = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), comaMat());
  for (const o of [dust, ion, coma]) { o.frustumCulled = false; o.visible = false; glowScene.add(o); }
  return { b, key: c.key, dust, ion, coma, state: stateFrom(jd => smallBodyHelio(c.key, jd)), jd: NaN, dw: new Float32Array(DUST_N) };
});
function updateComets(jd) {
  const ppr = pxPerRad();
  for (const C of comets) {
    const { b, dust, ion, coma } = C;
    const s = C.state(jd), rAU = Math.hypot(...s.r) / AU_KM, q = production(C.key, rAU);
    // 핵에 바짝 다가가면(핵 크기의 300~30,000배) 코마·꼬리를 걷어 핵이 보이게 한다
    const camD = b.mesh.position.distanceTo(camera.position);
    const near = THREE.MathUtils.smoothstep(Math.log10(camD / b.reach), 2.5, 4.5);
    const glow = COMET_GLOW(q) * near;
    const on = b.mesh.visible && glow > 0.005;
    dust.visible = ion.visible = coma.visible = on;
    if (!on) continue;
    for (const o of [dust, ion, coma]) o.position.copy(b.mesh.position);
    const L = ionLength(C.key, rAU), Rc = comaRadius(C.key, rAU);
    coma.material.uniforms.uR.value = Rc;
    if (!(Math.abs(jd - C.jd) < 0.01)) { // 0.01일(약 14분)보다 적게 흐르면 다시 계산하지 않는다(점 무리와 같은 기준)
      C.jd = jd;
      // 먼지: 핵 기준 황도 좌표 → 장면 좌표
      const pos = dust.geometry.attributes.position.array, aw = dust.geometry.attributes.aW.array, tmp = C.tmp ??= new Float32Array(DUST_N * 3);
      dustTail(C.key, jd, C.state, DUST_S, tmp, C.dw, s);
      const as = dust.geometry.attributes.aS.array;
      let head = 0; // 핵 자리에 겹치는 덩이들의 밝기 합(셰이더와 같은 식, 이득 1) — 노출 맞춤용
      for (let k = 0; k < DUST_N; k++) {
        const x = tmp[k * 3], y = tmp[k * 3 + 1], z = tmp[k * 3 + 2], r = Math.sqrt(x * x + y * y + z * z);
        pos[k * 3] = x; pos[k * 3 + 1] = z; pos[k * 3 + 2] = -y; // 황도 → 장면 (ephemeris.js eclipticToScene)
        aw[k] = Math.min(3, C.dw[k] / q);
        as[k] = Math.max(Rc, 0.4 * r);
        const d2 = (2 * r / as[k]) ** 2;
        if (d2 < 1) head += aw[k] * (Rc / as[k]) ** 2 * Math.exp(-3 * d2) * (1 - d2) ** 2;
      }
      C.head = head;
      C.dustSize = Rc;
      dust.geometry.attributes.position.needsUpdate = dust.geometry.attributes.aW.needsUpdate = dust.geometry.attributes.aS.needsUpdate = true;
      // 이온: 꼬리 축 u와 그에 수직인 두 방향
      const u = ionDirection(s.r, s.v), a = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const e1 = [u[1] * a[2] - u[2] * a[1], u[2] * a[0] - u[0] * a[2], u[0] * a[1] - u[1] * a[0]], n1 = Math.hypot(...e1);
      for (let i = 0; i < 3; i++) e1[i] /= n1;
      const e2 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
      const ip = ion.geometry.attributes.position.array, is = ion.geometry.attributes.aS.array, p = [0, 0, 0];
      for (let k = 0; k < ION_N; k++) {
        const [f, g1, g2] = ION_S[k], d = f * L, w = 0.004 * L + 0.04 * d;
        for (let i = 0; i < 3; i++) p[i] = u[i] * d + (e1[i] * g1 + e2[i] * g2) * w;
        ip[k * 3] = p[0]; ip[k * 3 + 1] = p[2]; ip[k * 3 + 2] = -p[1];
        is[k] = 3 * w;
      }
      C.ionSize = 0.012 * L;
      ion.geometry.attributes.position.needsUpdate = ion.geometry.attributes.aS.needsUpdate = true;
    }
    // 노출: 먼지 꼬리 머리(핵 자리)는 꼬리 끝보다 1,000배 넘게 밝다. 멀리서는 머리가 몇 화소라 그대로 두고(작은 흰 점),
    // 머리(코마 반지름)가 화면에서 4px → 화면 높이의 10%로 커지는 동안 사진기처럼 노출을 줄여(로그로 이어짐) 머리 밝기를 HEAD_MAX에 맞춘다
    const headPx = Rc / camD * ppr;
    const fill = THREE.MathUtils.clamp(Math.log(headPx / 4) / Math.log(0.1 * viewH / 4), 0, 1);
    const expo = Math.pow(Math.min(1, HEAD_MAX / (DUST_GAIN * glow * C.head + 1e-9)), fill);
    coma.material.uniforms.uGain.value = glow * expo;
    for (const [o, size] of [[dust, C.dustSize], [ion, C.ionSize]]) {
      o.material.uniforms.uPpr.value = ppr * renderer.getPixelRatio(); // gl_PointSize는 그리기 버퍼 화소
      o.material.uniforms.uSize.value = size;
      o.material.uniforms.uGain.value = o === dust ? DUST_GAIN * glow * expo : ION_GAIN * glow * Math.sqrt(expo); // 이온 꼬리는 머리가 밝지 않아 덜 줄인다
    }
  }
}

// ---------- 한 장면 ----------
// 햇빛 노출: 모든 몸체(태양 빼고)의 직접광에 몸체별 배율 uExpo를 곱한다 — 식은 exposure.js. 토성·지구는 앞서 단 패치 위에 겹친다.
// 정반사는 끈다(램버트만): MeshStandardMaterial은 거칠기 1이어도 F0=0.04 정반사가 반사율과 상관없이 약 0.009를 더해,
// 이아페투스 어두운 쪽(반사율 약 0.02)이 밝은 쪽의 1/10이 아니라 1/6으로 보였다(2026-11-27, 끄면 화면 0.117 · 지도 0.114).
// 프로그램 캐시 열쇠는 onBeforeCompile 글자를 쓰므로 몸체마다 따로 준다(안 그러면 서로 다른 패치가 한 프로그램을 같이 쓴다).
for (const b of bodies) {
  if (b.key === 'sun') continue;
  const mat = b.mesh.material, prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uExpo = b.expo; sh.uniforms.uFlat = flatU; sh.uniforms.uGain = { value: b.albedo.gain };
    // 주변광(밤면이 아주 조금 보이게 하는 0.04)에도 밝기 배율(albedo.js gain)만 곱한다 — 안 곱하면 배율이 작은 천체(금성)일수록
    // 주변광 몫이 커져 혼자 볼 때 밝기가 고르지 않다(2026-11-27 화면: 금성 +14%)
    sh.fragmentShader = 'uniform float uExpo; uniform float uFlat; uniform float uGain;\n' + sh.fragmentShader.replace('#include <lights_fragment_end>',
      '#include <lights_fragment_end>\nreflectedLight.directDiffuse *= uExpo; reflectedLight.directSpecular = vec3(0.0); reflectedLight.indirectDiffuse *= uGain;\n' +
      // 그림자 끔: 밤면(N·L이 작은 곳)을 N·L = 0.5 밝기까지 끌어올린다. 낮 쪽은 그대로, 경계는 이어진다(해 빛 세기 3은 PointLight와 같은 눈금)
      'if (uFlat > 0.5) reflectedLight.directDiffuse = max(reflectedLight.directDiffuse, diffuseColor.rgb * (1.5 / PI) * uExpo);');
  };
  mat.customProgramCacheKey = () => 'expo:' + b.key;
}
function updateExposure(fp) {
  const sp = byKey.sun.pos;
  const dRef = refDistance(Math.hypot(fp[0] - sp[0], fp[1] - sp[1], fp[2] - sp[2]));
  // 초점의 반사율 기준(태양을 볼 때는 지구 기준 — 1AU에서 지구가 혼자 볼 때 밝기로)
  const refOf = k => (k === 'sun' ? byKey.earth : byKey[k]).albedo.ref;
  const refF = expoMix ? Math.exp(Math.log(refOf(expoMix.from)) * (1 - expoMix.m) + Math.log(refOf(expoMix.to)) * expoMix.m) : refOf(state.focus);
  for (const b of bodies) {
    if (b.key === 'sun') continue;
    b.expo.value = b.albedo.gain * (state.tool === 'size' ? 1
      : lightScale(dRef, Math.hypot(b.pos[0] - sp[0], b.pos[1] - sp[1], b.pos[2] - sp[2]), albedoRatio(b.albedo.ref, refF)));
  }
}
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
  updateExposure(fp);
  const ppr = pxPerRad();
  const L = state.layers;
  for (const b of bodies) {
    const rel = [b.pos[0] - fp[0], b.pos[1] - fp[1], b.pos[2] - fp[2]];
    b.mesh.position.set(rel[0], rel[1], rel[2]);
    if (b.key === 'sun') sunLight.position.copy(b.mesh.position);
    // 날아가는 동안에는 출발한 천체도 남긴다(레이어를 끈 천체에서 떠날 때 갑자기 사라지지 않게)
    const layerShown = bodyShown(bodies, b.key, L, state.focus) || b.key === state.fly?.from;
    b.mesh.visible = layerShown || toolShows(b.key); // 거리 재기로 고른 천체는 몸체만 보이고 궤도선은 레이어를 따른다
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
      b.trail.visible = layerShown && L.trails && op > 0.01;
      b.orbitLine.visible = layerShown && L.orbits && op > 0.01;
      if (b.trail.visible || b.orbitLine.visible) updateTrail(b, jd); // 안 보이는 궤도선은 다시 계산하지 않는다
      b.trail.position.copy(b.mesh.position);
      b.orbitLine.position.copy(b.mesh.position);
    }
  }
  if (!state.fly) controls.update();
  else camera.lookAt(controls.target);
  camera.updateMatrixWorld();
  updateClock();
  if (state.tool === 'size') return; // 크기 비교 중에는 본 장면을 그리지 않는다 — 위치·시각만 이어 간다
  updateClouds(jd);
  updateComets(jd);
  updateEarthAtmo();
  updateRings(); updateHaumeaRing(); updateJovianRings(jd); // 이번 장면의 카메라 위치로(고리 앞·뒷면 판정)
  updateSky(updateGroupLabels(updateLabels()));
  updateDist();
  updateExt(fp);
  updateOrbit(jd);
}

// 본 장면(또는 크기 비교) → sceneRT(선형) → 화면용으로 바꿔 캔버스에. 혜성 코마·꼬리와 렌즈 효과는 그 위에 예전처럼 더한다
const sceneRT = LINEAR ? new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true, samples: 4 }) : null;
const blitScene = new THREE.Scene().add(Object.assign(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: { tScene: { value: sceneRT?.texture ?? null } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */`
    #include <common>
    uniform sampler2D tScene; varying vec2 vUv;
    void main() {
      gl_FragColor = vec4(clamp(texture2D(tScene, vUv).rgb, 0.0, 1.0), 1.0);
      #include <colorspace_fragment>
    }`,
  depthTest: false, depthWrite: false, blending: THREE.NoBlending,
})), { frustumCulled: false }));
function draw() {
  const size = state.tool === 'size';
  if (sceneRT) renderer.setRenderTarget(sceneRT);
  if (size) drawCompare(); else renderer.render(scene, camera);
  if (sceneRT) { renderer.setRenderTarget(null); renderer.render(blitScene, glowCam); }
  if (!size) { drawGlow(); drawFlare(); }
}

// 무대 크기에 맞추고, 화면 중심을 조작부 위 보이는 영역의 가운데로 옮긴다(세로 화각 45°도 그 영역 기준)
const panelEl = document.getElementById('panel');
function resize() {
  stageW = Math.max(1, stageEl.clientWidth); stageH = Math.max(1, stageEl.clientHeight);
  viewH = Math.max(100, stageH - panelEl.offsetHeight);
  stageEl.style.setProperty('--panel-h', panelEl.offsetHeight + 'px');
  renderer.setSize(stageW, stageH, false);
  { const v = renderer.getDrawingBufferSize(new THREE.Vector2()); glowRT.setSize(v.x, v.y); sceneRT?.setSize(v.x, v.y); }
  camera.aspect = stageW / viewH;
  camera.setViewOffset(stageW, viewH, 0, 0, stageW, stageH);
  camera.updateProjectionMatrix();
}
// 창 크기·사이드바 밀어내기(0.25초 동안 폭이 바뀜)·조작부 높이가 늦게 잡히는 경우 모두 관찰자가 잡는다.
// setSize는 캔버스를 비우므로 그 자리에서 다시 그린다 — 안 그리면 전환 중에 검은 화면이 깜빡인다
function refit() {
  resize();
  if (state.tool === 'dist') distTop = distEl.offsetTop;
  if (state.tool === 'size') cmpHeadH = cmpHead.offsetHeight;
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

// 처음 화면: 목성형 행성 보기(해왕성 궤도까지 = 예전 「태양계 전체」)
camera.position.copy(OVERVIEW_DIR).multiplyScalar(overviewDist());
controls.minDistance = byKey.sun.reach * 1.15;
state.view = 'jovian';
updatePositions(julianDateTT(state.simMs));
markFocus();
applyAtmosphere();

booted = true;
renderer.setAnimationLoop(t => { step(t); draw(); });

// 자동 확인용(백그라운드 탭에서는 requestAnimationFrame이 돌지 않는다)
window.__app = { flareState, controls, comets, renderer, glowRT, state, step, draw, flyTo, camera, bodies: byKey, RATES, applyAtmosphere, setSidebar, setLayers, setLayer, cloud, oort, skyLines, VIEWS, chooseView, choose, setTool, distLine, cmpScene };
