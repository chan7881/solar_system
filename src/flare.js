// 태양 렌즈 효과 — 화면 겹침에 쓰는 순수 함수(three.js 없음). 화면은 main.js 「태양 렌즈 효과」.
// 실제 카메라로 태양을 찍으면 겹치는 것: 넘친 핵과 후광(블룸) · 렌즈 유령 · 베일 글레어 ·
// 태양이 화면 밖이어도 남는 후광과 유령. 회절 광선은 쓰지 않는다(2026-11-22 사용자 결정 — 그 자리는 넓은 후광이 맡는다). 크기는 화면 높이 기준(렌즈 효과라서 거리와 무관), 세기는 노출처럼 다룬다.
import { AU_KM } from './ephemeris.js';

// ---------- 태양의 화면 위치 ----------
// v: 카메라 좌표의 점(카메라는 −z를 본다), P: 투영 행렬 16개(three.js elements, 열 우선), W·H: 화면 픽셀.
// 화면 밖이어도 좌표를 낸다(후광·유령이 남도록). 카메라 뒤(z ≥ 0)이면 null.
export function toScreen(v, P, W, H) {
  const cx = P[0] * v[0] + P[4] * v[1] + P[8] * v[2] + P[12];
  const cy = P[1] * v[0] + P[5] * v[1] + P[9] * v[2] + P[13];
  const cw = P[3] * v[0] + P[7] * v[1] + P[11] * v[2] + P[15];
  if (!(cw > 0)) return null; // 원근 투영에서 cw = −z
  return [(cx / cw + 1) / 2 * W, (1 - cy / cw) / 2 * H]; // 위가 y=0
}

// ---------- 렌즈 유령 ----------
// 유령은 태양과 광축(화면의 광학 중심)을 잇는 직선 위에 생긴다: 중심 + k·(태양 − 중심).
// k < 0은 중심 너머 태양 반대편. size는 화면 높이에 대한 반지름, a는 상대 밝기.
export const GHOSTS = [
  { k: 0.72, size: 0.012, a: 0.55, color: [0.35, 1.0, 0.45] },
  { k: 0.55, size: 0.032, a: 0.30, color: [0.30, 0.95, 0.60] },
  { k: 0.28, size: 0.016, a: 0.35, color: [0.40, 0.85, 1.0] },
  { k: 0.12, size: 0.008, a: 0.50, color: [1.0, 0.75, 0.35] },
  { k: -0.18, size: 0.022, a: 0.25, color: [0.30, 0.90, 0.85] },
  { k: -0.42, size: 0.045, a: 0.16, color: [0.95, 0.35, 0.80] },
  { k: -0.75, size: 0.11, a: 0.07, color: [0.45, 0.40, 1.0] },
  { k: -1.05, size: 0.05, a: 0.12, color: [1.0, 0.40, 0.45] },
];
// p: 태양 화면 위치, c: 광학 중심(픽셀), H: 화면 높이. 반환은 유령마다 위치·반지름(px)·밝기.
// 태양이 중심에서 멀수록(빛이 렌즈에 비스듬히 들수록) 유령이 흐려진다 — 화면 높이만큼 벗어나면 절반.
export function ghosts(p, c, H) {
  const dx = p[0] - c[0], dy = p[1] - c[1];
  const off = Math.hypot(dx, dy) / H;
  const fade = 1 / (1 + off * off);
  return GHOSTS.map(g => ({ x: c[0] + g.k * dx, y: c[1] + g.k * dy, r: g.size * H, a: g.a * fade, color: g.color }));
}

