// 혜성 코마·꼬리 — 활동량 곡선, 케플러 운동, 이온 꼬리 방향(부호까지), 먼지 꼬리가 놓이는 쪽
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waterG, production, ionLength, comaRadius, ionDirection, kepler, dustSamples, dustTail, stateFrom, GM_SUN, AU, V_SW, COMET_ACTIVITY, DUST } from '../src/comets.js';
import { smallBodyHelio } from '../src/smallbodies.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const DAY = 86400;
const KEYS = Object.keys(COMET_ACTIVITY);
// 근일점 무렵(Horizons 요소로 앱이 그리는 날)
const PERI = { halley: 2446470.5, encke: 2460240.5, churyumov: 2457247.5, swifttuttle: 2448965.5, halebopp: 2450539.5 };

test('물 승화 곡선: g(1AU) = 1, 0.3~10AU에서 줄곧 줄고 3AU 밖에서 가파르게 떨어진다', () => {
  assert.ok(Math.abs(waterG(1) - 1) < 2e-3, `g(1) = ${waterG(1)}`);
  let prev = Infinity;
  for (let r = 0.3; r <= 10; r += 0.1) { const g = waterG(r); assert.ok(g < prev, `r=${r.toFixed(1)}`); prev = g; }
  assert.ok(waterG(2) / waterG(1) > 0.1, '2AU는 아직 활발');
  assert.ok(waterG(5) / waterG(2) < 1e-4, `5AU/2AU = ${waterG(5) / waterG(2)}`);
});

test('활동량: 기준 거리에서 관측값 그대로, 헤일-밥만 5AU에서도 물 곡선보다 크다(일산화탄소)', () => {
  for (const k of KEYS) {
    const { Qq, rq } = COMET_ACTIVITY[k];
    const far = COMET_ACTIVITY[k].farCO ?? 0;
    assert.ok(Math.abs(production(k, rq) / (Qq * (1 + far * rq ** -2 / (1 + (rq / 25) ** 8) / waterG(rq))) - 1) < 1e-12, k);
    assert.ok(production(k, 0.8) > production(k, 2) && production(k, 2) > production(k, 5), k);
  }
  const ratio = k => production(k, 5) / production(k, 1);
  assert.ok(ratio('halebopp') > 100 * ratio('halley'), `${ratio('halebopp')} 대 ${ratio('halley')}`);
  // 활동이 관측된 가장 먼 곳(25.7AU) 밖에서는 꺼진다 — 2026년(약 50AU)에 꼬리가 보이면 안 된다
  assert.ok(production('halebopp', 50) < 1e25, `50AU ${production('halebopp', 50).toExponential(2)}`);
  assert.ok(production('halebopp', 20) > 1e27, `20AU ${production('halebopp', 20).toExponential(2)}`);
});

test('이온 꼬리·코마 크기: 헤일-밥 근일점이 1억km·200만km, 태양에서 멀수록 짧다', () => {
  const { rq } = COMET_ACTIVITY.halebopp;
  assert.ok(Math.abs(ionLength('halebopp', rq) / 1e8 - 1) < 1e-9);
  assert.ok(Math.abs(comaRadius('halebopp', rq) / 2e6 - 1) < 1e-9);
  for (const k of KEYS) assert.ok(ionLength(k, 0.6) > ionLength(k, 1.5) && ionLength(k, 1.5) > ionLength(k, 3), k);
});

test('케플러: 원 궤도 1/4 바퀴는 +x에서 +y로(공전 방향), 거꾸로 돌리면 제자리', () => {
  const r = AU, v = Math.sqrt(GM_SUN / r), T = 2 * Math.PI * Math.sqrt(r ** 3 / GM_SUN);
  const p = kepler([r, 0, 0], [0, v, 0], T / 4, GM_SUN);
  assert.ok(Math.abs(p[0]) < 1 && Math.abs(p[1] - r) < 1 && Math.abs(p[2]) < 1, p.map(x => (x / r).toFixed(9)).join(' '));
  const q = kepler([r, 0, 0], [0, v, 0], -T / 4, GM_SUN);
  assert.ok(Math.abs(q[1] + r) < 1, '과거로 돌리면 −y');
});

