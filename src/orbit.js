// 궤도 보기 — 고른 천체의 그 시각 궤도(타원)와 장반경·단반경·근점·원점. three.js 없는 순수 함수(tests/orbit.test.mjs).
// 요소: 행성은 Standish 평균 요소 · 위성은 맞춘 식의 평균 요소(달은 ELP 위치·속도의 접촉 요소) · 왜행성·혜성은 Horizons 접촉 요소 보간.
// 좌표: 도는 중심 천체(태양·모행성) 기준 J2000 황도, km.

import { elementsAt, AU_KM } from './ephemeris.js';
import { smallBodyElements, isSmallBody } from './smallbodies.js';
import { MOONS, PLANET_GM, moonGeocentric, moonMeanElements } from './moons.js';
import { GM_SUN } from './comets.js';

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

// 공전 주기(율리우스년 = 365.25일) — 케플러 제3법칙 2π√(a³/μ). μ는 중심 천체 GM(위성은 모행성 + 위성)
export const JULIAN_YEAR_S = 365.25 * 86400;
// 태양 둘레는 μ = 태양 + 그 행성계(위성 포함) GM(km³/s², JPL DE440) — 목성은 이것이 주기를 약 0.05% 바꾼다. 왜행성·혜성은 태양만
const SYSTEM_GM = { mercury: 22031.868, venus: 324858.592, earth: 403503.236, mars: 42828.376, jupiter: 126712764.1, saturn: 37940584.8, uranus: 5794556.4, neptune: 6836527.1 };
export function orbitPeriodYears(o) {
  const mu = o.center === 'sun' ? GM_SUN + (SYSTEM_GM[o.key] ?? 0) : PLANET_GM[o.center] + (MOON_BY_KEY[o.key]?.gm ?? 0);
  return 2 * Math.PI * Math.sqrt(o.a ** 3 / mu) / JULIAN_YEAR_S;
}

// 주기 글자 — 1년 이상 '년', 1년 미만 '일', 1일 미만 '시간'. 모두 소수점 넷째 자리(율리우스년 365.25일)
export function periodText(years) {
  const days = years * 365.25, hours = days * 24, r4 = x => Number(x.toFixed(4));
  // 단위는 반올림한 값으로 고른다 — 경계 바로 아래(23.99998시간)가 '24.0000시간'으로 찍히지 않게
  if (r4(years) >= 1) return `${years.toFixed(4)}년`;
  if (r4(hours) >= 24) return `${days.toFixed(4)}일`;
  return days >= 1 ? `${days.toFixed(4)}일` : `${hours.toFixed(4)}시간`;
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

// ---------- 거리 재기 카메라 ----------
// 천체에서 태양까지 도는 중심을 따라 올라간 줄 — [천체, 그 중심, …, 'sun']
export function centerChain(key) {
  const c = [key];
  while (c[c.length - 1] !== 'sun') c.push(orbitCenter(c[c.length - 1]));
  return c;
}
// 두 천체를 함께 담을 궤도들 — 두 줄이 처음 만나는 중심 C와, C 둘레를 도는 대표(천체 자신 또는 그 천체가 딸린 행성)의 궤도.
// 태양-위성·다른 행성의 위성끼리는 모행성 궤도로, 모행성-제 위성은 위성 궤도로 올라간다. main은 원점이 가장 먼(더 바깥) 궤도.
// 같은 천체면 null
export function pairOrbits(ka, kb, jd) {
  if (ka === kb) return null;
  const ca = centerChain(ka), cb = centerChain(kb);
  const center = ca.find(k => cb.includes(k));
  const reps = [ca, cb].map(c => c[c.indexOf(center) - 1]).filter(k => k);
  const orbits = [...new Set(reps)].map(k => orbitOf(k, jd));
  const main = orbits.reduce((p, q) => (q.apo > p.apo ? q : p));
  return { center, orbits, main };
}
// 여러 궤도(같은 중심 기준)를 main 궤도의 궤도 보기 방향에서 화면 영역 {l, t, r, b}(px)에 담는 카메라.
// 궤도면 밖의 점은 카메라 쪽으로 z만큼 나와 f·x/(d − z)로 커 보이므로 점마다 d ≥ f·|x|/반폭 + z를 지킨다(main 하나면 orbitFit과 같다).
// 반환: dir·up·right(황도 단위 벡터), target(바라보는 점, 중심 기준 km), d(km)
export function orbitsFit(orbits, main, { l, t, r, b }, cx, cy, f, pad = 28, n = 360) {
  const v = orbitView(main);
  const halfW = Math.max(20, (r - l) / 2 - pad), halfH = Math.max(20, (b - t) / 2 - pad);
  const pts = orbits.flatMap(o => Array.from({ length: n }, (_, k) => ellipsePoint(o, (2 * Math.PI * k) / n)))
    .map(p => [dot(p, v.right), dot(p, v.up), dot(p, v.dir)]);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2;
  let d = 0;
  for (const [x, y, z] of pts) d = Math.max(d, (f * Math.abs(x - mx)) / halfW + z, (f * Math.abs(y - my)) / halfH + z);
  // 묶음 가운데가 영역 가운데에 보이도록 바라보는 점을 옮긴다(화면 중심에서 dx 오른쪽·dy 아래)
  const dx = (l + r) / 2 - cx, dy = (t + b) / 2 - cy;
  const sx = mx - (dx * d) / f, sy = my + (dy * d) / f;
  const target = [0, 1, 2].map(k => v.right[k] * sx + v.up[k] * sy);
  return { dir: v.dir, up: v.up, right: v.right, target, d };
}
