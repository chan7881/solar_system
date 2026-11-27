// 소천체 — 왜행성·혜성 위치, 점 무리(소행성대·힐다·트로이·카이퍼대·오르트 구름). 화면(three.js) 없는 순수 함수.
// 테스트는 tests/smallbodies.test.mjs.
//
// 왜행성·혜성: JPL Horizons 접촉 궤도 요소 1년 간격(src/sb_elements.js, tools/fetch_smallbodies.py).
//   앞뒤 두 기원에서 각각 케플러 운동으로 옮긴 위치를 시간 비율로 섞는다 — 섭동·비중력 효과는 1년마다 새 요소로 따라잡는다.
// 점 무리: JPL SBDB 궤도 요소(textures/small_bodies.bin) — 케플러 운동. 단, 목성과 공명하는 무리는
//   접촉 궤도 요소의 평균 운동으로 돌리면 수십 년 만에 무리가 흩어진다(실제로는 공명이 붙잡아 둔다) →
//   트로이는 목성과 같은 평균 운동(λ − λ목성 고정), 힐다는 목성의 3/2배(3:2 공명각 고정)로 돌린다.
// 오르트 구름: 관측된 천체가 없어 모형으로 뿌린다 — 안쪽 경계 3,000AU, 밀도 ∝ r^−3.5 (Duncan, Quinn & Tremaine 1987,
//   AJ 94, 1330), 바깥 경계 100,000AU(NASA Science 「Oort Cloud」), 방향은 고르게(공 껍질).

import SB from './sb_elements.js';
import { dwarfColor } from './dwarfs.js';

const DEG = Math.PI / 180;
const J2000 = 2451545.0;
const K_GAUSS = 0.01720209895; // 가우스 중력 상수(rad/일, AU)
const N_JUPITER = 3034.74612775 / 36525 * DEG; // Standish 목성 평균 경도 변화율(rad/일) — src/ephemeris.js와 같다

// radius: 평균 반지름(km) · re·rp: 적도·극 반지름(회전 타원체) · abc: 3축 반지름(하우메아)
// 반지름 출처: 세레스·명왕성 IAU 2015(pck00011), 에리스 Sicardy et al. 2011, 하우메아 Ortiz et al. 2017,
//   마케마케 Brown 2013, 혜성 핵은 모양 모형의 부피 같은 구 반지름(핼리 Stooke · 67P DLR SHAP4S, tools/make_comets.py)과
//   추정치(엔케 Fernández et al. 2000 · 스위프트-터틀 · 헤일-밥 — 이 셋은 근사 모양)
// 하우메아·마케마케·에리스 색은 관측 반사율·색지수로 계산한다(src/dwarfs.js)
export const DWARFS = [
  { key: 'ceres',    name: '세레스',   radius: 469.7,  re: 487.3, rp: 446.0, color: 0x8a8580 },
  { key: 'pluto',    name: '명왕성',   radius: 1188.3, re: 1188.3, rp: 1188.3, color: 0xcaa98a },
  { key: 'haumea',   name: '하우메아', radius: 797,    abc: [1161, 852, 513], reach: 1161, color: dwarfColor('haumea') }, // reach: 가장 먼 점(카메라 근접 한계·이름표 가림)
  { key: 'makemake', name: '마케마케', radius: 715,    re: 715, rp: 715, color: dwarfColor('makemake') },
  { key: 'eris',     name: '에리스',   radius: 1163,   re: 1163, rp: 1163, color: dwarfColor('eris') },
].map(b => ({ ...b, kind: 'dwarf' }));
export const COMETS = [
  { key: 'halley',      name: '핼리 혜성',          radius: 4.59 },
  { key: 'encke',       name: '엔케 혜성',          radius: 2.4 },
  { key: 'churyumov',   name: '추류모프-게라시멘코', radius: 1.62 },
  { key: 'swifttuttle', name: '스위프트-터틀 혜성',  radius: 13 },
  { key: 'halebopp',    name: '헤일-밥 혜성',       radius: 30 },
].map(b => ({ ...b, re: b.radius, rp: b.radius, color: 0x4a4643, kind: 'comet' })); // 핵은 숯처럼 어둡다(반사율 약 0.04)
export const SMALL_BODIES = [...DWARFS, ...COMETS];
export const isSmallBody = key => key in SB;

