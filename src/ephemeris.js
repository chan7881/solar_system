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
export const TT_MINUS_UTC_S = 69.184;
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
//   극 RA·Dec(ICRF, °) = a0 + a1·T,  본초 자오선 W(°) = w0 + w1·d + w2·d²   (d: J2000 TDB부터 날, T: 세기)
//   0.01° 미만의 주기 항(수성 칭동·목성 JA~JE·화성 작은 항)은 뺐다. 화성·해왕성은 큰 주기 항만, 달은 E1~E13 전부(칭동),
//   포보스·데이모스는 pck00011의 주기 항 전부(M1~M10), 갈릴레이 위성은 목성계 주기 항 전부(J3~J8, 2026-11-22),
//   토성 위성(미마스·엔셀라두스·테티스·디온·레아·이아페투스)은 토성계 주기 항 전부(S3~S6, 2026-11-22). 히페리온은 자세 모형이 없다(혼돈 자전).
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
  moon:    { ra: [269.9949, 0.0031],          dec: [66.5392, 0.0130],           w: [38.3213, 13.17635815, -1.4e-12] },
  io:       { ra: [268.05, -0.009],          dec: [64.50, 0.003],              w: [200.39, 203.4889538] },  // + 목성계 주기 항 J3·J4
  europa:   { ra: [268.08, -0.009],          dec: [64.51, 0.003],              w: [36.022, 101.3747235] },  // + J4~J7
  ganymede: { ra: [268.20, -0.009],          dec: [64.57, 0.003],              w: [44.064, 50.3176081] },   // + J4~J6
  callisto: { ra: [268.72, -0.009],          dec: [64.83, 0.003],              w: [259.51, 21.5710715] },   // + J5·J6·J8
  mimas:     { ra: [40.66, -0.036],          dec: [83.52, -0.004],             w: [333.46, 381.9945550] },  // + 토성계 주기 항 S3·S5
  enceladus: { ra: [40.66, -0.036],          dec: [83.52, -0.004],             w: [6.32, 262.7318996] },
  tethys:    { ra: [40.66, -0.036],          dec: [83.52, -0.004],             w: [8.95, 190.6979085] },   // + S4·S5
  dione:     { ra: [40.66, -0.036],          dec: [83.52, -0.004],             w: [357.6, 131.5349316] },
  rhea:      { ra: [40.38, -0.036],          dec: [83.55, -0.004],             w: [235.16, 79.6900478] },  // + S6
  iapetus:   { ra: [318.16, -3.949],         dec: [75.03, -1.143],             w: [355.2, 4.5379572] },
  titan:   { ra: [39.4827, 0],                dec: [83.4279, 0],                w: [186.5855, 22.5769768] }, // 주기 항 없음(pck00011도 0)
  phobos:  { ra: [317.67071657, -0.10844326], dec: [52.88627266, -0.06134706],  w: [35.18774440, 1128.84475928, 9.536137031212154e-9] }, // w2 = pck BODY401_PM 셋째 값(12.72192797°/세기²) · 주기 항 M1~M5
  deimos:  { ra: [316.65705808, -0.10518014], dec: [53.50992033, -0.05979094],  w: [79.39932954, 285.16188899] },  // + 주기 항 M6~M10
  ceres:   { ra: [291.418, 0],                dec: [66.764, 0],                 w: [170.650, 952.1532] },
  pluto:   { ra: [132.993, 0],                dec: [-6.163, 0],                 w: [302.695, 56.3625225] },
  charon:  { ra: [132.993, 0],                dec: [-6.163, 0],                 w: [122.695, 56.3625225] }, // 명왕성과 같은 축·주기(서로 마주 보고 돈다)
};
// 화성계 주기 항 각 M1~M10(°): a + b·T + c·T² — pck00011 BODY4_NUT_PREC_ANGLES 앞 10개(M5의 T² 항은 포보스의 공전 가속)
const MARS_M = [[190.72646643, 15917.10818695, 0], [21.46892470, 31834.27934054, 0], [332.86082793, 19139.89694742, 0],
  [394.93256437, 38280.79631835, 0], [189.63271560, 41215158.18420050, 12.711923222],
  [121.46893664, 660.22803474, 0], [231.05028581, 660.99123540, 0], [251.37314025, 1320.50145245, 0],
  [217.98635955, 38279.96125550, 0], [196.19729402, 19139.83628608, 0]];
