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

// radius: 평균 반지름(카메라 거리·이름표용). re·rp: 적도·극 반지름 — 몸체는 이 회전 타원체로 그린다.
// 반지름은 IAU WGCCRE 2015(Archinal et al. 2018). 기체 행성은 1bar 면. 금성·태양은 구.
export const BODIES = [
  { key: 'sun',     name: '태양',   radius: 695700, re: 695700,    rp: 695700,    color: 0xfff4e0 },
  { key: 'mercury', name: '수성',   radius: 2439.7, re: 2440.53,   rp: 2438.26,   color: 0x9c948c },
  { key: 'venus',   name: '금성',   radius: 6051.8, re: 6051.8,    rp: 6051.8,    color: 0xe6d3a8 },
  { key: 'earth',   name: '지구',   radius: 6371.0, re: 6378.1366, rp: 6356.7519, color: 0x3d6fb4 },
  { key: 'mars',    name: '화성',   radius: 3389.5, re: 3396.19,   rp: 3376.20,   color: 0xc1623b },
  { key: 'jupiter', name: '목성',   radius: 69911,  re: 71492,     rp: 66854,     color: 0xd2b48c },
  { key: 'saturn',  name: '토성',   radius: 58232,  re: 60268,     rp: 54364,     color: 0xe3cf9a },
  { key: 'uranus',  name: '천왕성', radius: 25362,  re: 25559,     rp: 24973,     color: 0x9fd8e0 },
  { key: 'neptune', name: '해왕성', radius: 24622,  re: 24764,     rp: 24341,     color: 0x4f6fd6 },
];

// 회전 타원체(적도 반지름 re, 극 반지름 rp) 위에서 행성 중심 위도 lat(라디안)인 점의 중심 거리
export function ellipsoidRadius(re, rp, lat) {
  const c = Math.cos(lat) / re, s = Math.sin(lat) / rp;
  return 1 / Math.sqrt(c * c + s * s);
}

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

// ---------- 자세(자전축·자전) ----------
// IAU WGCCRE 2015 회전 모델(Archinal et al. 2018) — NAIF pck00011.tpc 의 값을 2026-11-21에 옮김.
//   극 RA·Dec(ICRF, °) = a0 + a1·T,  본초 자오선 W(°) = w0 + w1·d   (d: J2000 TDB부터 날, T: 세기)
//   0.01° 미만의 주기 항(수성 칭동·목성 JA~JE·화성 작은 항)은 뺐다. 화성·해왕성은 큰 주기 항만, 달은 E1~E13 전부(칭동).
const ROTATION = {
  sun:     { ra: [286.13, 0],                 dec: [63.87, 0],                  w: [84.176, 14.1844] },
  mercury: { ra: [281.0103, -0.0328],         dec: [61.4155, -0.0049],          w: [329.5988, 6.1385108] },
  venus:   { ra: [272.76, 0],                 dec: [67.16, 0],                  w: [160.20, -1.4813688] },
  earth:   { ra: [0, -0.641],                 dec: [90, -0.557],                w: [190.147, 360.9856235] },
  mars:    { ra: [317.269202, -0.10927547],   dec: [54.432516, -0.05827105],    w: [176.049863, 350.891982443297] },
  jupiter: { ra: [268.056595, -0.006499],     dec: [64.495303, 0.002413],       w: [284.95, 870.5360000] },
  saturn:  { ra: [40.589, -0.036],            dec: [83.537, -0.004],            w: [38.90, 810.7939024] },
  uranus:  { ra: [257.311, 0],                dec: [-15.175, 0],                w: [203.81, -501.1600928] },
  neptune: { ra: [299.36, 0],                 dec: [43.46, 0],                  w: [249.978, 541.1397757] },
  moon:    { ra: [269.9949, 0.0031],          dec: [66.5392, 0.0130],           w: [38.3213, 13.17635815] },
};
// 달의 주기 항 E1~E13(°, d에 대한 1차식)과 계수 — pck00011 BODY301_NUT_PREC_*. 이 항까지 넣어야 칭동이 맞는다.
const MOON_E = [[125.045, -0.0529921], [250.089, -0.1059842], [260.008, 13.0120009], [176.625, 13.3407154],
  [357.529, 0.9856003], [311.589, 26.4057084], [134.963, 13.0649930], [276.617, 0.3287146], [34.226, 1.7484877],
  [15.134, -0.1589763], [119.743, 0.0036096], [239.961, 0.1643573], [25.053, 12.9590088]];
