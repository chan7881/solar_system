// 두 천체 사이 거리가 가장 가깝고 먼 때(계산 범위 1800~2050 전체) — three.js 없는 순수 함수. 테스트는 tests/extremes.test.mjs.
// 무거운 계산이라 화면에서는 src/extremes_worker.js(웹 워커)로 돌린다.
import { AU_KM, heliocentric } from './ephemeris.js';
import { MOONS, PLANET_GM, moonPosition, moonPeriod, systemOffsets } from './moons.js';
import { isSmallBody, smallBodyHelio } from './smallbodies.js';

const MOON = Object.fromEntries(MOONS.map(m => [m.key, m]));
const helioKm = (key, jd) => (isSmallBody(key) ? smallBodyHelio : heliocentric)(key, jd).map(v => v * AU_KM);
const add = (p, q) => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const norm = p => Math.hypot(p[0], p[1], p[2]);
const hasMoons = key => MOONS.some(o => o.parent === key);

// 태양 중심 J2000 황도 좌표(km) — main.js updatePositions와 같은 식(행성은 질량중심 + 위성 보정, 위성은 그 행성 중심 + 위성 위치)
export function absPos(key, jd) {
  const m = MOON[key];
  if (m) return add(add(helioKm(m.parent, jd), systemOffsets(m.parent, jd).planet), moonPosition(key, jd));
  const p = helioKm(key, jd);
  return hasMoons(key) ? add(p, systemOffsets(key, jd).planet) : p;
}

// 질량중심 판(위성은 그 계의 질량중심, 보정 없음) — 거칠게 훑을 때 쓴다
const systemOf = key => MOON[key]?.parent ?? key;
const baryPos = (key, jd) => helioKm(systemOf(key), jd);

// 질량중심 판과 실제 위치가 어긋나는 성분: [주기(일), 크기(km)] — 위성 자신의 공전, 행성 중심이 위성 쪽으로 흔들리는 것
export function wobbles(key) {
  const sys = systemOf(key);
  const list = MOONS.filter(o => o.parent === sys);
  if (!list.length) return [];
  const gmTot = (PLANET_GM[sys] ?? 0) + list.reduce((s, o) => s + o.gm, 0);
  const out = list.map(o => [moonPeriod(o.key), (moonSize(o.key) * o.gm) / gmTot]);
  if (MOON[key]) out.push([moonPeriod(key), moonSize(key)]);
  return out.filter(([, amp]) => amp > 1);
}
const sizeCache = {};
function moonSize(key) { // 행성 중심에서 가장 먼 거리(근사, 여유 2%) — 한 바퀴를 훑어 잰다
  if (sizeCache[key] == null) {
    const P = moonPeriod(key);
    let r = 0;
    for (let i = 0; i < 64; i++) r = Math.max(r, norm(moonPosition(key, 2451545 + (P * i) / 64)));
    sizeCache[key] = r * 1.02;
  }
  return sizeCache[key];
}

// 황금 분할로 [a, b] 안의 최솟값(sign = 1) 또는 최댓값(sign = −1)
function golden(f, a, b, sign, tol = 1e-6) {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), d = a + g * (b - a), fc = sign * f(c), fd = sign * f(d);
  while (b - a > tol) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = sign * f(c); }
    else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = sign * f(d); }
  }
  const t = (a + b) / 2;
  return { t, v: f(t) };
}
const better = sign => (p, q) => (sign * (q.v - p.v) < 0 ? q : p);