// [첫 M 번호(0부터), RA 계수(sin), Dec 계수(cos), W 계수(sin)] — pck00011 BODY401·402_NUT_PREC_*
const MARS_SAT = {
  phobos: [0, [-1.78428399, 0.02212824, -0.01028251, -0.00475595, 0], [-1.07516537, 0.00668626, -0.00648740, 0.00281576, 0],
    [1.42421769, -0.02273783, 0.00410711, 0.00631964, -1.143]],
  deimos: [5, [3.09217726, 0.22980637, 0.06418655, 0.02533537, 0.00778695], [1.83936004, 0.14325320, 0.01911409, -0.01482590, 0.00192430],
    [-2.73954829, -0.39968606, -0.06563259, -0.02912940, 0.01699160]],
};
// 달의 주기 항 E1~E13(°, d에 대한 1차식)과 계수 — pck00011 BODY301_NUT_PREC_*. 이 항까지 넣어야 칭동이 맞는다.
const MOON_E = [[125.045, -0.0529921], [250.089, -0.1059842], [260.008, 13.0120009], [176.625, 13.3407154],
  [357.529, 0.9856003], [311.589, 26.4057084], [134.963, 13.0649930], [276.617, 0.3287146], [34.226, 1.7484877],
  [15.134, -0.1589763], [119.743, 0.0036096], [239.961, 0.1643573], [25.053, 12.9590088]];
const MOON_RA = [-3.8787, -0.1204, 0.0700, -0.0172, 0, 0.0072, 0, 0, 0, -0.0052, 0, 0, 0.0043];        // sin
const MOON_DEC = [1.5419, 0.0239, -0.0278, 0.0068, 0, -0.0029, 0.0009, 0, 0, 0.0008, 0, 0, -0.0009];   // cos
const MOON_W = [3.5610, 0.1208, -0.0642, 0.0158, 0.0252, -0.0066, -0.0047, -0.0046, 0.0028, 0.0052, 0.0040, 0.0019, -0.0044]; // sin
// 목성계 주기 항 각 J1~J8(°): a + b·T — pck00011 BODY5_NUT_PREC_ANGLES 앞 8개
const JUP_J = [[73.32, 91472.9], [24.62, 45137.2], [283.90, 4850.7], [355.80, 1191.3],
  [119.90, 262.1], [229.80, 64.3], [352.25, 2382.6], [113.35, 6070.0]];