test('케플러: 타원·쌍곡선 모두 에너지와 각운동량이 보존된다(속도는 위치 차분으로)', () => {
  const r0 = [1.2 * AU, 0.3 * AU, 0.1 * AU];
  for (const [v0, mu] of [[[5, 30, 3], GM_SUN], [[5, 30, 3], GM_SUN * 0.3], [[20, 60, 10], GM_SUN]]) {
    const E = (r, v) => dot(v, v) / 2 - mu / len(r);
    for (const dt of [10 * DAY, 200 * DAY]) {
      const h = 1, a = kepler(r0, v0, dt - h, mu), b = kepler(r0, v0, dt + h, mu), p = kepler(r0, v0, dt, mu);
      const v = [(b[0] - a[0]) / (2 * h), (b[1] - a[1]) / (2 * h), (b[2] - a[2]) / (2 * h)];
      assert.ok(Math.abs(E(p, v) / E(r0, v0) - 1) < 1e-6, `에너지 ${E(p, v)} 대 ${E(r0, v0)}`);
      const L0 = cross(r0, v0), L1 = cross(p, v);
      assert.ok(len(sub(L1, L0)) / len(L0) < 1e-6, '각운동량');
    }
  }
});

test('케플러: 중력이 없으면(β = 1) 곧은 줄', () => {
  const p = kepler([AU, 0, 0], [3, 40, 1], 10 * DAY, 0);
  assert.deepEqual(p, [AU + 3 * 10 * DAY, 40 * 10 * DAY, 10 * DAY]);
});

test('이온 꼬리: 태양 반대쪽에서 진행 방향 뒤로 atan(v⊥ / (v_sw − v_r))만큼 기운다', () => {
  for (const k of KEYS) {
    const s = stateFrom(jd => smallBodyHelio(k, jd))(PERI[k]);
    const u = unit(s.r), d = ionDirection(s.r, s.v);
    const vr = dot(s.v, u), vp = len(sub(s.v, u.map(x => x * vr)));
    const ang = Math.acos(Math.min(1, dot(d, u)));
    assert.ok(Math.abs(ang - Math.atan2(vp, V_SW - vr)) < 1e-9, `${k} ${ang}`);
    assert.ok(ang > 2 * Math.PI / 180 && ang < 15 * Math.PI / 180, `${k} ${(ang * 180 / Math.PI).toFixed(2)}°`);
    // 부호: 꼬리의 진행 방향 성분이 태양 반대 방향보다 작다(뒤로 기욺)
    const vt = unit(sub(s.v, u.map(x => x * vr)));
    assert.ok(dot(d, vt) < 0, `${k} 진행 방향 성분 ${dot(d, vt)}`);
  }
});

const S = dustSamples();
test('먼지 표본: 개수·나이 순·β 범위, 나이 칸마다 표본이 있다', () => {
  assert.equal(S.age.length, DUST.n);
  for (let k = 1; k < S.age.length; k++) assert.ok(S.age[k] >= S.age[k - 1]);
  assert.ok(Math.min(...S.beta) >= DUST.betaMin && Math.max(...S.beta) <= DUST.betaMax);
  const bins = new Array(DUST.nAge).fill(0);
  for (const a of S.age) bins[Math.min(DUST.nAge - 1, Math.floor(a / S.step))]++;
  assert.ok(Math.min(...bins) >= 15 && Math.max(...bins) <= 25, `${Math.min(...bins)}~${Math.max(...bins)}`);
});

function tail(k, jd) {
  const st = stateFrom(j => smallBodyHelio(k, j)), N = S.age.length;
  const out = new Float64Array(N * 3), w = new Float64Array(N);
  dustTail(k, jd, st, S, out, w);
  return { out, w, s: st(jd) };
}

