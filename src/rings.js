// 토성 고리 — 단면(광학 깊이)과 밝기·투과·그림자. three.js 없는 순수 함수(셰이더 식은 src/rings_glsl.js — 식을 고치면 둘 다, tests/rings_glsl.test.mjs가 대조).
// 단면: textures/saturn_rings.json (Cassini RSS 엄폐, tools/make_rings.py)

// 고리 경계(km) — 반사율을 가르고 고리를 그릴 범위를 정한다. C 안쪽(74,491)·A 바깥(136,774)은 이 단면에서 잰 값과 같다.
// C·B 경계(단면에서는 τ가 92,004km에서 뛴다)·B 바깥·A 안쪽은 경계 근처 작은 고리띠 때문에 단면으로 한 값을 고르기 어려워 널리 쓰는 값을 쓴다.
export const RING_EDGES = { cIn: 74490, cb: 91983, bOut: 117516, aIn: 122053, aOut: 136774 };

// 고리 알갱이 반사율(두꺼운 고리를 정면에서 볼 때의 I/F에 해당) — C고리·카시니 간극은 어둡고 붉은 기가 덜하다.
// Cassini ISS 자연색 사진을 보고 맞춘 근사값이다(1차 출처의 측정값이 아니다 — textures/출처.md). tint는 화면 색(sRGB).
export const RING_ALBEDO = [
  { to: RING_EDGES.cb,   w: 0.25, tint: [1.0, 0.95, 0.88] }, // C고리
  { to: RING_EDGES.bOut, w: 0.55, tint: [1.0, 0.90, 0.75] }, // B고리
  { to: RING_EDGES.aIn,  w: 0.30, tint: [1.0, 0.94, 0.86] }, // 카시니 간극
  { to: Infinity,        w: 0.45, tint: [1.0, 0.90, 0.76] }, // A고리
];

export function ringAlbedo(r) {
  return RING_ALBEDO.find(a => r < a.to);
}

// 반지름 r(km)의 수직 광학 깊이. 범위 밖은 0. 칸 사이는 선형 보간(셰이더의 LinearFilter와 같다)
export function ringTau(profile, r) {
  const { r0, r1, n, tau } = profile;
  if (!(r >= r0 && r <= r1)) return 0;
  const x = (r - r0) / (r1 - r0) * n - 0.5;
  const k = Math.max(0, Math.min(n - 1, Math.floor(x)));
  const k1 = Math.min(n - 1, k + 1);
  const f = Math.max(0, Math.min(1, x - k));
  return tau[k] * (1 - f) + tau[k1] * f;
}

const MU_MIN = 1e-3;

// 고리 한 점의 모습 — 얇은 판의 단일 산란(Chandrasekhar; Cuzzi et al. 1984 식).
//   tau: 수직 광학 깊이, mu·mu0: 보는 방향·햇빛과 고리면 법선 사이 각의 |cos|, sameSide: 햇빛 받는 면에서 보는가
// 돌려주는 것: T = 뒤 배경이 비쳐 보이는 몫(exp(−τ/μ)), F = 밝기(두꺼운 판을 정면에서 비추고 정면에서 볼 때 1)
//   햇빛 받는 면:   F = 2μ0/(μ+μ0) · (1 − e^{−τ(1/μ + 1/μ0)})
//   뒷면(투과광):   F = 2μ0/(μ−μ0) · (e^{−τ/μ} − e^{−τ/μ0})   (μ=μ0이면 극한 2τ/μ · e^{−τ/μ})
// 얇은 고리(τ≪1)는 두 면 모두 2τ/μ로 같고, 두꺼운 B고리는 뒷면에서 어둡다.
export function ringLight(tau, mu, mu0, sameSide) {
  return ringLight3(tau, tau, tau, mu, mu0, sameSide);
}

