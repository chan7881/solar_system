// 목성·천왕성·해왕성 고리 — 고리 표, 반지름 단면(τ·먼지 몫) 만들기, 해왕성 애덤스 고리 호. three.js 없는 순수 함수.
// 빛 식은 토성과 같다(rings.js ringLight) — 반사율만 위상 함수(src/phase.js mixedW)로. 수치 출처는 textures/출처.md 「목성형 고리」.
//
// 고리 하나: { name, r: 가운데 반지름(km), w: 폭(km), tau: 수직 광학 깊이, fd: τ 가운데 먼지 몫 }
// 모든 고리는 원형·적도면으로 둔다(천왕성 고리의 이심률 — ε 0.0079, 반지름이 ±400km 흔들림 — 은 근점 방향 자료가 없어 뺐다).

// ---------- 목성 ----------
// 반지름·τ: PDS Rings Node 「Jupiter's rings」 표(de Pater et al. 2018, Burns et al. 1999). 주 고리 τ는 Throop et al. 2004
// (먼지 4.7e-6 + 큰 알갱이 1.3e-6). 헤일로·거미줄 고리는 먼지만(큰 알갱이 안 보임). 겹친 자리는 τ를 더한다.
// 한계: 단면을 평평하게 두었다(실제는 아말테아 고리가 바깥쪽으로 밝아지는 등 결이 있다) · 두께(헤일로 약 1만km)를 납작한 판으로.
export const JUPITER_RINGS = [
  { name: '헤일로', r0: 100000, r1: 122400, tau: 1e-6, fd: 1 },
  { name: '주 고리', r0: 122400, r1: 129100, tau: 6.0e-6, fd: 4.7 / 6.0 },
  { name: '아말테아 거미줄 고리', r0: 122400, r1: 181350, tau: 5e-7, fd: 1 },
  { name: '테베 거미줄 고리', r0: 122400, r1: 221900, tau: 1e-7, fd: 1 },
  { name: '테베 고리 바깥 연장', r0: 221900, r1: 270000, tau: 1e-9, fd: 1 },
];

// ---------- 천왕성 ----------
// PDS Rings Node 「Uranus' rings」 표(Nicholson et al. 2018, Showalter & Lissauer 2006) — 가운데 반지름·폭·τ.
// 「Narrow, dense」는 큰 알갱이(fd 0), 「diffuse」는 먼지(fd 1)로 본다.
// ε고리 τ는 표에 「0.5~2.3」(근점에서 좁고 진함)이라, 원점 쪽 폭 약 96km에서 τ 0.40(Svitek & Danielson 1987)인 등가 깊이 38km를
// 평균 폭 58.1km로 나눈 0.66을 쓴다.
export const URANUS_RINGS = [
  { name: '제타 CC', r: 30863, w: 8050, tau: 1e-4, fd: 1 },
  { name: '제타 C', r: 36639, w: 2960, tau: 5e-4, fd: 1 },
  { name: '먼지 판', r: 38440, w: 23200, tau: 0.005, fd: 1 },
  { name: '제타', r: 39600, w: 3500, tau: 0.0045, fd: 1 },
  { name: '6', r: 41838, w: 1.53, tau: 0.3, fd: 0 },
  { name: '5', r: 42234, w: 2.28, tau: 0.5, fd: 0 },
  { name: '4', r: 42571, w: 2.33, tau: 0.3, fd: 0 },
  { name: '알파-4 먼지', r: 43027, w: 3353, tau: 0.002, fd: 1 },
  { name: '알파', r: 44718, w: 8.46, tau: 0.4, fd: 0 },
  { name: '베타-알파 먼지', r: 44879, w: 312, tau: 0.002, fd: 1 },
  { name: '베타', r: 45661, w: 9.49, tau: 0.3, fd: 0 },
  { name: '에타', r: 47176, w: 1.6, tau: 0.4, fd: 0 },
  { name: '에타 C', r: 47201, w: 40, tau: 0.02, fd: 1 },
  { name: '감마', r: 47627, w: 2.15, tau: 0.3, fd: 0 },
  { name: '델타 C', r: 48289, w: 15, tau: 0.03, fd: 1 },
  { name: '델타', r: 48300, w: 4.6, tau: 0.5, fd: 0 },
  { name: '람다 C', r: 49936, w: 3.1, tau: 0.15, fd: 1 },
  { name: '람다', r: 50024, w: 2.3, tau: 0.1, fd: 1 },
  { name: '엡실론', r: 51149, w: 58.1, tau: 38.4 / 58.1, fd: 0 },
  { name: '뉴', r: 67300, w: 3800, tau: 5.6e-6, fd: 1 },
  { name: '뮤', r: 97700, w: 17000, tau: 8.5e-6, fd: 1 },
];
// 큰 알갱이: 램버트 구 ϖ0 = 0.039(Svitek & Danielson 1987, ε고리)
export const URANUS_LARGE = { kind: 'lambert', w0: 0.039 };