test('먼지 꼬리: 태양 반대쪽·진행 방향 뒤에 놓이고 궤도면에서 벗어나지 않는다', () => {
  for (const k of ['halley', 'halebopp', 'encke']) {
    const { out, w, s } = tail(k, PERI[k]);
    const u = unit(s.r), n = unit(cross(s.r, s.v)), t = cross(n, u); // t: 궤도면 안에서 진행 쪽
    let R = 0, T = 0, Nn = 0, W = 0, ext = 0;
    for (let i = 0; i < w.length; i++) {
      const p = [out[i * 3], out[i * 3 + 1], out[i * 3 + 2]];
      R += w[i] * dot(p, u); T += w[i] * dot(p, t); Nn += w[i] * Math.abs(dot(p, n)); W += w[i];
      ext = Math.max(ext, len(p));
    }
    assert.ok(R / W > 1e6, `${k} 태양 반대쪽 ${(R / W / 1e6).toFixed(2)}백만km`);
    assert.ok(T / W < -1e6, `${k} 진행 방향 ${(T / W / 1e6).toFixed(2)}백만km`);
    assert.ok(Nn / W < 0.01 * ext, `${k} 궤도면 밖 ${(Nn / W / 1e6).toFixed(3)} / 최대 ${(ext / 1e6).toFixed(0)}백만km`);
  }
});

test('먼지 꼬리: 같은 나이면 β가 클수록(작은 알갱이) 태양 반대쪽으로 멀리 간다', () => {
  const k = 'halebopp', jd = PERI[k], st = stateFrom(j => smallBodyHelio(k, j));
  const one = beta => {
    const T = { age: Float64Array.of(30), beta: Float64Array.of(beta), nAge: 120, step: 1 };
    const o = new Float64Array(3), w = new Float64Array(1);
    dustTail(k, jd, st, T, o, w);
    return dot([o[0], o[1], o[2]], unit(st(jd).r));
  };
  const d = [0.01, 0.05, 0.2, 1].map(one);
  for (let i = 1; i < d.length; i++) assert.ok(d[i] > d[i - 1], d.map(x => (x / 1e6).toFixed(2)).join(' '));
});

test('먼지 꼬리: β = 0이면 알갱이가 핵을 따라간다(떨어진 시각을 과거로 잡았는지)', () => {
  for (const k of ['halley', 'halebopp']) {
    const st = stateFrom(j => smallBodyHelio(k, j));
    const T = { age: Float64Array.of(3.5, 30.5), beta: Float64Array.of(0, 0), nAge: 31, step: 1 };
    const o = new Float64Array(6), w = new Float64Array(2);
    dustTail(k, PERI[k], st, T, o, w);
    // 3.5일: 칸 안 보간 오차(에르미트 74km · 선형이면 1.7만km) · 30일: Horizons 요소를 1년마다 섞는 위치와 순수 케플러 운동의 차이(3,400km)
    assert.ok(len([o[0], o[1], o[2]]) < 500 && len([o[3], o[4], o[5]]) < 1e4, `${k} ${len([o[0], o[1], o[2]]).toFixed(0)} · ${len([o[3], o[4], o[5]]).toFixed(0)}km`);
  }
});

test('먼지 무게: 떨어질 때의 활동량 × √β', () => {
  const k = 'halley', jd = PERI[k], st = stateFrom(j => smallBodyHelio(k, j));
  const T = { age: Float64Array.of(10), beta: Float64Array.of(0.25), nAge: 120, step: 1 };
  const o = new Float64Array(3), w = new Float64Array(1);
  dustTail(k, jd, st, T, o, w);
  const q10 = production(k, len(st(jd - 10).r) / AU), q11 = production(k, len(st(jd - 11).r) / AU);
  assert.ok(Math.abs(w[0] / (0.5 * q10) - 1) < Math.abs(q11 / q10 - 1) + 1e-9, `${w[0]} 대 ${0.5 * q10}`);
});