// 갈릴레이 위성 계수 J1~J8 순 — [RA(sin), Dec(cos), W(sin)] · pck00011 BODY501~504_NUT_PREC_*
const GALILEAN = {
  io:       [[0, 0, 0.094, 0.024, 0, 0, 0, 0], [0, 0, 0.040, 0.011, 0, 0, 0, 0], [0, 0, -0.085, -0.022, 0, 0, 0, 0]],
  europa:   [[0, 0, 0, 1.086, 0.060, 0.015, 0.009, 0], [0, 0, 0, 0.468, 0.026, 0.007, 0.002, 0], [0, 0, 0, -0.980, -0.054, -0.014, -0.008, 0]],
  ganymede: [[0, 0, 0, -0.037, 0.431, 0.091, 0, 0], [0, 0, 0, -0.016, 0.186, 0.039, 0, 0], [0, 0, 0, 0.033, -0.389, -0.082, 0, 0]],
  callisto: [[0, 0, 0, 0, -0.068, 0.590, 0, 0.010], [0, 0, 0, 0, -0.029, 0.254, 0, -0.004], [0, 0, 0, 0, 0.061, -0.533, 0, -0.009]],
};
// 토성계 주기 항 각 S1~S6(°): a + b·T — pck00011 BODY6_NUT_PREC_ANGLES(7·8번째는 2S1·2S2라 쓰는 위성이 없다)
const SAT_S = [[353.32, 75706.7], [28.72, 75706.7], [177.40, -36505.5], [300.00, -7225.9], [316.45, 506.2], [345.20, -1016.3]];
// 토성 위성 계수 S1~S6 순 — [RA(sin), Dec(cos), W(sin)] · pck00011 BODY601·603·605_NUT_PREC_*
const SATURNIAN = {
  mimas:  [[0, 0, 13.56, 0, 0, 0], [0, 0, -1.53, 0, 0, 0], [0, 0, -13.48, 0, -44.85, 0]],
  tethys: [[0, 0, 0, 9.66, 0, 0], [0, 0, 0, -1.09, 0, 0], [0, 0, 0, -9.60, 2.23, 0]],
  rhea:   [[0, 0, 0, 0, 0, 3.10], [0, 0, 0, 0, 0, -0.35], [0, 0, 0, 0, 0, -3.08]],
};
// J2000 황도 경사(IAU 1976, 84381.448″) — ICRF 적도 → J2000 황도
const OBLIQUITY = 84381.448 / 3600 * DEG;

export const hasRotation = key => key in ROTATION;

// 극 RA·Dec와 W(°)
export function rotationAngles(key, jd) {
  const r = ROTATION[key];
  if (!r) throw new Error(`자전 모델 없음: ${key}`);
  const d = jd - 2451545.0, T = d / 36525;
  let ra = r.ra[0] + r.ra[1] * T, dec = r.dec[0] + r.dec[1] * T, W = r.w[0] + r.w[1] * d + (r.w[2] ?? 0) * d * d;
  if (key === 'mars') {
    ra += 0.419057 * Math.sin((79.398797 + 0.5042615 * T) * DEG);
    dec += 1.591274 * Math.cos((166.325722 + 0.5042615 * T) * DEG);
    W += 0.584542 * Math.sin((95.391654 + 0.5042615 * T) * DEG);
  } else if (key === 'moon') {
    MOON_E.forEach(([e0, e1], i) => {
      const E = (e0 + e1 * d) * DEG;
      ra += MOON_RA[i] * Math.sin(E); dec += MOON_DEC[i] * Math.cos(E); W += MOON_W[i] * Math.sin(E);
    });
  } else if (key in MARS_SAT) {
    const [k0, cra, cdec, cw] = MARS_SAT[key];
    for (let i = 0; i < 5; i++) {
      const [a, b, c] = MARS_M[k0 + i], M = (a + b * T + c * T * T) * DEG;
      ra += cra[i] * Math.sin(M); dec += cdec[i] * Math.cos(M); W += cw[i] * Math.sin(M);
    }
  } else if (key in GALILEAN) {
    const [cra, cdec, cw] = GALILEAN[key];
    JUP_J.forEach(([a, b], i) => {
      const J = (a + b * T) * DEG;
      ra += cra[i] * Math.sin(J); dec += cdec[i] * Math.cos(J); W += cw[i] * Math.sin(J);
    });
  } else if (key in SATURNIAN) {
    const [cra, cdec, cw] = SATURNIAN[key];
    SAT_S.forEach(([a, b], i) => {
      const S = (a + b * T) * DEG;
      ra += cra[i] * Math.sin(S); dec += cdec[i] * Math.cos(S); W += cw[i] * Math.sin(S);
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

// 적경·적위(J2000, 도) → 장면 방향(단위 벡터) — 별자리 선처럼 무한히 먼 방향
export function raDecToScene(raDeg, decDeg) {
  const a = raDeg * DEG, d = decDeg * DEG;
  return eclipticToScene(equToEcl([Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)]));
}

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