// ringLight를 빛길마다 다른 τ로 — 한 화소에 고리띠·틈이 섞이면 e^{−τ/μ}의 평균이 빛길 기울기마다 달라서
// (ringSlantTau) 보는 길 tauV(1/μ), 햇빛 길 tauS(1/μ0), 왕복 tauH(1/μ + 1/μ0)를 따로 받는다. 셋이 같으면 ringLight
export function ringLight3(tauV, tauS, tauH, mu, mu0, sameSide) {
  mu = Math.max(MU_MIN, Math.abs(mu));
  mu0 = Math.max(MU_MIN, Math.abs(mu0));
  const T = Math.exp(-tauV / mu);
  let F;
  if (sameSide) F = 2 * mu0 / (mu + mu0) * (1 - Math.exp(-tauH * (1 / mu + 1 / mu0)));
  else if (Math.abs(mu - mu0) < 1e-4) F = 2 * tauV / mu * T;
  else F = 2 * mu0 / (mu - mu0) * (T - Math.exp(-tauS / mu0));
  return { T, F };
}

// 점 p에서 해 쪽(단위 벡터 s)으로 간 빛줄기가 원점 중심 회전 타원체(적도 R, 극 Rp, 극축 = y)에 막히는가 — 행성이 고리에 드리우는 그림자.
// y를 R/Rp배 늘이면 반지름 R인 구 문제가 된다(셰이더 src/rings_glsl.js도 같은 식). Rp를 빼면 구.
export function inPlanetShadow(p, s, R, Rp = R) {
  const k = R / Rp;
  const P = [p[0], p[1] * k, p[2]], S = [s[0], s[1] * k, s[2]];
  const a = S[0] * S[0] + S[1] * S[1] + S[2] * S[2];
  const b = P[0] * S[0] + P[1] * S[1] + P[2] * S[2];
  if (b > 0) return false; // 몸체가 해 반대쪽에 있다
  const c = P[0] * P[0] + P[1] * P[1] + P[2] * P[2] - R * R;
  return b * b - a * c > 0;
}

// 행성 표면의 점 p에서 해 쪽(s)으로 간 빛줄기가 고리면(원점을 지나고 법선 n)을 지나는 곳의 반지름 — 고리가 행성에 드리우는 그림자
// 고리면에 닿지 않으면(해가 같은 쪽에 있거나 고리면과 거의 나란하면 — |s·n| < 1e-6) null
// 문턱 1e-6: 셰이더가 mediump(최소 정규수 약 6e-5에 가까운 정밀도)여도 0으로 나누지 않게
export function ringShadowRadius(p, s, n) {
  const pn = p[0] * n[0] + p[1] * n[1] + p[2] * n[2];
  const sn = s[0] * n[0] + s[1] * n[1] + s[2] * n[2];
  if (Math.abs(sn) < 1e-6) return null;
  const t = -pn / sn;
  if (t <= 0) return null;
  const q = [p[0] + s[0] * t, p[1] + s[1] * t, p[2] + s[2] * t];
  return Math.hypot(q[0], q[1], q[2]);
}

// 고리 그림자 속 햇빛의 몫 — 해 방향과 고리면 법선 사이 |cos|가 sn일 때 비스듬히 지나는 광학 깊이 τ/|sn|
export function ringShadowT(tau, sn) {
  return Math.exp(-tau / Math.abs(sn));
}

// 고리 한 점을 보는 방향 v·해 방향 s(단위 벡터, 법선 n)로 본 모습 — 같은 면에서 보는지는 두 방향이 고리면의 같은 쪽에 있는가
export function ringView(tau, v, s, n = [0, 1, 0]) {
  const vn = v[0] * n[0] + v[1] * n[1] + v[2] * n[2], sn = s[0] * n[0] + s[1] * n[1] + s[2] * n[2];
  return ringLight(tau, vn, sn, vn * sn > 0);
}