// ---------- 후광(블룸) ----------
// 밝은 원반의 빛이 렌즈·센서에서 번진 것. 원반 가장자리 밖 거리 e(px)에 대해 세 겹의 지수 감쇠.
// 폭은 원반 반지름 rs(px)에 비례하는 몫 + 화면 높이에 비례하는 몫 — 멀어 원반이 점이어도 번짐이 남고,
// 다가가 원반이 커지면 후광도 같이 커진다. 바깥 두 겹(화면 높이 0.1·0.22)이 예전 광선 자리를 덮는다. 렌즈 효과(유령)와 달리 원반이 화면을 채워도 끄지 않는다.
export const BLOOM = [
  { a: 0.04, b: 0.01, k: 0.7, color: [1.0, 0.97, 0.9] },
  { a: 0.15, b: 0.04, k: 0.4, color: [1.0, 0.9, 0.74] },
  { a: 0.3, b: 0.1, k: 0.2, color: [1.0, 0.82, 0.62] },
  { a: 0.5, b: 0.22, k: 0.07, color: [0.95, 0.75, 0.62] },
];
// 번짐의 「화면 높이 몫」은 원반이 점이든 5px이든 같은 몫(GLOW_SHRINK_MIN)이다 — 예전엔 원반이 5px보다 작을수록 몫이 커져(최대 3.3배)
// 멀리서 번짐이 원반 각크기보다 훨씬 컸다. 거기에 태양이 1AU보다 멀면 받는 빛이 1/거리²로 줄어드는 만큼 번짐 폭도 줄인다
// (사진기 점광원의 번진 반지름은 밝기의 로그로 변한다): (1AU/거리)^GLOW_DIST_EXP, 하한 GLOW_DIST_MIN. 거리를 안 주면 1AU(줄임 없음).
export const GLOW_SHRINK_MIN = 0.3;
export const GLOW_DIST_EXP = 0.3;
export const GLOW_DIST_MIN = 0.25;
export function glowShrink(rs, Hv, dist = AU_KM) {
  const f = dist > AU_KM ? Math.max(GLOW_DIST_MIN, (AU_KM / dist) ** GLOW_DIST_EXP) : 1;
  return GLOW_SHRINK_MIN * f;
}
export function bloomScales(rs, Hv, dist = AU_KM) { const k = glowShrink(rs, Hv, dist); return BLOOM.map(g => g.a * rs + g.b * Hv * k); }
// 베일(보라 안개)의 세기 배율: 1AU 안쪽은 1, 멀면 (1AU/거리)^VEIL_DIST_EXP(하한 VEIL_DIST_MIN) — 30AU에서 약 0.19
export const VEIL_DIST_EXP = 0.5;
export const VEIL_DIST_MIN = 0.05;
export function veilScale(dist) { return dist > AU_KM ? Math.max(VEIL_DIST_MIN, (AU_KM / dist) ** VEIL_DIST_EXP) : 1; }
// 넘친 핵(하얗게 찬 둥근 자리)의 가우스 폭(px): 같은 규칙으로 줄인다
export const CORE_SIGMA = 0.032;
export function coreSigma(rs, Hv, dist = AU_KM) { return CORE_SIGMA * Hv * glowShrink(rs, Hv, dist); }
// 원반 반지름(px): 거리 dist에서 반지름 sunR의 각반지름을, 세로 화각 fovY·화면 높이 H(px)로 옮긴다
export function sunRadiusPx(dist, sunR, fovY, H) {
  if (!(dist > sunR)) return Infinity;
  return (H / 2) * Math.tan(Math.asin(sunR / dist)) / Math.tan(fovY * Math.PI / 360);
}
// e(px)에서의 후광 밝기(색 빼고) — 원반 안(e=0)과 가장자리가 이어진다
export function bloomAt(e, rs, Hv) {
  const s = bloomScales(rs, Hv);
  return BLOOM.reduce((sum, g, i) => sum + g.k * Math.exp(-Math.max(0, e) / s[i]), 0);
}