// 케플러 방정식 — 이심률이 1에 가까운 혜성(헤일-밥 0.995)도 모이게 시작값을 고른다
export function keplerE(M, e) {
  M = Math.atan2(Math.sin(M), Math.cos(M));
  let E = e < 0.8 ? M : M + 0.85 * e * Math.sign(Math.sin(M) || 1);
  for (let i = 0; i < 50; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return E;
}

// 궤도 요소 → 근점이각 E에서의 황도 좌표(AU). 회전 행렬 계수는 out에 미리 계산해 두고 쓴다
function orbitBasis(i, om, w) {
  const ci = Math.cos(i), si = Math.sin(i), cO = Math.cos(om), sO = Math.sin(om), cw = Math.cos(w), sw = Math.sin(w);
  return [cw * cO - sw * sO * ci, -sw * cO - cw * sO * ci,
          cw * sO + sw * cO * ci, -sw * sO + cw * cO * ci,
          sw * si, cw * si];
}
function place(a, e, E, B) {
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  return [B[0] * xp + B[1] * yp, B[2] * xp + B[3] * yp, B[4] * xp + B[5] * yp];
}

// 한 기원의 요소 줄 [기원, e, q, i, Ω, ω, Tp]로 jd(TT)의 위치(AU, 태양 중심 J2000 황도)
function propagate(row, jd) {
  const [, e, q, i, om, w, tp] = row;
  const a = q / (1 - e);
  const n = K_GAUSS / Math.pow(a, 1.5);
  const E = keplerE(n * (jd - J2000 - tp), e);
  return place(a, e, E, orbitBasis(i * DEG, om * DEG, w * DEG));
}

// jd를 끼고 있는 두 기원의 번호와 비율 — 기원이 약 1년(365.25일) 간격이라 바로 짚고 앞뒤로 한 칸만 맞춘다
function bracket(rows, jd) {
  const t = jd - J2000, last = rows.length - 2;
  let k = Math.min(last, Math.max(0, Math.floor((t - rows[0][0]) / 365.25)));
  while (k > 0 && rows[k][0] > t) k--;
  while (k < last && rows[k + 1][0] <= t) k++;
  const f = Math.min(1, Math.max(0, (t - rows[k][0]) / (rows[k + 1][0] - rows[k][0])));
  return [k, f];
}

// 그 시각의 접촉 궤도 요소 — 앞뒤 두 기원의 요소를 선형 보간(각은 360° 넘김을 고려). a·q(AU), 각(°)
export function smallBodyElements(key, jd) {
  const rows = SB[key];
  if (!rows) throw new Error(`소천체 요소 없음: ${key}`);
  const [k, f] = bracket(rows, jd), p = rows[k], q = rows[k + 1];
  const lin = i => p[i] + (q[i] - p[i]) * f;
  const ang = i => p[i] + ((((q[i] - p[i]) % 360) + 540) % 360 - 180) * f;
  const e = lin(1), qr = lin(2);
  return { e, q: qr, a: qr / (1 - e), i: lin(3), node: ang(4), argp: ang(5) };
}

// 왜행성·혜성의 태양 중심 J2000 황도 좌표(AU)
export function smallBodyHelio(key, jd) {
  const rows = SB[key];
  if (!rows) throw new Error(`소천체 요소 없음: ${key}`);
  const [k, f] = bracket(rows, jd);
  const p = propagate(rows[k], jd), q = propagate(rows[k + 1], jd);
  return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f];
}

// 궤도선 — 지금 위치에서 시작해 한 바퀴 뒤로(번호가 커질수록 과거).
// 근점이각 E를 고르게 나누면 이심률이 큰 혜성(헤일-밥 0.995)은 궤도 양 끝(근일점·원일점)이 몇 칸 만에 꺾여 각진다 →
// E = ψ − (c/2)·sin 2ψ, c = 1 − √(1−e²) 인 ψ를 고르게 나눈다. dE/dψ가 양 끝에서 √(1−e²)(= b/a)로 작아져 끝이 촘촘하다.
// 원 궤도(e = 0)면 c = 0이라 고른 E 그대로
export function trailSpread(e) { return 1 - Math.sqrt(1 - e * e); }
function psiOfE(E, c) { // E = ψ − (c/2)sin2ψ 를 ψ에 대해 푼다(뉴턴법, c < 1이라 단조)
  let psi = E;
  for (let i = 0; i < 50; i++) {
    const d = (psi - 0.5 * c * Math.sin(2 * psi) - E) / (1 - c * Math.cos(2 * psi));
    psi -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return psi;
}
export function smallBodyTrail(key, jd, n) {
  const rows = SB[key];
  const [k, f] = bracket(rows, jd);
  const [, e, q, i, om, w, tp] = rows[f < 0.5 ? k : k + 1];
  const a = q / (1 - e);
  const E0 = keplerE(K_GAUSS / Math.pow(a, 1.5) * (jd - J2000 - tp), e);
  const B = orbitBasis(i * DEG, om * DEG, w * DEG);
  const c = trailSpread(e), psi0 = psiOfE(E0, c);
  const pts = [];
  for (let j = 0; j <= n; j++) {
    const psi = psi0 - (2 * Math.PI * j) / n;
    pts.push(place(a, e, psi - 0.5 * c * Math.sin(2 * psi), B));
  }
  return pts;
}

// ---------- 점 무리 ----------
export const GROUPS = ['belt', 'hilda', 'trojan', 'kuiper'];
const STRIDE = 8;

// textures/small_bodies.bin → 무리 번호와 미리 계산한 궤도 값
export function parsePoints(buf) {
  const f = new Float32Array(buf);
  const count = f.length / STRIDE;
  const group = new Uint8Array(count);
  const a = new Float64Array(count), e = new Float64Array(count), n = new Float64Array(count),
    M0 = new Float64Array(count), ep = new Float64Array(count), B = new Float64Array(count * 6), b2 = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const o = k * STRIDE;
    group[k] = f[o];
    a[k] = f[o + 1]; e[k] = f[o + 2];
    B.set(orbitBasis(f[o + 3] * DEG, f[o + 4] * DEG, f[o + 5] * DEG), k * 6);
    M0[k] = f[o + 6] * DEG; ep[k] = f[o + 7];
    b2[k] = a[k] * Math.sqrt(1 - e[k] * e[k]);
    n[k] = group[k] === 2 ? N_JUPITER : group[k] === 1 ? 1.5 * N_JUPITER : K_GAUSS / Math.pow(a[k], 1.5);
  }
  return { count, group, a, e, n, M0, ep, B, b2 };
}

