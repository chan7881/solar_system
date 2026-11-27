// 토성 고리 검사 — 단면은 Cassini RSS 엄폐(textures/saturn_rings.json), 밝기·그림자는 src/rings.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { heliocentric, bodyAxes, bodyLonLat } from '../src/ephemeris.js';
import { RING_EDGES, ringTau, ringLight, ringAlbedo, inPlanetShadow, ringShadowRadius } from '../src/rings.js';

const profile = JSON.parse(readFileSync(new URL('../textures/saturn_rings.json', import.meta.url), 'utf8'));
const span = (a, b, f) => { const v = []; for (let r = a; r <= b; r += 5) v.push(ringTau(profile, r)); return f(v); };
const mean = v => v.reduce((s, x) => s + x, 0) / v.length;
const median = v => [...v].sort((x, y) => x - y)[v.length >> 1];

test('단면: 칸 수·범위가 고리 전체(C 안쪽 끝 ~ A 바깥 끝)를 덮는다', () => {
  assert.equal(profile.tau.length, profile.n);
  assert.ok(profile.r0 <= RING_EDGES.cIn && profile.r1 >= RING_EDGES.aOut);
  assert.ok(profile.tau.every(t => t >= 0 && t <= 5));
});

test('단면: B고리 가운데는 불투명, C고리·카시니 간극은 거의 투명, A고리는 그 사이', () => {
  assert.ok(span(100000, 110000, median) > 2.5, 'B고리 가운데');
  assert.ok(span(78000, 86000, median) < 0.3, 'C고리');
  assert.ok(span(118500, 121000, median) < 0.2, '카시니 간극');
  const a = span(124000, 130000, median);
  assert.ok(a > 0.3 && a < 1.5, `A고리 ${a}`);
});

test('단면: 간극이 제자리에 — 엔케(133,590km)·호이겐스(117,680km)·킬러(136,505km)', () => {
  for (const [name, r] of [['엔케', 133590], ['호이겐스', 117680], ['킬러', 136505]]) {
    assert.ok(span(r - 40, r + 40, v => Math.min(...v)) < 0.05, `${name} 간극이 비어 있음`);
    // 간극 양옆 A·B고리는 차 있다
    assert.ok(span(r - 400, r - 150, mean) > 0.2, `${name} 안쪽`);
  }
  assert.ok(span(130000, 133000, mean) > 0.3, '엔케 간극 바깥이 아니라 안쪽 A고리');
});

test('단면: 범위 밖은 0', () => {
  assert.equal(ringTau(profile, 60000), 0);
  assert.equal(ringTau(profile, 150000), 0);
});

test('반사율: B고리가 C고리보다 밝다', () => {
  assert.ok(ringAlbedo(105000).w > ringAlbedo(85000).w);
  assert.ok(ringAlbedo(119000).w < ringAlbedo(128000).w);
});

test('밝기: 두꺼운 판을 정면에서 비추고 정면에서 보면 F=1, 비침 0', () => {
  const { T, F } = ringLight(50, 1, 1, true);
  assert.ok(Math.abs(F - 1) < 1e-9 && T < 1e-9);
});

test('밝기: 얇은 고리는 두 면에서 같게(2τ/μ), 두꺼운 B고리는 뒷면에서 어둡다', () => {
  for (const [mu, mu0] of [[0.5, 0.3], [0.2, 0.7], [0.4, 0.4]]) {
    const lit = ringLight(0.01, mu, mu0, true).F, back = ringLight(0.01, mu, mu0, false).F;
    assert.ok(Math.abs(lit - 0.02 / mu) / lit < 0.05 && Math.abs(back - lit) / lit < 0.05, `${mu},${mu0}: ${lit} ${back}`);
  }
  const lit = ringLight(3.5, 0.5, 0.3, true).F, back = ringLight(3.5, 0.5, 0.3, false).F;
  assert.ok(lit > 0.5 && back < 0.02 && back > 0, `B고리 앞 ${lit} 뒤 ${back}`);
  // 뒷면에서는 τ가 중간(≈μ)일 때 가장 밝다 — A고리(τ≈0.5)가 B고리(τ≈3.5)보다 밝다
  assert.ok(ringLight(0.5, 0.5, 0.3, false).F > back * 10);
});

test('밝기: 뒷면 식이 μ=μ0에서 끊기지 않는다', () => {
  const a = ringLight(0.8, 0.40000, 0.4, false).F, b = ringLight(0.8, 0.40005, 0.4, false).F, c = ringLight(0.8, 0.4002, 0.4, false).F;
  assert.ok(Math.abs(a - b) < 1e-4 && Math.abs(b - c) < 1e-3, `${a} ${b} ${c}`);
});

test('비침: 비스듬히 볼수록 덜 비친다(빛길이 1/μ배)', () => {
  const t1 = ringLight(0.5, 1, 1, true).T, t2 = ringLight(0.5, 0.2, 1, true).T;
  assert.ok(t1 > t2 && Math.abs(t2 - Math.exp(-2.5)) < 1e-12);
});