// ---------- 가림 ----------
// 태양 원반 위에 넓이가 고르게 퍼진 표본 점을 놓고, 카메라에서 그 점까지의 선분이 다른 몸체에 막히는지 본다.
// 반환은 보이는 비율(0~1) — 지구 가장자리 뒤에서 떠오를 때 서서히 커진다.
// cam·sun: 장면 좌표, sunR: 태양 반지름, occ: [{ c: 중심, radii: [x,y,z] 몸체 축 반지름, q: 몸체 → 장면 회전 사원수 [x,y,z,w] | null }]
export const OCC_RINGS = [1, 6, 12, 18]; // 가운데 1점 + 고리 셋 = 37점
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; }
// 사원수 q의 역회전(장면 → 몸체): v' = v + 2w(u×v) + 2u×(u×v), u = −(x,y,z)
export function unrotate(v, q) {
  if (!q) return v;
  const [x, y, z, w] = q, u = [-x, -y, -z];
  const t = cross(u, v).map(e => 2 * e);
  const s = cross(u, t);
  return [v[0] + w * t[0] + s[0], v[1] + w * t[1] + s[1], v[2] + w * t[2] + s[2]];
}
export function sunSamples(cam, sun, sunR) {
  const f = norm(sub(sun, cam));
  const a = Math.abs(f[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = norm(cross(f, a)), e2 = cross(f, e1);
  const pts = [], N = OCC_RINGS.reduce((s, n) => s + n, 0);
  let k = 0, ring = 0;
  for (const n of OCC_RINGS) {
    // 고리 반지름은 그 고리가 맡은 넓이 몫의 가운데(누적 넓이 비율의 제곱근)
    const r = n === 1 ? 0 : sunR * Math.sqrt((k + n / 2) / N);
    for (let i = 0; i < n; i++) {
      const th = (i + 0.5 * (ring % 2)) / n * 2 * Math.PI;
      pts.push([0, 1, 2].map(j => sun[j] + r * (Math.cos(th) * e1[j] + Math.sin(th) * e2[j])));
    }
    k += n; ring++;
  }
  return pts;
}
// 선분 o → o+d(0 < t < 1)가 타원체에 닿는지
function segHits(o, d, b) {
  const lo = unrotate(sub(o, b.c), b.q), ld = unrotate(d, b.q);
  const s = [lo[0] / b.radii[0], lo[1] / b.radii[1], lo[2] / b.radii[2]];
  const e = [ld[0] / b.radii[0], ld[1] / b.radii[1], ld[2] / b.radii[2]];
  const A = dot(e, e), B = dot(s, e), C = dot(s, s) - 1;
  if (C <= 0) return true; // 카메라가 몸체 안
  const D = B * B - A * C;
  if (D <= 0) return false;
  const t = (-B - Math.sqrt(D)) / A;
  return t > 0 && t < 1;
}
export function visibleFraction(cam, sun, sunR, occ) {
  // 시선 근처에 있는 몸체만 추린다(카메라에서 본 각거리 < 태양 각반지름 + 몸체 각반지름)
  const f = sub(sun, cam), dS = Math.hypot(...f);
  const aS = Math.asin(Math.min(1, sunR / dS));
  const near = occ.filter(b => {
    const v = sub(b.c, cam), d = Math.hypot(...v), R = Math.max(...b.radii);
    if (d <= R) return true;
    if (d - R > dS) return false; // 태양보다 멀다
    const ang = Math.acos(Math.max(-1, Math.min(1, dot(v, f) / (d * dS))));
    return ang < aS + Math.asin(R / d);
  });
  if (!near.length) return 1;
  const pts = sunSamples(cam, sun, sunR);
  let seen = 0;
  for (const p of pts) {
    const d = sub(p, cam);
    if (!near.some(b => segHits(cam, d, b))) seen++;
  }
  return seen / pts.length;
}

// ---------- 세기 ----------
// 노출처럼: 태양이 멀수록(받는 빛 ∝ 1/거리²) 로그로 약해지고, 약 300AU에서 꺼진다. 태양 속이면 0.
export const FADE_LOG = 0.2;
export function exposure(dist, sunR) {
  if (!(dist > sunR)) return 0;
  const e = (AU_KM / dist) ** 2;
  return Math.min(1, Math.max(0, 1 + FADE_LOG * Math.log10(e)));
}
// 태양 원반이 화면을 크게 채우면(가까이 다가가면) 렌즈 효과 대신 원반이 보이도록 줄이고, 태양 속이면 끈다.
// dist: 카메라–태양 중심 거리(km), sunR: 태양 반지름(km), fovY: 세로 화각(°)
export function flareStrength(dist, sunR, fovY) {
  if (!(dist > sunR)) return 0;
  // 원반 반지름이 화면 반높이의 몇 분의 일인가: 0.08 아래면 그대로, 0.3에서 0
  const s = Math.tan(Math.asin(sunR / dist)) / Math.tan(fovY * Math.PI / 360);
  const t = Math.min(1, Math.max(0, (s - 0.08) / (0.3 - 0.08)));
  return exposure(dist, sunR) * (1 - t * t * (3 - 2 * t));
}
// 태양이 화면 밖으로 멀리 나가면(원반 가장자리가 화면 높이의 절반을 넘어서면) 유령·후광도 사라진다.
// rs: 원반 반지름(px) — 원반이 크면 중심이 화면 밖이어도 가장자리는 안에 있다
export function offscreenFade(p, W, H, rs = 0) {
  const ox = Math.max(0, -p[0], p[0] - W), oy = Math.max(0, -p[1], p[1] - H);
  return Math.max(0, 1 - Math.max(0, Math.hypot(ox, oy) - rs) / H / 0.5);
}
// 렌즈 효과(넘친 핵·유령·베일)의 세기 = 노출 × 원반 크기 감쇠 × 보이는 비율 × 화면 밖 감쇠. 태양이 카메라 뒤이면(p = null) 0
export function flareGain(p, W, H, dist, sunR, fovY, vis, rs = 0) {
  if (!p) return 0;
  return flareStrength(dist, sunR, fovY) * vis * offscreenFade(p, W, H, rs);
}
// 가까이서 원반이 크면 후광을 약하게(끄지는 않는다, 2026-11-22 사용자 결정):
// 원반 반지름이 화면 반높이의 0.08 아래면 1, 0.4 넘으면 BLOOM_NEAR_MIN, 그 사이는 부드럽게.
export const BLOOM_NEAR_MIN = 0.35;
export function bloomNearDim(rs, H) {
  const t = Math.min(1, Math.max(0, (rs / (H / 2) - 0.08) / (0.4 - 0.08)));
  return 1 - (1 - BLOOM_NEAR_MIN) * t * t * (3 - 2 * t);
}
// 후광의 세기 = 노출 × 보이는 비율 × 화면 밖 감쇠 × 가까울 때 감쇠
export function bloomGain(p, W, H, dist, sunR, vis, rs = 0) {
  if (!p) return 0;
  return exposure(dist, sunR) * vis * offscreenFade(p, W, H, rs) * bloomNearDim(rs, H);
}