// ---------- 해왕성 ----------
// de Pater et al. 2018 「The rings of Neptune」 표 5.1(Porco et al. 1995) · PDS Rings Node 표.
// 갈레·라셀은 「큰 알갱이 안 보임 — 먼지 몫이 클 것」이라 fd 1. 르베리에 먼지 50%, 애덤스는 호 밖 30%·호 50%.
// 아라고(라셀 바깥 가장자리 밝은 곳)·갈라테아 궤도 먼지 고리는 τ 값이 없어 뺐다.
// 알갱이는 「천왕성 고리만큼 어둡다」(같은 글 5.3절) → 천왕성과 같은 램버트 구 ϖ0 0.039.
export const NEPTUNE_RINGS = [
  { name: '갈레', r: 42000, w: 2000, tau: 1e-4, fd: 1 },
  { name: '르베리에', r: 53200, w: 100, tau: 0.003, fd: 0.5 },
  { name: '라셀', r: 55200, w: 4000, tau: 1e-4, fd: 1 },
  { name: '애덤스', r: 62933, w: 15, tau: 0.003, fd: 0.3 },
];
export const NEPTUNE_LARGE = URANUS_LARGE;

// 애덤스 고리 호(1989년 Voyager 2 모습으로 고정).
//   가운데 경도: 프라테르니테 가운데가 JD 2447757.0(1989-08-18 12h)에 251.88°(Porco et al. 1995) — 해왕성 적도면 안에서
//   J2000 적도와 만나는 오름 교점부터 잰다. 평균 운동 820.11178°/일(Souami et al. 2022, VLT 2016과 Voyager를 이음).
//   호 사이 간격: PDS 표(에갈리테 2는 프라테르니테보다 10.7° 앞, 리베르테는 에갈리테 1보다 12° 앞, 쿠라주는 리베르테보다 7.3° 앞).
//   길이·에갈리테 1의 자리: de Pater et al. 2018 그림 5.7b의 Voyager 1989 경도 단면(3° 평활)에서 읽음.
//   τ: 호 0.1(Porco et al. 1995) — 쿠라주는 가장 어두운 호라 0.05(그림에서 봉우리가 다른 호의 약 1/3, 길이도 짧다).
// 「앞」은 공전 방향(경도가 커지는 쪽).
export const ADAMS_ARC_EPOCH_JD = 2447757.0;
export const ADAMS_ARC_LON0 = 251.88;
export const ADAMS_ARC_RATE = 820.11178;
export const ADAMS_ARCS = [ // dl: 프라테르니테 가운데부터 앞쪽으로 잰 가운데 경도(°), len: 길이(°)
  { name: '프라테르니테', dl: 0, len: 10, tau: 0.1 },
  { name: '에갈리테 2', dl: 10.7, len: 2, tau: 0.1 },
  { name: '에갈리테 1', dl: 13.0, len: 2, tau: 0.1 },
  { name: '리베르테', dl: 25.0, len: 4, tau: 0.1 },
  { name: '쿠라주', dl: 32.3, len: 2, tau: 0.05 },
];
export const ADAMS_ARC_FD = 0.5;

// 프라테르니테 가운데의 경도(°, 0~360) — jd(TDB)
export function adamsArcLon(jd) {
  const L = ADAMS_ARC_LON0 + ADAMS_ARC_RATE * (jd - ADAMS_ARC_EPOCH_JD);
  return ((L % 360) + 360) % 360;
}

// 프라테르니테 가운데로부터 앞쪽으로 dl(°) 떨어진 곳의 호 τ(호 밖 0). 호 끝은 1°에 걸쳐 코사인으로 줄인다.
const EDGE = 1;
export function adamsArcTau(dl) {
  dl = ((dl + 180) % 360 + 360) % 360 - 180;
  let t = 0;
  for (const a of ADAMS_ARCS) {
    const x = Math.abs(dl - a.dl) - a.len / 2; // 호 끝에서 바깥으로 잰 거리
    const k = x <= -EDGE / 2 ? 1 : x >= EDGE / 2 ? 0 : 0.5 * (1 - Math.sin(Math.PI * x / EDGE));
    t = Math.max(t, a.tau * k);
  }
  return t;
}

// 같은 식의 GLSL — dl은 −180~180으로 접어서 넘긴다(셰이더). tests/jovian_rings.test.mjs가 대조
const arcTerm = a => `    x = abs(dl - ${a.dl.toFixed(2)}) - ${(a.len / 2).toFixed(2)};
    k = x <= ${(-EDGE / 2).toFixed(2)} ? 1.0 : (x >= ${(EDGE / 2).toFixed(2)} ? 0.0 : 0.5 * (1.0 - sin(${(Math.PI / EDGE).toFixed(9)} * x)));
    t = max(t, ${a.tau.toFixed(3)} * k);`;
