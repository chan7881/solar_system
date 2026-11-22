// 혜성 코마·꼬리 — three.js 없는 순수 함수(테스트는 tests/comets.test.mjs).
// 좌표는 태양 중심 J2000 황도(km), 시각은 TT 율리우스일. 화면은 src/main.js 「혜성 꼬리」.
//
// 활동량(물 생산율) Q(r) = Q₁·g(r): g는 물 얼음 승화 곡선(Marsden, Sekanina & Yeomans 1973, AJ 78, 211 — g(1AU) = 1).
//   Q₁(1AU에서의 값)은 관측 생산율을 g로 1AU에 옮긴 크기 정도다(정확도는 2~3배 안쪽):
//   엔케·67P는 SOHO/SWAN 1AU 값(Combi et al. 2019, Icarus 317, 610), 핼리·헤일-밥은 근일점 값(약 1.5e30 · 1.7e31),
//   스위프트-터틀은 1992년 근일점 밝기로 잡은 추정.
//   헤일-밥은 3AU 밖에서도 일산화탄소로 활동했다 → 물 곡선에 r⁻² 꼴의 작은 항(farCO)을 더한다. 활동이 관측된 가장 먼 곳이
//   25.7AU(Szabó et al. 2008, ApJ 677, L121)라 그 밖은 (r/25)⁸로 끈다.
// 이온 꼬리: 태양풍(약 400km/s)이 혜성 이온을 쓸어 가는 방향 — 태양 반대쪽에서 혜성 속도만큼 뒤로 기운다
//   (u ∝ v_sw·r̂ − v). 길이는 활동량의 제곱근에 비례하게 잡고(헤일-밥 근일점 약 1억km에 맞춤), 곧은 꼬리로 그린다.
// 먼지 꼬리: 먼지 알갱이는 핵에서 떨어진 뒤 태양 중력에서 복사압(비 β)을 뺀 힘 (1−β)GM으로 케플러 운동을 한다
//   (신다인·싱크론 모형, Finson & Probstein 1968). 떨어진 시각의 혜성 위치·속도에서 그 시각까지 옮긴다 —
//   궤도면 안에서 진행 방향 뒤로 휘는 것은 이 운동에서 저절로 나온다. 밝기는 떨어질 때의 활동량에 비례.
// 코마: 고른 방향으로 퍼지는 기체의 기둥 밀도 ∝ 1/ρ — 크기는 활동량의 제곱근에 비례(헤일-밥 근일점 약 200만km에 맞춤).

export const GM_SUN = 1.32712440018e11; // km³/s² (DE440)
export const AU = 149597870.7;
export const V_SW = 400; // 태양풍 속도 km/s
const DAY = 86400;

// Qq: 기준 거리 rq(AU)에서의 물 생산율(분자/s)
export const COMET_ACTIVITY = {
  halley:      { Qq: 1.5e30, rq: 0.587 },
  encke:       { Qq: 1.0e28, rq: 1 },
  churyumov:   { Qq: 2.3e28, rq: 1 },
  swifttuttle: { Qq: 3.0e29, rq: 0.96 },
  halebopp:    { Qq: 1.7e31, rq: 0.914, farCO: 0.05 },
};
const ION_REF = 1.0e8;      // km, 헤일-밥 근일점 이온 꼬리 길이
const COMA_REF = 2.0e6;     // km, 헤일-밥 근일점 코마 반지름

// MSY 물 승화 곡선(g(1) = 1)
export function waterG(rAU) {
  const x = rAU / 2.808;
  return 0.111262 * Math.pow(x, -2.15) * Math.pow(1 + Math.pow(x, 5.093), -4.6142);
}
// 물 생산율(분자/s) — 태양 거리 r(AU)
export function production(key, rAU) {
  const c = COMET_ACTIVITY[key];
  const q1 = c.Qq / waterG(c.rq);
  return q1 * (waterG(rAU) + (c.farCO ?? 0) * Math.pow(rAU, -2) / (1 + Math.pow(rAU / 25, 8)));
}
const Q_REF = production('halebopp', COMET_ACTIVITY.halebopp.rq); // 헤일-밥 근일점 — 길이 맞춤의 기준
export const ionLength = (key, rAU) => ION_REF * Math.sqrt(production(key, rAU) / Q_REF);
export const comaRadius = (key, rAU) => COMA_REF * Math.sqrt(production(key, rAU) / Q_REF);

