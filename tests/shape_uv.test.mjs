// 모양 모형 지도 좌표(shapeUV) — 방향·이음매
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseShape, shapeUV } from '../src/shapes.js';

const load = key => { const b = readFileSync(new URL(`../textures/${key}_shape.bin`, import.meta.url)); return parseShape(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };

test('shapeUV: 경도 0°(+X)는 u 0.5, 동경 90°(−Z)는 u 0.75, 북극 쪽(+Y)은 v가 1에 가깝다', () => {
  const s = { positions: new Float32Array([10, 0, 0, 0, 0, -10, 0.01, 10, 0, -10, 0, 0.001]), index: new Uint16Array([0, 1, 2]) };
  const { uv } = shapeUV(s);
  assert.ok(Math.abs(uv[0] - 0.5) < 1e-6 && Math.abs(uv[1] - 0.5) < 1e-6, `${uv[0]} ${uv[1]}`);
  assert.ok(Math.abs(uv[2] - 0.75) < 1e-6, `동경 90°: ${uv[2]}`);
  assert.ok(uv[5] > 0.99, `북극: ${uv[5]}`);
  assert.ok(uv[6] > 0.99 || uv[6] < 0.01, `경도 180°: ${uv[6]}`);
});

test('shapeUV: 이음매를 가로지르는 면이 없다 — 히페리온 모든 면의 u 폭 < 0.25, 위치는 그대로', () => {
  const s = load('hyperion'), o = shapeUV(s);
  let worst = 0, crossed = 0;
  for (let f = 0; f < o.index.length; f += 3) {
    const us = [0, 1, 2].map(k => o.uv[o.index[f + k] * 2]);
    const w = Math.max(...us) - Math.min(...us);
    // 극을 둘러싼 면은 경도가 한 바퀴 돌 수 있다 — 위도 80° 안쪽만 잰다
    const polar = [0, 1, 2].some(k => Math.abs(o.uv[o.index[f + k] * 2 + 1] - 0.5) > 80 / 180);
    if (!polar) worst = Math.max(worst, w);
    if (us.some(u => u > 1)) crossed++;
  }
  assert.ok(worst < 0.25, `u 폭 최대 ${worst}`);
  assert.ok(crossed > 10, `이음매 면 ${crossed}개`);
  for (let f = 0; f < s.index.length; f++) {
    const a = s.index[f], b = o.index[f];
    for (let k = 0; k < 3; k++) assert.equal(o.positions[b * 3 + k], s.positions[a * 3 + k]);
  }
});