// [t0, t1]을 h 간격으로 한 번 훑어 두고(sample), 국소 극값(양 끝 포함)을 고른다(pick). 세 점 포물선 꼭짓점 값으로 순위를 매겨
// 좋은 쪽 k개만 황금 분할로 다듬는다(위성은 수십만 바퀴라 전부 다듬으면 수십 초). 반환: 다듬은 극값(좋은 순)
function sample(f, t0, t1, h) {
  const n = Math.max(3, Math.ceil((t1 - t0) / h) + 1);
  const dt = (t1 - t0) / (n - 1);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = f(t0 + i * dt);
  return { f, t0, dt, v };
}
function pick({ f, t0, dt, v }, sign, k) {
  const n = v.length, est = [];
  for (let i = 0; i < n; i++) {
    const c = sign * v[i];
    if ((i > 0 && sign * v[i - 1] < c) || (i < n - 1 && sign * v[i + 1] < c)) continue;
    let e = c;
    if (i > 0 && i < n - 1) {
      const a = sign * v[i - 1], b = sign * v[i + 1], q = a - 2 * c + b;
      if (q > 0) e -= (b - a) ** 2 / (8 * q);
    }
    est.push([e, i]);
  }
  est.sort((p, q) => p[0] - q[0]);
  return est.slice(0, k)
    .map(([, i]) => {
      const g = golden(f, t0 + Math.max(0, i - 1) * dt, t0 + Math.min(n - 1, i + 1) * dt, sign);
      // 범위 끝이면 끝 값 자체와도 견준다(황금 분할은 끝점을 재지 않는다)
      return i === 0 || i === n - 1 ? better(sign)(g, { t: t0 + i * dt, v: v[i] }) : g;
    })
    .sort((p, q) => sign * (p.v - q.v));
}

// 가장 가까운 때·먼 때 — { min: { t: jd, v: km }, max }
function extremes(ka, kb, jd0, jd1) {
  if (systemOf(ka) === systemOf(kb)) {
    // 같은 계(위성과 그 행성, 같은 행성의 두 위성) — 행성 중심에서 본 위성 위치만으로 정확히 정해진다.
    // 가장 짧은 공전 주기의 1/5 간격으로 훑는다(한 바퀴에 극값이 하나씩이라 놓치지 않는다)
    const rel = (k, t) => (MOON[k] ? moonPosition(k, t) : [0, 0, 0]);
    const S = sample(t => norm(sub(rel(ka, t), rel(kb, t))), jd0, jd1,
      Math.min(...[ka, kb].filter(k => MOON[k]).map(moonPeriod)) / 5);
    return { min: pick(S, 1, 200)[0], max: pick(S, -1, 200)[0] };
  }
  // 다른 계 — 질량중심끼리 하루 간격으로 훑고, 위성·행성 흔들림 때문에 순위가 뒤집힐 수 있는 후보
  // (차이가 흔들림 크기 합의 2배 안)만 실제 위치로 그 둘레(가장 긴 흔들림 주기의 1.5배, 적어도 3일)를 촘촘히 다시 훑는다
  const fx = t => norm(sub(absPos(ka, t), absPos(kb, t)));
  const w = [...wobbles(ka), ...wobbles(kb)];
  const dev = w.reduce((s, [, amp]) => s + amp, 0);
  const S = sample(t => norm(sub(baryPos(ka, t), baryPos(kb, t))), jd0, jd1, 1);
  const one = sign => {
    const coarse = pick(S, sign, 200);
    const cands = coarse.filter(c => Math.abs(c.v - coarse[0].v) <= 2 * dev + 1).slice(0, 50);
    if (!w.length) return cands.map(c => golden(fx, Math.max(jd0, c.t - 1), Math.min(jd1, c.t + 1), sign)).reduce(better(sign));
    const W = Math.max(3, 1.5 * Math.max(...w.map(([P]) => P)));
    const h = Math.min(...w.map(([P]) => P)) / 16;
    return cands.map(c => pick(sample(fx, Math.max(jd0, c.t - W), Math.min(jd1, c.t + W), h), sign, 4)[0]).reduce(better(sign));
  };
  return { min: one(1), max: one(-1) };
}

// 두 천체의 최소·최대 거리와 그때 두 천체의 위치(태양 중심 J2000 황도 km)
export function distanceExtremes(ka, kb, jd0, jd1) {
  const r = extremes(ka, kb, jd0, jd1);
  const out = ({ t, v }) => ({ jd: t, km: v, a: absPos(ka, t), b: absPos(kb, t) });
  return { min: out(r.min), max: out(r.max) };
}