const MOON_RA = [-3.8787, -0.1204, 0.0700, -0.0172, 0, 0.0072, 0, 0, 0, -0.0052, 0, 0, 0.0043];        // sin
const MOON_DEC = [1.5419, 0.0239, -0.0278, 0.0068, 0, -0.0029, 0.0009, 0, 0, 0.0008, 0, 0, -0.0009];   // cos
const MOON_W = [3.5610, 0.1208, -0.0642, 0.0158, 0.0252, -0.0066, -0.0047, -0.0046, 0.0028, 0.0052, 0.0040, 0.0019, -0.0044]; // sin
// J2000 황도 경사(IAU 1976, 84381.448″) — ICRF 적도 → J2000 황도
const OBLIQUITY = 84381.448 / 3600 * DEG;

// 극 RA·Dec와 W(°)
export function rotationAngles(key, jd) {
  const r = ROTATION[key];
  if (!r) throw new Error(`자전 모델 없음: ${key}`);
  const d = jd - 2451545.0, T = d / 36525;
  let ra = r.ra[0] + r.ra[1] * T, dec = r.dec[0] + r.dec[1] * T, W = r.w[0] + r.w[1] * d;
  if (key === 'mars') {
    ra += 0.419057 * Math.sin((79.398797 + 0.5042615 * T) * DEG);
    dec += 1.591274 * Math.cos((166.325722 + 0.5042615 * T) * DEG);
    W += 0.584542 * Math.sin((95.391654 + 0.5042615 * T) * DEG);
  } else if (key === 'moon') {
    W -= 1.4e-12 * d * d;
    MOON_E.forEach(([e0, e1], i) => {
      const E = (e0 + e1 * d) * DEG;
      ra += MOON_RA[i] * Math.sin(E); dec += MOON_DEC[i] * Math.cos(E); W += MOON_W[i] * Math.sin(E);
    });
  } else if (key === 'neptune') {
    const N = (357.85 + 52.316 * T) * DEG;
    ra += 0.70 * Math.sin(N); dec -= 0.51 * Math.cos(N); W -= 0.48 * Math.sin(N);
  }
  return { ra, dec, W: ((W % 360) + 360) % 360 };
}

const equToEcl = ([x, y, z]) => {
  const c = Math.cos(OBLIQUITY), s = Math.sin(OBLIQUITY);
  return [x, c * y + s * z, -s * y + c * z];
};

// 천체 고정 좌표축(J2000 황도 좌표의 단위 벡터)
//   pole: 북극(IAU 북극 — 불변면 북쪽. 천왕성·금성은 자전이 거꾸로라 W가 줄어든다)
//   prime: 적도 위 경도 0°,  east: 동경 90°.  pole = prime × east (오른손 좌표)
export function bodyAxes(key, jd) {
  const { ra, dec, W } = rotationAngles(key, jd);
  const a = ra * DEG, dl = dec * DEG, w = W * DEG;
  const p = [Math.cos(dl) * Math.cos(a), Math.cos(dl) * Math.sin(a), Math.sin(dl)];
  const q = [-Math.sin(a), Math.cos(a), 0]; // 천체 적도가 ICRF 적도를 남→북으로 지나는 곳
  const pq = [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  const x = q.map((v, i) => v * Math.cos(w) + pq[i] * Math.sin(w));
  const y = q.map((v, i) => -v * Math.sin(w) + pq[i] * Math.cos(w));
  return { pole: equToEcl(p), prime: equToEcl(x), east: equToEcl(y) };
}

// 황도 좌표 방향 v → 그 천체의 행성 중심 동경·위도(°)
export function bodyLonLat(key, jd, v) {
  const { pole, prime, east } = bodyAxes(key, jd);
  const n = Math.hypot(...v);
  const dot = u => (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / n;
  const lon = Math.atan2(dot(east), dot(prime)) / DEG;
  return { lonE: (lon + 360) % 360, lat: Math.asin(Math.max(-1, Math.min(1, dot(pole)))) / DEG };
}