const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };

// 이온 꼬리 방향(단위 벡터) — r: 태양 중심 위치(km), v: 속도(km/s)
export function ionDirection(r, v) {
  const u = norm(r);
  return norm([V_SW * u[0] - v[0], V_SW * u[1] - v[1], V_SW * u[2] - v[2]]);
}

// 케플러 운동(보편 변수, Vallado 알고리즘 8) — r0(km)·v0(km/s)에서 dt(s) 뒤의 위치. mu ≤ 0이면 직선
export function kepler(r0, v0, dt, mu) {
  if (mu <= 1e-6) return [r0[0] + v0[0] * dt, r0[1] + v0[1] * dt, r0[2] + v0[2] * dt];
  const R0 = Math.sqrt(r0[0] * r0[0] + r0[1] * r0[1] + r0[2] * r0[2]), V2 = v0[0] * v0[0] + v0[1] * v0[1] + v0[2] * v0[2];
  const rv = r0[0] * v0[0] + r0[1] * v0[1] + r0[2] * v0[2];
  const alpha = 2 / R0 - V2 / mu, sm = Math.sqrt(mu);
  // 시작값: 타원은 sm·dt·α, 그 밖은 처음 속도로 간 거리. dt(x)는 x에 대해 단조 증가(dt′ = r > 0)라 뉴턴법이 모인다
  let x = alpha > 1e-12 ? sm * dt * alpha : sm * dt / R0;
  let c2 = 0.5, c3 = 1 / 6, r = R0, psi = 0;
  for (let i = 0; i < 100; i++) {
    psi = x * x * alpha;
    [c2, c3] = stumpff(psi);
    r = x * x * c2 + rv / sm * x * (1 - psi * c3) + R0 * (1 - psi * c2);
    const dx = (sm * dt - x ** 3 * c3 - rv / sm * x * x * c2 - R0 * x * (1 - psi * c3)) / r;
    x += dx;
    if (Math.abs(dx) < 1e-9 * Math.max(1, Math.abs(x))) break;
  }
  psi = x * x * alpha;
  [c2, c3] = stumpff(psi);
  const f = 1 - x * x / R0 * c2, g = dt - x ** 3 / sm * c3;
  return [f * r0[0] + g * v0[0], f * r0[1] + g * v0[1], f * r0[2] + g * v0[2]];
}
function stumpff(psi) {
  if (psi > 1e-6) { const s = Math.sqrt(psi); return [(1 - Math.cos(s)) / psi, (s - Math.sin(s)) / (s * psi)]; }
  if (psi < -1e-6) { const s = Math.sqrt(-psi); return [(1 - Math.cosh(s)) / psi, (Math.sinh(s) - s) / (s * -psi)]; }
  return [0.5 - psi / 24, 1 / 6 - psi / 120];
}

// 먼지 알갱이 표본 — 떨어진 뒤 지난 시간(나이, 0~maxAge일)과 β(0.01~1 로그, 작은 알갱이일수록 β가 크다).
// 무작위로 뽑으면 덩어리가 지고, 나이나 β를 몇 값에 몰면 같은 날 떨어진 줄(싱크론)·같은 β의 줄(신다인)이 줄무늬로 보인다 →
// (나이, log β) 평면에 R2 수열(Roberts 2018 — 황금비를 2차원으로 넓힌 고른 수열)로 고르게 흩고 나이 순으로 늘어놓는다
export const DUST = { maxAge: 120, n: 2400, nAge: 120, betaMin: 0.01, betaMax: 1 };
export function dustSamples({ maxAge, n, nAge, betaMin, betaMax } = DUST) {
  const g = 1.32471795724474602596, a1 = 1 / g, a2 = 1 / (g * g);
  const pts = Array.from({ length: n }, (_, i) => [(0.5 + a1 * i) % 1, (0.5 + a2 * i) % 1]).sort((p, q) => p[0] - q[0]);
  return { maxAge, nAge, step: maxAge / nAge,
    age: Float64Array.from(pts, p => p[0] * maxAge), beta: Float64Array.from(pts, p => betaMin * Math.pow(betaMax / betaMin, p[1])) };
}

