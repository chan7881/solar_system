// 위성 위치 — 화면(three.js)과 무관한 순수 함수만 둔다. 테스트는 tests/moons.test.mjs.
//
// 달: Chapront ELP-2000/82의 주요 항(J. Meeus, Astronomical Algorithms 2판 47장 표 47.A·B 일부).
// 다른 위성: JPL Horizons 위치(1800~2050, 3.14일 간격)에 맞춘 평균 궤도 식(src/moon_fits.js, tools/fit_moons.py).
//   JPL 「Planetary Satellite Mean Elements」표는 주기 자릿수가 모자라고 공명 흔들림(미마스–테티스 ±44° 등)이 없어
//   수십 년이면 수십° 어긋난다(2026-11-21 실측) — 그래서 Horizons에 직접 맞췄다.
// 반지름·GM: JPL SSD 「Planetary Satellite Physical Parameters」(https://ssd.jpl.nasa.gov/sats/phys_par/) 평균 반지름.
// 좌표: 행성 중심, J2000 황도·춘분점, km.

import FITS from './moon_fits.js';

const DEG = Math.PI / 180;
const J2000 = 2451545.0;

// parent: 도는 행성 · radius: 평균 반지름(km) · gm(km³/s²) · color: 지도가 없을 때의 색(사진을 보고 고른 근사)
export const MOONS = [
  { key: 'moon',      name: '달',       parent: 'earth',   radius: 1737.4,  gm: 4902.800,  color: 0x9a9690 },
  { key: 'phobos',    name: '포보스',   parent: 'mars',    radius: 11.08,   gm: 0.0007087, color: 0x7d7268 },
  { key: 'deimos',    name: '데이모스', parent: 'mars',    radius: 6.2,     gm: 0.0000962, color: 0x8a7e70 },
  { key: 'io',        name: '이오',     parent: 'jupiter', radius: 1821.49, gm: 5959.91547, color: 0xd9c66a },
  { key: 'europa',    name: '유로파',   parent: 'jupiter', radius: 1560.80, gm: 3202.71210, color: 0xcbbfa6 },
  { key: 'ganymede',  name: '가니메데', parent: 'jupiter', radius: 2631.20, gm: 9887.83275, color: 0x9b9186 },
  { key: 'callisto',  name: '칼리스토', parent: 'jupiter', radius: 2410.30, gm: 7179.28340, color: 0x6e6559 },
  { key: 'mimas',     name: '미마스',   parent: 'saturn',  radius: 198.20,  gm: 2.50349,   color: 0xb8b4ac },
  { key: 'enceladus', name: '엔셀라두스', parent: 'saturn', radius: 252.10, gm: 7.21037,   color: 0xeef0f2 },
  { key: 'tethys',    name: '테티스',   parent: 'saturn',  radius: 531.10,  gm: 41.21353,  color: 0xdcdad4 },
  { key: 'dione',     name: '디오네',   parent: 'saturn',  radius: 561.40,  gm: 73.11607,  color: 0xcfccc4 },
  { key: 'rhea',      name: '레아',     parent: 'saturn',  radius: 763.50,  gm: 153.94175, color: 0xc9c5bc },
  { key: 'titan',     name: '타이탄',   parent: 'saturn',  radius: 2574.76, gm: 8978.13710, color: 0xd59a4e },
  { key: 'hyperion',  name: '히페리온', parent: 'saturn',  radius: 135.00,  gm: 0.37049,   color: 0x9c8b78 },
  { key: 'iapetus',   name: '이아페투스', parent: 'saturn', radius: 734.30, gm: 120.51511, color: 0xa39a8c },
  { key: 'miranda',   name: '미란다',   parent: 'uranus',  radius: 235.8,   gm: 4.3,       color: 0xa9a7a3 },
  { key: 'ariel',     name: '아리엘',   parent: 'uranus',  radius: 578.9,   gm: 83.5,      color: 0xb4b1ab },
  { key: 'umbriel',   name: '움브리엘', parent: 'uranus',  radius: 584.7,   gm: 85.1,      color: 0x75726d },
  { key: 'titania',   name: '티타니아', parent: 'uranus',  radius: 788.9,   gm: 226.9,     color: 0xa39e96 },
  { key: 'oberon',    name: '오베론',   parent: 'uranus',  radius: 761.4,   gm: 205.3,     color: 0x968e86 },
  { key: 'triton',    name: '트리톤',   parent: 'neptune', radius: 1352.60, gm: 1428.49546, color: 0xc7bfb8 },
  { key: 'charon',    name: '카론',     parent: 'pluto',   radius: 606.0,   gm: 106.1,     color: 0x9c9a96 }, // GM은 PLU060(Brozović & Jacobson 2024)
];

