// 고리 위상 함수(src/phase.js) — 정규화·방향(앞/뒤 산란)·출처 값 되살리기, GLSL과 JS 대조
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saturnPhaseRatio, lambertP, dustW, jupLargeW, mixedW, JUP_TAU, JUP_PHASE_TABLE, PHASE_GLSL, SATURN_PHASE_N } from '../src/phase.js';
import { glslToJs } from './glsl_to_js.mjs';

const G = glslToJs(PHASE_GLSL);
const D = Math.PI / 180;

test('토성: α = 0에서 1, 위상각이 커질수록 어두워진다(뒤쪽 산란) — Dones 1993 멱함수 n = 3.301', () => {
  assert.equal(saturnPhaseRatio(0), 1);
  assert.ok(Math.abs(saturnPhaseRatio(90 * D) - 0.5 ** 3.301) < 1e-12);
  assert.equal(SATURN_PHASE_N, 3.301);
  let prev = 2;
  for (let a = 0; a <= 180; a += 5) { const v = saturnPhaseRatio(a * D); assert.ok(v < prev, `${a}°`); prev = v; }
  assert.equal(saturnPhaseRatio(Math.PI), 0);
  // Dones et al.: P = c_n (π − α)^n, c_n = 0.130 — 4π 평균이 1이 되는 정규화와 맞는가(c_n은 그 정규화 상수)
  let s = 0; const N = 20000;
  for (let i = 0; i < N; i++) { const a = (i + 0.5) / N * Math.PI; s += 0.130 * (Math.PI - a) ** 3.301 * Math.sin(a) * Math.PI / N; }
  assert.ok(Math.abs(s / 2 - 1) < 0.01, `∫P dΩ/4π = ${s / 2}`);
});

test('램버트 구: 4π 평균 1, P(0) = 8/3, 뒤쪽이 밝다', () => {
  let s = 0; const N = 20000;
  for (let i = 0; i < N; i++) { const a = (i + 0.5) / N * Math.PI; s += lambertP(a) * Math.sin(a) * Math.PI / N; }
  assert.ok(Math.abs(s / 2 - 1) < 1e-6, `${s / 2}`);
  assert.ok(Math.abs(lambertP(0) - 8 / 3) < 1e-12);
  assert.ok(lambertP(30 * D) > lambertP(90 * D) && lambertP(90 * D) > lambertP(150 * D));
  assert.ok(Math.abs(lambertP(Math.PI)) < 1e-12);
});

test('목성 먼지: 앞쪽 산란 — 179.5°가 0°보다 1000배 넘게 밝고, 큰 알갱이는 뒤쪽이 밝다', () => {
  assert.ok(dustW(179.5 * D) / dustW(0) > 1000);
  assert.ok(dustW(170 * D) > dustW(90 * D));
  assert.ok(jupLargeW(0) > jupLargeW(90 * D) && jupLargeW(90 * D) > jupLargeW(170 * D));
});

test('목성 주 고리: 표를 되살린다 — 8·τ·W = τϖ0P(그림 6.8), 0°에서 합 약 1e-6', () => {
  for (const [a, d, l] of JUP_PHASE_TABLE) {
    assert.ok(Math.abs(8 * JUP_TAU.dust * dustW(a * D) / d - 1) < 1e-9, `먼지 ${a}°`);
    assert.ok(Math.abs(8 * JUP_TAU.large * jupLargeW(a * D) / l - 1) < 1e-9, `큰 알갱이 ${a}°`);
  }
  const tot = 8 * (JUP_TAU.dust * dustW(0) + JUP_TAU.large * jupLargeW(0));
  assert.ok(tot > 0.8e-6 && tot < 1.2e-6, `${tot}`);
  // 큰 알갱이 반사율 — W(0) = ϖ0P(0)/8. 아드라스테아 기하 반사율 0.05(같은 글)와 같은 자릿수
  assert.ok(jupLargeW(0) > 0.02 && jupLargeW(0) < 0.08, `${jupLargeW(0)}`);
});

test('mixedW: 먼지 몫 0이면 큰 알갱이, 1이면 먼지 — 천왕성 ε고리 W(0) = 0.039·(8/3)/8 = 0.013', () => {
  const U = { kind: 'lambert', w0: 0.039 };
  assert.ok(Math.abs(mixedW(0, 0, U) - 0.013) < 1e-12);
  assert.ok(Math.abs(mixedW(1, 1, U) - dustW(1)) < 1e-15);
  assert.ok(Math.abs(mixedW(1, 0, { kind: 'jupiter' }) - jupLargeW(1)) < 1e-15);
  assert.ok(mixedW(175 * D, 0.5, U) > 10 * mixedW(175 * D, 0, U)); // 먼지가 있으면 앞쪽에서 밝다
});

test('GLSL: 위상 함수 다섯 개가 JS와 같다', () => {
  for (let i = 0; i <= 3600; i++) {
    const a = i / 3600 * Math.PI;
    // 상대 1e-6 + 절대 1e-10(램버트 구는 180° 가까이에서 두 항이 거의 지워져 상수 반올림이 상대 오차로 커진다 — W는 1e-2 눈금)
    const c = (x, y, n) => assert.ok(Math.abs(x - y) <= 1e-6 * Math.abs(y) + 1e-10, `${n} ${a / D}°: ${x} / ${y}`);
    c(G.saturnPhaseRatio(a), saturnPhaseRatio(a), 'saturn');
    assert.ok(Math.abs(G.lambertP(a) - lambertP(a)) < 1e-8);
    c(G.dustW(a), dustW(a), 'dust');
    c(G.jupLargeW(a), jupLargeW(a), 'large');
    const fd = (i % 11) / 10;
    c(G.mixedW(a, fd, 1, 0), mixedW(a, fd, { kind: 'jupiter' }), 'mixJ');
    c(G.mixedW(a, fd, 0, 0.039), mixedW(a, fd, { kind: 'lambert', w0: 0.039 }), 'mixL');
  }
});