// 밉맵 단계(빛길 하나) — 이웃 두 칸을 투과율 exp(−τ)로 평균해 반씩 줄인다(하우메아처럼 τ가 고른 고리와 테스트용).
// 토성 고리는 ringSlantLevels — 이 평균은 정면 빛(μ=1)에서만 맞다(마지막은 1칸). 0단계는 원래 단면
export function ringMipLevels(tau) {
  const out = [Float32Array.from(tau)];
  while (out.at(-1).length > 1) {
    const a = out.at(-1), b = new Float32Array(Math.ceil(a.length / 2));
    for (let k = 0; k < b.length; k++) {
      const t0 = Math.exp(-a[2 * k]), t1 = 2 * k + 1 < a.length ? Math.exp(-a[2 * k + 1]) : t0;
      b[k] = -Math.log((t0 + t1) / 2);
    }
    out.push(b);
  }
  return out;
}

// 고리는 판이 아니라 얼음 알갱이 무리라서 한 화소(밉맵 한 칸) 안에도 촘촘한 고리띠와 틈이 섞인다.
// 그 칸을 비스듬히(μ) 지나는 빛의 몫은 칸 안 e^{−τ/μ}의 평균인데, 이것을 τ 하나로 나타내면 μ마다 값이 다르다:
//   τ_eff(μ) = −μ · ln(평균 e^{−τ/μ})   (μ→0이면 칸 안 가장 옅은 곳의 τ로 간다 — 틈새로 빛이 샌다)
// 정면(μ=1)으로 평균한 τ 하나를 쓰면 해가 낮을 때 틈이 메워져 그림자가 꽉 찬 판처럼 검어진다.
// 그래서 RING_SLANT_MU 여덟 기울기의 τ_eff를 따로 줄여 두고(RGBA 두 장), 그 사이는 ln(평균 투과율)을 1/μ에 대해 직선으로 잇는다.
export const RING_SLANT_MU = [1, 0.4, 0.16, 0.064, 0.0256, 0.01, 0.004, 0.001];

// 밉맵 단계마다 칸 × 8기울기의 τ_eff(Float32Array, 칸 k의 기울기 j는 [8k + j]). 0단계는 모든 기울기가 원래 τ.
// 평균 투과율은 칸끼리 그대로 더해지므로 ln 영역에서 합친다(τ/μ가 수천이어도 0으로 떨어지지 않게)
export function ringSlantLevels(tau) {
  const M = RING_SLANT_MU.length, S = RING_SLANT_MU.map(m => 1 / m);
  let K = new Float64Array(tau.length * M); // ln(평균 투과율)
  for (let k = 0; k < tau.length; k++) for (let j = 0; j < M; j++) K[k * M + j] = -tau[k] * S[j];
  const toTau = K => Float32Array.from(K, (v, i) => -v / S[i % M]);
  const out = [toTau(K)];
  while (K.length > M) {
    const n = K.length / M, m = Math.ceil(n / 2), N = new Float64Array(m * M);
    for (let k = 0; k < m; k++) for (let j = 0; j < M; j++) {
      const a = K[2 * k * M + j], b = 2 * k + 1 < n ? K[(2 * k + 1) * M + j] : a, hi = Math.max(a, b);
      N[k * M + j] = hi + Math.log((Math.exp(a - hi) + Math.exp(b - hi)) / 2);
    }
    K = N; out.push(toTau(K));
  }
  return out;
}

// 한 칸의 τ_eff 여덟 개(t)에서 기울기 mu의 τ_eff — ln(평균 투과율) = −τ_eff/μ를 1/μ에 대해 직선 보간(셰이더 ringSlantTau와 같은 식)
export function ringSlantTau(t, mu) {
  const S = RING_SLANT_MU.map(m => 1 / m);
  const s = 1 / Math.min(1, Math.max(MU_MIN, Math.abs(mu)));
  let j = 0;
  while (j < S.length - 2 && s > S[j + 1]) j++;
  const f = (s - S[j]) / (S[j + 1] - S[j]);
  const K = -t[j] * S[j] * (1 - f) - t[j + 1] * S[j + 1] * f;
  return -K / s;
}