// 행성(몸체만)의 GM(km³/s²) — 질량중심 → 행성 중심 보정용. JPL DE440 / 위성 해(JUP365·SAT441·URA111·NEP097·PLU060)
// 명왕성도 계 질량중심의 궤도 요소를 받으므로(tools/fetch_smallbodies.py) 같은 보정을 한다 — 카론이 무거워 약 2,100km
export const PLANET_GM = { earth: 398600.435, mars: 42828.37, jupiter: 126686531.9, saturn: 37931206.2, uranus: 5793951.3, neptune: 6835099.5, pluto: 869.3 };

const norm360 = x => ((x % 360) + 360) % 360;

// ---------- 달 ----------
// 표 47.A: [D, M, M', F, Σl(1e-6°), Σr(1e-3 km)] · 표 47.B: [D, M, M', F, Σb(1e-6°)]
const LR = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111], [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925], [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138], [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586], [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321], [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661], [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208], [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379], [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650], [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003], [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884],
];
const B = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359],
];
// 지구 중심 J2000 황도 좌표(km)
export function moonGeocentric(jd) {
  const T = (jd - J2000) / 36525;
  const Lp = norm360(218.3164477 + 481267.88123421 * T);
  const D = norm360(297.8501921 + 445267.1114034 * T) * DEG;
  const M = norm360(357.5291092 + 35999.0502909 * T) * DEG;
  const Mp = norm360(134.9633964 + 477198.8675055 * T) * DEG;
  const F = norm360(93.2720950 + 483202.0175233 * T) * DEG;
  const E = 1 - 0.002516 * T;
  const A1 = (119.75 + 131.849 * T) * DEG, A2 = (53.09 + 479264.290 * T) * DEG, A3 = (313.45 + 481266.484 * T) * DEG;
  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, l, r] of LR) {
    const arg = d * D + m * M + mp * Mp + f * F, k = Math.abs(m) === 1 ? E : m ? E * E : 1;
    sl += l * k * Math.sin(arg); sr += r * k * Math.cos(arg);
  }
  for (const [d, m, mp, f, b] of B) {
    const k = Math.abs(m) === 1 ? E : m ? E * E : 1;
    sb += b * k * Math.sin(d * D + m * M + mp * Mp + f * F);
  }
  const L = Lp * DEG;
  sl += 3958 * Math.sin(A1) + 1962 * Math.sin(L - F) + 318 * Math.sin(A2);
  sb += -2235 * Math.sin(L) + 382 * Math.sin(A3) + 175 * Math.sin(A1 - F) + 175 * Math.sin(A1 + F)
    + 127 * Math.sin(L - Mp) - 115 * Math.sin(L + Mp);
  // 그날의 평균 춘분점 → J2000 춘분점: 황경 세차(5029.0966″/세기)만 뺀다(황도 기울기 변화 47″/세기는 무시)
  const lam = (Lp + sl / 1e6 - 5029.0966 / 3600 * T) * DEG, beta = sb / 1e6 * DEG;
  const dist = 385000.56 + sr / 1000;
  return [dist * Math.cos(beta) * Math.cos(lam), dist * Math.cos(beta) * Math.sin(lam), dist * Math.sin(beta)];
}

// ---------- 맞춘 평균 궤도 식 ----------
// L = L0 + n·t + c2·t² + Σ(A cos ft + B sin ft) · K = e·exp(iϖ) = Σ C exp(ift) · H = sin(i)·exp(iΩ) = Σ C exp(ift)
// 각은 평균 궤도면 좌표(frame)에서 잰다. tools/fit_moons.py evaluate()와 같은 식.
function series(terms, t) {
  let re = 0, im = 0;
  for (const [f, cr, ci] of terms) {
    const c = Math.cos(f * t), s = Math.sin(f * t);
    re += cr * c - ci * s; im += cr * s + ci * c;
  }
  return [re, im];
}

