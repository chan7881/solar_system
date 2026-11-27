// 고리 알갱이의 위상 함수 — 고리 밝기가 위상각 α(해–고리–눈 사이 각, 0 = 해를 등지고 봄)에 따라 어떻게 바뀌는가.
// three.js 없는 순수 함수와 같은 식의 GLSL(PHASE_GLSL). 식을 고치면 둘 다 — tests/phase.test.mjs가 대조한다.
//
// 앱의 고리 빛 식(rings.js ringLight)은 밝기 F에 반사율 w를 곱한다. 얇은 고리의 단일 산란 I/F = τ·ϖ0·P(α)/(4μ)이고
// ringLight의 얇은 극한은 2τ/μ라서, 위상 함수가 들어간 반사율은 W(α) = ϖ0·P(α)/8 이다(P는 4π 평균이 1이 되게 정규화).
// 두꺼운 고리를 μ = μ0, α = 0에서 보면 I/F = W(0) — 토성 고리의 RING_ALBEDO w가 바로 이 값이다.

const PI = Math.PI;
const DEG = PI / 180;

// ---------- 토성 주 고리(거시 알갱이) ----------
// Dones, Cuzzi & Showalter 1993 (Icarus 105, 184) — Voyager A고리 광도: P(α) = c_n (π − α)^n, n = 3.301, c_n = 0.130
// (위상각 약 6~155°, 칼리스토와 닮은 뒤쪽 산란). 반사율 w(α = 0)는 rings.js RING_ALBEDO 그대로 두고 α에 따른 비만 곱한다.
// B·C고리·카시니 간극에도 같은 n을 쓴다(따로 맞춘 값을 못 찾음 — 1차 출처는 A고리뿐).
export const SATURN_PHASE_N = 3.301;
export function saturnPhaseRatio(a) {
  return Math.pow(Math.max(0, PI - a) / PI, SATURN_PHASE_N);
}

// ---------- 램버트 구 ----------
// 표면이 램버트 반사인 공 하나의 위상 함수(4π 평균 1): P(α) = 8/(3π) · (sin α + (π − α) cos α), P(0) = 8/3.
// 천왕성 ε고리 알갱이 ϖ0 = 0.039 ± 0.006 이 이 가정으로 낸 값이다(Svitek & Danielson 1987, JGR 92 — 「Lambert surface」).
export function lambertP(a) {
  return 8 / (3 * PI) * (Math.sin(a) + (PI - a) * Math.cos(a));
}

// ---------- 목성 주 고리(먼지 + 큰 알갱이) ----------
// Throop et al. 2004(Icarus 172) 최적 모형 — de Pater et al. 2018 「The Rings of Jupiter」 그림 6.8(0.46μm)에서 읽은 τ·ϖ0·P(α).
// 먼지 τ = 4.7e-6, 큰 알갱이 τ = 1.3e-6(같은 논문). 그림의 세로축이 로그라 읽은 값의 오차는 약 ±20%.
// 큰 알갱이 곡선은 그림 아래(1e-8)로 나가는 124° 뒤를 같은 기울기로 이었다. 먼지는 179.5°에서 약 7e-4(Galileo SSI 점).
export const JUP_TAU = { dust: 4.7e-6, large: 1.3e-6 };
export const JUP_PHASE_TABLE = [ // [α(°), 먼지 τϖ0P, 큰 알갱이 τϖ0P]
  [0, 4.5e-7, 5.0e-7],
  [10, 3.5e-7, 4.5e-7],
  [20, 2.8e-7, 4.0e-7],
  [45, 1.1e-7, 2.7e-7],
  [60, 1.15e-7, 2.0e-7],
  [80, 1.4e-7, 1.15e-7],
  [100, 1.5e-7, 6.5e-8],
  [120, 3.8e-7, 2.5e-8],
  [135, 8.0e-7, 8e-9],
  [150, 1.6e-6, 2.5e-9],
  [160, 3.2e-6, 1.2e-9],
  [170, 7.8e-6, 5e-10],
  [175, 1.6e-5, 3e-10],
  [178, 8.0e-5, 2e-10],
  [179.5, 7.0e-4, 1.5e-10],
  [180, 1.0e-3, 1.5e-10],
];
// 표의 한 열을 τ로 나누고 8로 나눈 W(α)의 ln 값 — 칸 사이는 ln W를 α에 대해 직선으로
const lnW = (col, tau) => JUP_PHASE_TABLE.map(r => Math.log(r[col] / tau / 8));
const JUP_A = JUP_PHASE_TABLE.map(r => r[0] * DEG);
const JUP_LN = { dust: lnW(1, JUP_TAU.dust), large: lnW(2, JUP_TAU.large) };
function tableW(ln, a) {
  a = Math.min(PI, Math.max(0, a));
  let j = 0;
  while (j < JUP_A.length - 2 && a > JUP_A[j + 1]) j++;
  const f = (a - JUP_A[j]) / (JUP_A[j + 1] - JUP_A[j]);
  return Math.exp(ln[j] * (1 - f) + ln[j + 1] * f);
}
// 먼지·큰 알갱이 τ 1당 반사율 W(α) — 천왕성·해왕성의 먼지 고리도 목성 먼지 곡선을 쓴다(같은 μm 먼지라고 가정 — textures/출처.md)
export const dustW = a => tableW(JUP_LN.dust, a);
export const jupLargeW = a => tableW(JUP_LN.large, a);