test('행성 그림자: 해 반대쪽 고리는 그림자 속, 해 쪽·옆쪽은 밝다', () => {
  const R = 58232, s = [1, 0, 0];
  assert.equal(inPlanetShadow([-100000, 0, 0], s, R), true);
  assert.equal(inPlanetShadow([-100000, 0, 50000], s, R), true);
  assert.equal(inPlanetShadow([100000, 0, 0], s, R), false);
  assert.equal(inPlanetShadow([-100000, 0, 70000], s, R), false);
  assert.equal(inPlanetShadow([0, 0, 100000], s, R), false);
});

test('행성 그림자: 토성은 납작해서 구로 보면 막히는 극 근처 빛줄기가 지나간다', () => {
  const RE = 60268, RP = 54364, s = [1, 0, 0];
  assert.equal(inPlanetShadow([-100000, 56000, 0], s, RE), true);       // 구라면 막힘
  assert.equal(inPlanetShadow([-100000, 56000, 0], s, RE, RP), false);  // 극 반지름 54,364km 위로 지나간다
  assert.equal(inPlanetShadow([-100000, 53000, 0], s, RE, RP), true);
  assert.equal(inPlanetShadow([-100000, 0, 60000], s, RE, RP), true);   // 적도 방향은 그대로 60,268km까지
  assert.equal(inPlanetShadow([-100000, 0, 61000], s, RE, RP), false);
});

test('몸체 모양: 행성 중심 위도의 타원체 거리 — 적도는 re, 극은 rp, 45°는 그 사이', async () => {
  const { BODIES, ellipsoidRadius } = await import('../src/ephemeris.js');
  const sat = BODIES.find(b => b.key === 'saturn');
  assert.equal(sat.re, 60268); assert.equal(sat.rp, 54364);
  assert.ok(Math.abs(ellipsoidRadius(sat.re, sat.rp, 0) - 60268) < 1e-6);
  assert.ok(Math.abs(ellipsoidRadius(sat.re, sat.rp, Math.PI / 2) - 54364) < 1e-6);
  const r = ellipsoidRadius(sat.re, sat.rp, Math.PI / 4), x = r * Math.SQRT1_2;
  assert.ok(Math.abs((x / sat.re) ** 2 + (x / sat.rp) ** 2 - 1) < 1e-12, '45° 점이 타원체 위에 있다');
  for (const b of BODIES) assert.ok(b.rp <= b.re && Math.abs(b.radius / b.re - 1) < 0.04, b.key);
});

// 2026-11-21 실제 배치 — 해는 2025-05 고리면을 지나 남쪽에 있다 → 고리 그림자는 북반구에 진다
const JD = 2461365.5;
const sunDir = () => { const p = heliocentric('saturn', JD), n = Math.hypot(...p); return p.map(v => -v / n); };

test('해가 토성 고리면을 지나는 때: 2025-05-06 앞뒤로 북쪽→남쪽', () => {
  const lat = jd => bodyLonLat('saturn', jd, heliocentric('saturn', jd).map(v => -v)).lat;
  const jd0 = 2460801.5; // 2025-05-06 00:00
  assert.ok(lat(jd0 - 30) > 0 && lat(jd0 + 30) < 0, `${lat(jd0 - 30)} → ${lat(jd0 + 30)}`);
  assert.ok(lat(JD) < 0, '2026-11 해는 남쪽');
});

test('고리 그림자(2026-11-21): 북반구 낮 쪽에 떨어지고 남반구에는 없다', () => {
  const s = sunDir(), { pole, prime, east } = bodyAxes('saturn', JD);
  const lon = bodyLonLat('saturn', JD, s).lonE * Math.PI / 180;
  const R = 58232;
  // 태양 직하 경도의 위도 φ 지점
  const at = phi => {
    const f = phi * Math.PI / 180, c = Math.cos(f);
    return [0, 1, 2].map(i => R * (c * Math.cos(lon) * prime[i] + c * Math.sin(lon) * east[i] + Math.sin(f) * pole[i]));
  };
  const shadowed = phi => { const r = ringShadowRadius(at(phi), s, pole); return r !== null && ringTau(profile, r) > 0.5; };
  const north = [];
  for (let phi = 2; phi <= 60; phi += 1) if (shadowed(phi)) north.push(phi);
  assert.ok(north.length >= 3, `북반구 그림자 위도 ${north}`);
  for (let phi = -60; phi <= -2; phi += 1) assert.equal(ringShadowRadius(at(phi), s, pole), null, `남반구 ${phi}°`);
});

test('밉맵: 투과율로 평균 — 불투명(τ=5)과 빈틈(τ=0)을 섞으면 반쯤 비친다(τ 평균 2.5면 8%만 비친다)', async () => {
  const { ringMipLevels } = await import('../src/rings.js');
  const L = ringMipLevels([5, 0, 5, 0]);
  assert.deepEqual(L.map(l => l.length), [4, 2, 1]);
  const T = Math.exp(-L[1][0]);
  assert.ok(Math.abs(T - (Math.exp(-5) + 1) / 2) < 1e-6, `T=${T}`);
  // 실제 단면: 아주 거친 단계에서도 카시니 간극이 B고리보다 잘 비친다
  const P = ringMipLevels(profile.tau), lv = P[6], at = r => lv[Math.floor((r - profile.r0) / (profile.r1 - profile.r0) * lv.length)];
  assert.ok(at(119800) < 0.5 && at(105000) > 2, `간극 ${at(119800)} B ${at(105000)}`);
});