// 점 무리의 태양 중심 위치를 장면 좌표(km, Y = 황도 북극)로 out(Float32Array, 3×count)에 쓴다.
// keplerE를 부르지 않고 같은 식을 풀어 둔다 — 그림 틀마다 수만 번이라
export function pointPositions(P, jd, out, scale = 1) {
  const t = jd - J2000;
  for (let k = 0; k < P.count; k++) {
    const e = P.e[k];
    let M = P.M0[k] + P.n[k] * (t - P.ep[k]);
    M -= 2 * Math.PI * Math.round(M / (2 * Math.PI));
    let E = e < 0.8 ? M : M + 0.85 * e * Math.sign(Math.sin(M) || 1);
    for (let it = 0; it < 30; it++) {
      const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      E -= d;
      if (Math.abs(d) < 1e-10) break;
    }
    const xp = P.a[k] * (Math.cos(E) - e), yp = P.b2[k] * Math.sin(E), o = k * 6;
    const x = P.B[o] * xp + P.B[o + 1] * yp, y = P.B[o + 2] * xp + P.B[o + 3] * yp, z = P.B[o + 4] * xp + P.B[o + 5] * yp;
    // 황도 (x, y, z) → 장면 (x, z, −y)  (src/ephemeris.js eclipticToScene)
    out[k * 3] = x * scale; out[k * 3 + 1] = z * scale; out[k * 3 + 2] = -y * scale;
  }
  return out;
}

// 무리 이름표 자리 — pos는 pointPositions의 결과(장면 좌표, 태양 중심), jupLon은 목성의 황경(라디안).
// 소행성대·카이퍼대는 고리라 반지름(궤도 긴반지름 중앙값, AU)만, 트로이(L4 앞·L5 뒤)·힐다(목성 반대편 꼭짓점)는
// 그 쪽 점들의 평균 방향과 평균 거리로 황도면 위 한 점(pos와 같은 단위의 장면 좌표, y = 0)을 준다
export function groupAnchors(P, pos, jupLon) {
  const acc = { L4: [0, 0, 0, 0], L5: [0, 0, 0, 0], hilda: [0, 0, 0, 0] };
  const radii = [[], [], [], []];
  for (let k = 0; k < P.count; k++) {
    const g = P.group[k];
    if (g === 0 || g === 3) { radii[g].push(P.a[k]); continue; }
    const X = pos[k * 3], Z = pos[k * 3 + 2];
    // 장면 (x, z) → 황도 (x, −z) · 황경 차이는 −180~180°
    let d = Math.atan2(-Z, X) - jupLon;
    d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
    const s = g === 2 ? (d > 0 ? acc.L4 : acc.L5) : Math.abs(d) > (5 / 6) * Math.PI ? acc.hilda : null;
    if (!s) continue;
    const r = Math.hypot(X, Z);
    s[0] += X / r; s[1] += Z / r; s[2] += r; s[3]++;
  }
  const median = v => { v.sort((p, q) => p - q); return v.length ? v[v.length >> 1] : NaN; };
  const out = { beltR: median(radii[0]), kuiperR: median(radii[3]) };
  for (const [k, s] of Object.entries(acc)) {
    const u = Math.hypot(s[0], s[1]), r = s[2] / s[3];
    out[k] = s[3] ? [s[0] / u * r, 0, s[1] / u * r] : null;
  }
  return out;
}

// ---------- 오르트 구름(모형) ----------
export const OORT = { rIn: 3000, rOut: 100000, slope: -3.5 };

// 결정된 난수(같은 씨앗이면 같은 무리) — mulberry32
function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// n개 점의 태양 중심 장면 좌표(AU). 부피 밀도 ∝ r^slope → 반지름 분포 ∝ r^(slope+2), 역함수로 뽑는다
export function oortCloud(n, seed = 7, { rIn, rOut, slope } = OORT) {
  const R = rng(seed), out = new Float32Array(n * 3), p = slope + 3; // p ≠ 0
  const lo = Math.pow(rIn, p), hi = Math.pow(rOut, p);
  for (let k = 0; k < n; k++) {
    const r = Math.pow(lo + (hi - lo) * R(), 1 / p);
    const z = 2 * R() - 1, ph = 2 * Math.PI * R(), s = Math.sqrt(1 - z * z);
    out[k * 3] = r * s * Math.cos(ph); out[k * 3 + 1] = r * z; out[k * 3 + 2] = r * s * Math.sin(ph);
  }
  return out;
}
