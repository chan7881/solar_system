// 태양 주연감광 — src/sun.js
// 기준값: Cox (ed.) 2000, Allen's Astrophysical Quantities, 550nm 2차식 — 가장자리 0.30, 원판 평균/가운데 0.805.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limbDarkening, LIMB_GLSL } from '../src/sun.js';
import { glslToJs } from './glsl_to_js.mjs';

test('가운데(μ=1)는 1, 가장자리(μ=0)는 0.30', () => {
  assert.ok(Math.abs(limbDarkening(1) - 1) < 1e-12);
  assert.ok(Math.abs(limbDarkening(0) - 0.30) < 1e-12);
});

test('방향: 가장자리로 갈수록(μ가 작을수록) 어두워진다 — 밝아지면(부호가 뒤집히면) 실패', () => {
  for (let m = 0.05; m <= 1; m += 0.05) assert.ok(limbDarkening(m) > limbDarkening(m - 0.05), `μ=${m.toFixed(2)}`);
});

test('원판 평균 밝기(2∫I·μ dμ)는 가운데의 80.5%', () => {
  const N = 20000; let s = 0;
  for (let i = 0; i < N; i++) { const m = (i + 0.5) / N; s += limbDarkening(m) * m; }
  assert.ok(Math.abs(2 * s / N - 0.805) < 1e-4, `${(2 * s / N).toFixed(4)}`);
});

test('반지름의 0.9배 자리(μ=√0.19)는 가운데의 약 64%', () => {
  const v = limbDarkening(Math.sqrt(1 - 0.81));
  assert.ok(Math.abs(v - 0.6617) < 1e-3, v.toFixed(4));
});

test('원판 밖(μ<0)·넘침(μ>1)은 끝값으로 묶는다', () => {
  assert.equal(limbDarkening(-0.3), limbDarkening(0));
  assert.equal(limbDarkening(1.2), limbDarkening(1));
});

test('셰이더 식이 JS 식과 같다', () => {
  const g = glslToJs(LIMB_GLSL);
  for (let m = -0.2; m <= 1.2; m += 0.01) assert.ok(Math.abs(g.limbDarkening(m) - limbDarkening(m)) < 1e-9, `μ=${m}`);
});