// 고리는 판이 아니라 알갱이 무리 — 한 칸에 고리띠와 틈이 섞이면 비스듬한 빛은 틈으로 샌다(rings.js ringSlantLevels)
const zoneT = (levels, lv, mu, a, b, f) => { // 그 구역 칸들의 평균 투과율: f(칸 번호, 단계) → 투과율
  let sum = 0, n = 0; const s = 1 << lv, dr = (profile.r1 - profile.r0) / profile.n;
  for (let k = 0; k < profile.n / s; k++) { const r = profile.r0 + (k + 0.5) * s * dr; if (r < a || r > b) continue; sum += f(k, s); n++; }
  return sum / n;
};
const trueT = mu => (k, s) => { let m = 0; for (let j = k * s; j < (k + 1) * s; j++) m += Math.exp(-profile.tau[j] / mu); return m / s; };

test('기울기 밉맵: 0단계는 모든 기울기가 원래 τ, 불투명(τ=5)·빈틈(τ=0) 반반은 μ=0.1에서도 반쯤 비친다', async () => {
  const { ringSlantLevels, ringSlantTau, RING_SLANT_MU } = await import('../src/rings.js');
  const L = ringSlantLevels([5, 0, 5, 0]);
  assert.deepEqual(L.map(l => l.length / RING_SLANT_MU.length), [4, 2, 1]);
  for (let j = 0; j < 8; j++) assert.ok(Math.abs(L[0][j] - 5) < 1e-5 && Math.abs(L[0][8 + j]) < 1e-9);
  for (const mu of RING_SLANT_MU) { // 기울기마다 정확히: (e^{−5/μ} + 1)/2
    const T = Math.exp(-ringSlantTau(L[1].slice(0, 8), mu) / mu);
    assert.ok(Math.abs(T - (Math.exp(-5 / mu) + 1) / 2) < 1e-4, `μ=${mu} T=${T}`);
  }
  // 한 τ로 평균한 예전 방식은 μ=0.1에서 0.1%만 비친다
  const { ringMipLevels } = await import('../src/rings.js');
  assert.ok(Math.exp(-ringMipLevels([5, 0, 5, 0])[1][0] / 0.1) < 0.002);
});

test('기울기 밉맵: 실제 단면을 줄여도 비스듬한 투과율이 칸 안 평균과 맞는다(최대 오차 0.04, 기울기 사이 보간 포함)', async () => {
  const { ringSlantLevels, ringSlantTau } = await import('../src/rings.js');
  const L = ringSlantLevels(profile.tau);
  let worst = 0, at;
  for (const lv of [1, 3, 5, 7, 9]) for (const mu of [0.7, 0.45, 0.2, 0.1, 0.05, 0.02, 0.008, 0.003]) {
    const s = 1 << lv, tm = trueT(mu);
    for (let k = 0; k < profile.n / s; k++) {
      const e = Math.abs(Math.exp(-ringSlantTau(L[lv].slice(8 * k, 8 * k + 8), mu) / mu) - tm(k, s));
      if (e > worst) { worst = e; at = `lv${lv} μ${mu} k${k}`; }
    }
  }
  assert.ok(worst < 0.04, `최대 오차 ${worst} (${at})`);
});

test('고리 그림자(해 고도 μ0=0.1, 1km 칸 단계): A고리·카시니 간극은 틈으로 빛이 새고 B고리는 막힌다', async () => {
  const { ringSlantLevels, ringSlantTau, ringMipLevels } = await import('../src/rings.js');
  const L = ringSlantLevels(profile.tau), O = ringMipLevels(profile.tau), lv = 6, mu = 0.1;
  const slant = (k) => Math.exp(-ringSlantTau(L[lv].slice(8 * k, 8 * k + 8), mu) / mu);
  const A = [122053, 136774], CD = [117516, 122053], B = [95000, 115000];
  const zs = z => zoneT(L, lv, mu, ...z, slant), zt = z => zoneT(L, lv, mu, ...z, trueT(mu)), zo = z => zoneT(L, lv, mu, ...z, k => Math.exp(-O[lv][k] / mu));
  for (const z of [A, CD]) assert.ok(Math.abs(zs(z) - zt(z)) < 0.1 * zt(z), `${z}: 새 ${zs(z)} 참 ${zt(z)}`);
  assert.ok(zt(A) > 0.015 && zo(A) < 0.3 * zt(A), `A고리: 참 ${zt(A)} 예전 ${zo(A)}`); // 예전 방식은 A고리 그림자가 거의 꽉 막힘
  assert.ok(zs(CD) > zs(A) && zs(A) > 10 * zs(B), `간극 ${zs(CD)} A ${zs(A)} B ${zs(B)}`);
});
