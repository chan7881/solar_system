// 행성 위치 계산 — 화면(three.js)과 무관한 순수 함수만 둔다. 테스트는 tests/ephemeris.test.mjs.
//
// 궤도 요소: E. M. Standish, "Keplerian Elements for Approximate Positions of the Major Planets"
//   (JPL SSD), Table 1 — 1800~2050년용. 기준틀은 J2000 황도·춘분점, 태양 중심.
// 반지름: NASA Planetary Fact Sheet의 평균(부피) 반지름, km.

export const AU_KM = 149597870.7;
const DEG = Math.PI / 180;

// 시간 범위 — Standish Table 1이 맞는 구간
export const VALID_FROM = Date.UTC(1800, 0, 1);
export const VALID_TO = Date.UTC(2050, 11, 31, 23, 59, 59);

// [a(AU), e, I(°), L(°), ϖ(°), Ω(°)] 과 세기당 변화율
const ELEMENTS = {
  mercury: [[0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
            [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  venus:   [[0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
            [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418]],
  earth:   [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
            [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0]],
  mars:    [[1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
            [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  jupiter: [[5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
            [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  saturn:  [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
            [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  uranus:  [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503],
            [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
  neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
            [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]],
};

export const BODIES = [
  { key: 'sun',     name: '태양',   radius: 695700, color: 0xfff4e0 },
  { key: 'mercury', name: '수성',   radius: 2439.7, color: 0x9c948c },
  { key: 'venus',   name: '금성',   radius: 6051.8, color: 0xe6d3a8 },
  { key: 'earth',   name: '지구',   radius: 6371.0, color: 0x3d6fb4 },
  { key: 'mars',    name: '화성',   radius: 3389.5, color: 0xc1623b },
  { key: 'jupiter', name: '목성',   radius: 69911,  color: 0xd2b48c },
  { key: 'saturn',  name: '토성',   radius: 58232,  color: 0xe3cf9a },
  { key: 'uranus',  name: '천왕성', radius: 25362,  color: 0x9fd8e0 },
  { key: 'neptune', name: '해왕성', radius: 24622,  color: 0x4f6fd6 },
];

// UTC 밀리초 → 율리우스일(TT). TT − UTC = 37 s(윤초, 2017~) + 32.184 s. 시안에서는 상수로 둔다.
const TT_MINUS_UTC_S = 69.184;
export function julianDateTT(utcMs) {
  return 2440587.5 + (utcMs / 1000 + TT_MINUS_UTC_S) / 86400;
}

function normDeg(x) {
  x %= 360;
  return x > 180 ? x - 360 : x <= -180 ? x + 360 : x;
}

// 케플러 방정식 E − e·sinE = M (라디안) — 뉴턴법
export function solveKepler(M, e) {
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 30; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-14) break;
  }
  return E;
}

export function elementsAt(key, jd) {
  const el = ELEMENTS[key];
  if (!el) throw new Error(`궤도 요소 없음: ${key}`);
  const T = (jd - 2451545.0) / 36525;
  const [a, e, I, L, w, O] = el[0].map((v, i) => v + el[1][i] * T);
  return { a, e, I, L, varpi: w, node: O };
}

// 궤도 요소 + 평균근점이각 M(°) → 태양 중심 황도 좌표(AU)
function positionFromElements({ a, e, I, varpi, node }, Mdeg) {
  const E = solveKepler(normDeg(Mdeg) * DEG, e);
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const w = (varpi - node) * DEG, O = node * DEG, i = I * DEG;
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i);
  return [
    (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp,
    (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp,
    (sw * si) * xp + (cw * si) * yp,
  ];
}

// 태양 중심 J2000 황도 좌표 [x, y, z] (AU). 지구는 지구-달 질량중심.
export function heliocentric(key, jd) {
  if (key === 'sun') return [0, 0, 0];
  const el = elementsAt(key, jd);
  return positionFromElements(el, el.L - el.varpi);
}

// 궤도선 점들 — 행성의 지금 위치에서 시작해 한 바퀴. 시작점이 행성 위치와 정확히 같다.
// 반환: n+1개의 [x,y,z](AU), 0번이 지금 위치, 번호가 커질수록 과거(뒤쪽).
export function orbitTrail(key, jd, n) {
  const el = elementsAt(key, jd);
  const M0 = el.L - el.varpi;
  const pts = [];
  for (let k = 0; k <= n; k++) pts.push(positionFromElements(el, M0 - (360 * k) / n));
  return pts;
}

// 황도 좌표 → three.js 좌표(Y가 황도 북극). 회전 행렬이라 좌우가 뒤집히지 않는다.
export function eclipticToScene([x, y, z]) {
  return [x, z, -y];
}