// 먼지 알갱이 위치(핵 기준, km)와 무게 = 떨어질 때의 활동량(분자/s) × √β.
// √β: 알갱이 크기 분포 dn/da ∝ a^−3.5(Fulle 2004 등 혜성 먼지의 흔한 값)에서 log a 한 칸의 단면적(햇빛을 흩뜨리는 양) ∝ a^−0.5 ∝ √β
//   (β ∝ 1/a) — 표본은 log β로 고르게 뽑았으므로 작은 알갱이(β 큼)일수록 밝게 친다.
// state(jd) → { r: km, v: km/s } (태양 중심 황도). out: Float32Array 3×N, w: Float32Array N.
// 떨어질 때의 위치·속도는 나이 칸 경계(kΔ, Δ = 1일)에서만 계산하고 칸 안은 에르미트 3차 보간으로 잇는다
// (선형으로 이으면 근일점 핼리에서 1.7만km 틀려 핵 근처 큰 알갱이의 실제 움직임보다 커진다)
export function dustTail(key, jd, state, S, out, w, now = state(jd)) { // now: 이미 계산한 state(jd)가 있으면 넘긴다
  let a = -1, prev, next, qPrev, qNext;
  const r0 = [0, 0, 0], v0 = [0, 0, 0];
  for (let k = 0; k < S.age.length; k++) {
    const tau = S.age[k], b = Math.min(S.nAge - 1, Math.floor(tau / S.step));
    while (a < b) { // 표본이 나이 순이라 칸 경계 상태를 한 번씩만 계산한다
      a++;
      prev = a === 0 ? now : next; qPrev = a === 0 ? production(key, Math.hypot(...now.r) / AU) : qNext;
      next = state(jd - (a + 1) * S.step); qNext = production(key, Math.hypot(...next.r) / AU);
    }
    const u = tau / S.step - a;
    // 에르미트 3차 보간(양 끝의 위치·속도) — 시간은 칸 경계 prev(나중)에서 next(먼저)로 거슬러 가므로 dr/du = −hv
    const u2 = u * u, u3 = u2 * u, h = S.step * DAY;
    const a0 = 2 * u3 - 3 * u2 + 1, a1 = -(u3 - 2 * u2 + u) * h, a2 = -2 * u3 + 3 * u2, a3 = -(u3 - u2) * h;
    const d0 = (6 * u2 - 6 * u) / -h, d1 = 3 * u2 - 4 * u + 1, d2 = (-6 * u2 + 6 * u) / -h, d3 = 3 * u2 - 2 * u;
    for (let i = 0; i < 3; i++) {
      r0[i] = a0 * prev.r[i] + a1 * prev.v[i] + a2 * next.r[i] + a3 * next.v[i];
      v0[i] = d0 * prev.r[i] + d1 * prev.v[i] + d2 * next.r[i] + d3 * next.v[i];
    }
    const p = kepler(r0, v0, tau * DAY, GM_SUN * (1 - S.beta[k]));
    out[k * 3] = p[0] - now.r[0]; out[k * 3 + 1] = p[1] - now.r[1]; out[k * 3 + 2] = p[2] - now.r[2];
    w[k] = (qPrev + (qNext - qPrev) * u) * Math.sqrt(S.beta[k]);
  }
  return { out, w };
}

// 위치 함수(AU, jd → [x,y,z])로 위치·속도(km, km/s) — 가운데 차분(±0.01일)
export function stateFrom(helioAU) {
  const h = 0.01;
  return jd => {
    const p = helioAU(jd), a = helioAU(jd - h), b = helioAU(jd + h);
    return { r: p.map(x => x * AU), v: [0, 1, 2].map(i => (b[i] - a[i]) * AU / (2 * h * DAY)) };
  };
}