// 큰 알갱이 종류: { kind: 'jupiter' }(표) · { kind: 'lambert', w0 }(램버트 구)
// 고리 한 점의 반사율 = (1 − fd)·큰 알갱이 W + fd·먼지 W   (fd: 그 자리 τ 가운데 먼지 몫)
export function mixedW(a, fd, large) {
  const L = large.kind === 'jupiter' ? jupLargeW(a) : large.w0 * lambertP(a) / 8;
  return (1 - fd) * L + fd * dustW(a);
}

// 위상각: 해 쪽 단위 벡터 s와 눈 쪽 단위 벡터 v 사이의 각
export function phaseAngle(v, s) {
  return Math.acos(Math.max(-1, Math.min(1, v[0] * s[0] + v[1] * s[1] + v[2] * s[2])));
}

// ---------- GLSL ----------
const g = x => (Number.isInteger(x) ? x.toFixed(1) : x.toPrecision(9));
const seg = (ln, name) => {
  const n = JUP_A.length;
  const lines = [];
  for (let j = 0; j < n - 2; j++) lines.push(`    if (a <= ${g(JUP_A[j + 1])}) return exp(phaseSeg(${g(ln[j])}, ${g(ln[j + 1])}, ${g(JUP_A[j])}, ${g(JUP_A[j + 1])}, a));`);
  return `  float ${name}(float a0) {
    float a = min(${g(PI)}, max(0.0, a0));
${lines.join('\n')}
    return exp(phaseSeg(${g(ln[n - 2])}, ${g(ln[n - 1])}, ${g(JUP_A[n - 2])}, ${g(JUP_A[n - 1])}, a));
  }`;
};
export const PHASE_GLSL = /* glsl */`
  float phaseSeg(float y0, float y1, float x0, float x1, float x) {
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }

  float saturnPhaseRatio(float a) {
    return pow(max(0.0, ${g(PI)} - a) / ${g(PI)}, ${g(SATURN_PHASE_N)});
  }

  float lambertP(float a) {
    return ${g(8 / (3 * PI))} * (sin(a) + (${g(PI)} - a) * cos(a));
  }

${seg(JUP_LN.dust, 'dustW')}

${seg(JUP_LN.large, 'jupLargeW')}

  float mixedW(float a, float fd, float largeKind, float w0) {
    float L = largeKind > 0.5 ? jupLargeW(a) : w0 * lambertP(a) / 8.0;
    return (1.0 - fd) * L + fd * dustW(a);
  }`;