// 맞춘 식의 그 시각 평균 궤도 요소(달 제외) — a(km), e, 평균 경도 L·근점 경도 varpi·경사 inc·승교점 node(rad, 위성마다의 기준면),
// frame: 기준면 좌표 → J2000 황도 좌표의 세 축(행)
export function moonMeanElements(key, jd) {
  const m = FITS[key];
  if (!m) throw new Error(`위성 없음: ${key}`);
  const t = jd - J2000;
  let L = m.L0 + m.n * t + m.c2 * t * t;
  for (const [f, A, B] of m.Lterms) L += A * Math.cos(f * t) + B * Math.sin(f * t);
  const [kr, ki] = series(m.Kterms, t), [hr, hi] = series(m.Hterms, t);
  return { a: m.a, e: Math.hypot(kr, ki), L, varpi: Math.atan2(ki, kr),
           inc: Math.asin(Math.min(1, Math.hypot(hr, hi))), node: Math.atan2(hi, hr), frame: m.frame };
}

// 행성 중심 J2000 황도 좌표(km)
export function moonPosition(key, jd) {
  if (key === 'moon') return moonGeocentric(jd);
  const { e, L, varpi, inc, node } = moonMeanElements(key, jd), m = FITS[key];
  const E = solveKepler(L - varpi, e);
  const xp = m.a * (Math.cos(E) - e), yp = m.a * Math.sqrt(1 - e * e) * Math.sin(E);
  const w = varpi - node;
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(node), sO = Math.sin(node), ci = Math.cos(inc), si = Math.sin(inc);
  const X = (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp;
  const Y = (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp;
  const Z = (sw * si) * xp + (cw * si) * yp;
  const [fx, fy, fz] = m.frame;
  return [0, 1, 2].map(k => X * fx[k] + Y * fy[k] + Z * fz[k]);
}

function solveKepler(M, e) {
  M = Math.atan2(Math.sin(M), Math.cos(M));
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 20; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-13) break;
  }
  return E;
}

// 질량중심(궤도 요소가 주는 점) → 행성 중심 보정(km). 위성들의 질량 가중 위치를 반대로 옮긴다.
// 반환: { planet: [dx,dy,dz], moons: { key: 행성 중심 위치 } }
export function systemOffsets(parent, jd) {
  const list = MOONS.filter(m => m.parent === parent);
  const moons = {};
  let sx = 0, sy = 0, sz = 0, gm = PLANET_GM[parent] ?? 0;
  for (const m of list) {
    const p = moonPosition(m.key, jd);
    moons[m.key] = p;
    sx += m.gm * p[0]; sy += m.gm * p[1]; sz += m.gm * p[2]; gm += m.gm;
  }
  return { planet: gm ? [-sx / gm, -sy / gm, -sz / gm] : [0, 0, 0], moons };
}

// 공전 주기(일) — 궤도선 길이용. 달은 항성월.
export function moonPeriod(key) {
  return key === 'moon' ? 27.321661 : 2 * Math.PI / FITS[key].n;
}

// 궤도선 점들 — 지금 위치에서 시작해 한 바퀴 거슬러 간다(행성 중심, km). 0번이 지금 위치.
export function moonTrail(key, jd, n) {
  const P = moonPeriod(key), pts = [];
  for (let k = 0; k <= n; k++) pts.push(moonPosition(key, jd - (P * k) / n));
  return pts;
}

// 같은 점들을 매 그림 틀마다 새로 셈하지 않는 판 — 0번만 지금 위치, 나머지는 주기/(n−1) 간격의 고정 격자 시각.
// 시간이 흐르면 격자에서 새로 들어온 점만 셈한다(1초에 하루로 돌려도 미마스 몇 점). 격자 n점이 한 주기를 덮어 고리가 닫힌다.
export function moonTrailCache(key, n) {
  const h = moonPeriod(key) / (n - 1);
  let i0 = NaN, grid = [];
  return jd => {
    const i = Math.floor(jd / h), shift = i - i0;
    if (!(Math.abs(shift) < n)) {
      grid = Array.from({ length: n }, (_, j) => moonPosition(key, (i - j) * h));
    } else if (shift > 0) {
      const add = Array.from({ length: shift }, (_, j) => moonPosition(key, (i - j) * h));
      grid = add.concat(grid.slice(0, n - shift));
    } else if (shift < 0) {
      const add = Array.from({ length: -shift }, (_, j) => moonPosition(key, (i - (n + shift) - j) * h));
      grid = grid.slice(-shift).concat(add);
    }
    i0 = i;
    return [moonPosition(key, jd), ...grid];
  };
}
