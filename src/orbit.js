// 궤도 보기 — 고른 천체의 그 시각 궤도(타원)와 장반경·단반경·근점·원점. three.js 없는 순수 함수(tests/orbit.test.mjs).
// 요소: 행성은 Standish 평균 요소 · 위성은 맞춘 식의 평균 요소(달은 ELP 위치·속도의 접촉 요소) · 왜행성·혜성은 Horizons 접촉 요소 보간.
// 좌표: 도는 중심 천체(태양·모행성) 기준 J2000 황도, km.

import { elementsAt, AU_KM } from './ephemeris.js';
import { smallBodyElements, isSmallBody } from './smallbodies.js';
import { MOONS, PLANET_GM, moonGeocentric, moonMeanElements } from './moons.js';

const DEG = Math.PI / 180;
const MOON_BY_KEY = Object.fromEntries(MOONS.map(m => [m.key, m]));
const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const scale = (p, k) => [p[0] * k, p[1] * k, p[2] * k];
const unit = p => scale(p, 1 / Math.hypot(...p));

// 경사 i·승교점 Ω·근점 인수 ω(rad) → 근점 쪽 P, 궤도면 안에서 P에 수직인 운동 쪽 Q, 궤도면 법선 W(오른손)
export function basisFromAngles(i, node, argp) {
  const ci = Math.cos(i), si = Math.sin(i), cO = Math.cos(node), sO = Math.sin(node), cw = Math.cos(argp), sw = Math.sin(argp);
  return {
    P: [cw * cO - sw * sO * ci, cw * sO + sw * cO * ci, sw * si],
    Q: [-sw * cO - cw * sO * ci, -sw * sO + cw * cO * ci, cw * si],
    W: [sO * si, -cO * si, ci],
  };
}

// 위치 r(km)·속도 v(km/s)·μ(km³/s²) → 접촉 타원 a, e, P, Q, W
export function elementsFromState(r, v, mu) {
  const rn = Math.hypot(...r), h = cross(r, v);
  const ev = sub(scale(cross(v, h), 1 / mu), scale(r, 1 / rn));
  const e = Math.hypot(...ev), a = 1 / (2 / rn - dot(v, v) / mu);
  const W = unit(h), P = e > 1e-12 ? scale(ev, 1 / e) : unit(r);
  return { a, e, P, Q: cross(W, P), W };
}

// 도는 중심 — 위성은 모행성, 나머지는 태양
export const orbitCenter = key => MOON_BY_KEY[key]?.parent ?? 'sun';

// 근점·원점 이름 — 태양 둘레 근일점·원일점, 지구 둘레 근지점·원지점, 그 밖은 근점·원점
export function apsisNames(center) {
  if (center === 'sun') return ['근일점', '원일점'];
  if (center === 'earth') return ['근지점', '원지점'];
  return ['근점', '원점'];
}

// 달: ELP 위치를 앞뒤로 미분한 속도로 접촉 요소(두 몸 문제라 μ = 지구 + 달)
const MOON_H = 0.01; // 일
function moonOsculating(jd) {
  const r = moonGeocentric(jd), r1 = moonGeocentric(jd + MOON_H), r0 = moonGeocentric(jd - MOON_H);
  const v = scale(sub(r1, r0), 1 / (2 * MOON_H * 86400));
  return elementsFromState(r, v, PLANET_GM.earth + MOON_BY_KEY.moon.gm);
}

// 그 시각의 궤도. 반환 { key, center, a, e, b, peri, apo (km), P, Q, W (단위 벡터, 황도) }
export function orbitOf(key, jd) {
  let o;
  if (key === 'sun') throw new Error('태양은 도는 궤도가 없다');
  if (key === 'moon') o = moonOsculating(jd);
  else if (MOON_BY_KEY[key]) {
    const m = moonMeanElements(key, jd), B = basisFromAngles(m.inc, m.node, m.varpi - m.node);
    const [fx, fy, fz] = m.frame;
    const toEcl = p => [0, 1, 2].map(k => p[0] * fx[k] + p[1] * fy[k] + p[2] * fz[k]);
    o = { a: m.a, e: m.e, P: toEcl(B.P), Q: toEcl(B.Q), W: toEcl(B.W) };
  } else if (isSmallBody(key)) {
    const s = smallBodyElements(key, jd);
    o = { a: s.a * AU_KM, e: s.e, ...basisFromAngles(s.i * DEG, s.node * DEG, s.argp * DEG) };
  } else {
    const p = elementsAt(key, jd);
    o = { a: p.a * AU_KM, e: p.e, ...basisFromAngles(p.I * DEG, p.node * DEG, (p.varpi - p.node) * DEG) };
  }
  const { a, e } = o;
  return { key, center: orbitCenter(key), a, e, b: a * Math.sqrt(1 - e * e), peri: a * (1 - e), apo: a * (1 + e), P: o.P, Q: o.Q, W: o.W };
}

// 타원 위의 점(중심 천체 기준) — 이심 근점 이각 E(rad)
export const ellipsePoint = (o, E) => {
  const x = o.a * (Math.cos(E) - o.e), y = o.b * Math.sin(E);
  return [0, 1, 2].map(k => o.P[k] * x + o.Q[k] * y);
};
// 장반경·단반경 선과 점들(중심 천체 기준, km)
export function orbitMarks(o) {
  const C = scale(o.P, -o.a * o.e);
  return { center: C, peri: scale(o.P, o.peri), apo: scale(o.P, -o.apo), minor: [0, 1, 2].map(k => C[k] + o.Q[k] * o.b) };
}

// 카메라 방향 — 궤도면에 수직인, 황도 북쪽 편(z ≥ 0)에서 내려다본다(역행 궤도는 시계 방향으로 돈다).
// up은 화면 위쪽: P × N 이면 화면 오른쪽 = up × N = −P → 근점이 왼쪽, 장축이 가로.
export function orbitView(o) {
  const N = o.W[2] >= 0 ? o.W : scale(o.W, -1);
  return { dir: N, up: cross(o.P, N), right: scale(o.P, -1) };
}

// 궤도가 화면 영역 {l, t, r, b}(px)에 들어오는 카메라 거리 d와, 타원 중심을 그 영역 가운데에 두려면
// 화면 중심(cx, cy)에서 옮겨야 할 화소(dx 오른쪽, dy 아래). f: 초점 거리(px) — 궤도면이 시선에 수직이라 화소 = f·길이/d.
// 가장자리에 근점·원점 글자가 들어갈 여유 pad(px)를 남긴다.
export function orbitFit(o, { l, t, r, b }, cx, cy, f, pad = 28) {
  const halfW = Math.max(20, (r - l) / 2 - pad), halfH = Math.max(20, (b - t) / 2 - pad);
  const d = Math.max((o.a * f) / halfW, (o.b * f) / halfH);
  return { d, dx: (l + r) / 2 - cx, dy: (t + b) / 2 - cy };
}