export const ADAMS_ARC_GLSL = /* glsl */`
  float adamsArcTau(float dl) {
    float t = 0.0;
    float x = 0.0;
    float k = 0.0;
${ADAMS_ARCS.map(arcTerm).join('\n')}
    return t;
  }`;

// 행성 몸체 로컬 좌표(+X 경도 0°, −Z 동경 90°, +Y 북극 — main.js orient)에서 경도 L(오름 교점부터 공전 방향)인 방향의
// 각 φ = atan2(z, x). bodyAxes에서 오름 교점 q = prime·cos W − east·sin W, 공전 방향 90° 앞 p×q = prime·sin W + east·cos W이므로
// L 방향 = (cos(W − L), 0, sin(W − L)) → φ = W − L.   W: 본초 자오선 각(°, ephemeris.js rotationAngles)
export function localPhiOfLon(Wdeg, Ldeg) {
  const d = Math.PI / 180;
  return Math.atan2(Math.sin((Wdeg - Ldeg) * d), Math.cos((Wdeg - Ldeg) * d));
}

// ---------- 반지름 단면 ----------
// [r0, r1]을 n칸으로 나눠 칸마다 τ(겹친 고리는 더함)와 먼지 몫(τ 가중 평균)을 낸다.
// 칸보다 좁은 고리는 칸과 겹친 길이만큼만 넣는다(τ × 겹친 길이 / 칸 폭 — 등가 깊이를 지킨다).
// 고리 표의 항목은 { r, w } 또는 { r0, r1 } 어느 쪽이든.
export function buildProfile(rings, r0, r1, n) {
  const dr = (r1 - r0) / n;
  const tau = new Float32Array(n), dust = new Float32Array(n);
  for (const g of rings) {
    const a = g.r0 ?? g.r - g.w / 2, b = g.r1 ?? g.r + g.w / 2;
    const k0 = Math.max(0, Math.floor((a - r0) / dr)), k1 = Math.min(n - 1, Math.floor((b - r0) / dr));
    for (let k = k0; k <= k1; k++) {
      const lo = r0 + k * dr, hi = lo + dr;
      const ov = Math.max(0, Math.min(b, hi) - Math.max(a, lo));
      if (ov <= 0) continue;
      const t = g.tau * ov / dr;
      dust[k] = (dust[k] * tau[k] + g.fd * t) / (tau[k] + t);
      tau[k] += t;
    }
  }
  return { r0, r1, n, tau, dust };
}

// 먼지 몫의 밉맵 — 이웃 두 칸을 τ로 가중 평균(빛의 양은 얇은 고리에서 τ에 비례하므로). levels[0]은 원래 값
export function dustMipLevels(tau, dust) {
  const out = [Float32Array.from(dust)];
  let T = Float64Array.from(tau), D = Float64Array.from(dust);
  while (T.length > 1) {
    const m = Math.ceil(T.length / 2), T2 = new Float64Array(m), D2 = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      const i = 2 * k, j = Math.min(2 * k + 1, T.length - 1);
      const s = T[i] + T[j];
      T2[k] = s / 2;
      D2[k] = s > 0 ? (T[i] * D[i] + T[j] * D[j]) / s : (D[i] + D[j]) / 2;
    }
    T = T2; D = D2; out.push(Float32Array.from(D));
  }
  return out;
}

// 행성별 고리 묶음 — 메시 하나에 단면 하나. ⚠️ 칸 수 n은 2의 거듭제곱 — 밉맵 단계 폭을 반올림(ceil)으로 줄이는데
// WebGL은 내림(floor) 폭을 요구해, 맞지 않으면 텍스처가 「불완전」해 모두 0으로 읽혀 고리가 조용히 사라진다.
// 천왕성은 좁은 고리(0.75km 칸)와 넓은 먼지 고리(10km 칸)를 따로 둔다
// (한 단면에 다 넣으면 16384칸을 넘는다). 두 메시가 겹친 자리는 비침이 곱해지고 빛이 더해져 한 층과 같다.
const inner = g => g.r - g.w / 2 >= 41000 && g.r + g.w / 2 <= 53288;
export const RING_SETS = {
  jupiter: [{ rings: JUPITER_RINGS, r0: 100000, r1: 270000, n: 8192, large: { kind: 'jupiter' } }],
  uranus: [
    { rings: URANUS_RINGS.filter(inner), r0: 41000, r1: 53288, n: 16384, large: URANUS_LARGE },
    { rings: URANUS_RINGS.filter(g => !inner(g)), r0: 26000, r1: 107000, n: 8192, large: URANUS_LARGE },
  ],
  neptune: [{ rings: NEPTUNE_RINGS, r0: 40000, r1: 64000, n: 16384, large: NEPTUNE_LARGE, arcs: true }],
};
