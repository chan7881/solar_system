// 햇빛 노출 — src/exposure.js. 정답이 정해진 것: 햇빛은 1/r²(초점 대비), 초점 천체 자신은 늘 1,
// 가까울수록 밝고 멀수록 어둡다(방향), 화면 밝기 폭에서 잘린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refDistance, lightScale, LIGHT_MIN, LIGHT_MAX } from '../src/exposure.js';
import { AU_KM } from '../src/ephemeris.js';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≠ ${b} (±${eps})`);

test('기준 거리: 행성·위성이 초점이면 그 거리, 태양 곁이면 1AU, 둘 사이는 이어진다', () => {
  for (const a of [0.387, 1, 5.2, 30.07]) close(refDistance(a * AU_KM) / AU_KM, a, 1e-9, `${a}AU`);
  close(refDistance(0) / AU_KM, 1, 1e-9, '태양 초점');
  close(refDistance(0.01 * AU_KM) / AU_KM, 1, 1e-9);
  let prev = refDistance(0.02 * AU_KM);
  for (const a of [0.04, 0.07, 0.1, 0.13, 0.15, 0.3]) { const v = refDistance(a * AU_KM); assert.ok(Math.abs(Math.log(v / prev)) < 1.2, `${a}AU 점프`); prev = v; }
});
test('초점 자신은 1: 어느 천체를 보든 그 천체는 예전 밝기(3) 그대로', () => {
  for (const a of [0.387, 1, 5.2, 30.07, 100]) close(lightScale(refDistance(a * AU_KM), a * AU_KM), 1, 1e-9, `${a}AU`);
});
test('1/r²(자르기 안쪽): 초점 1AU에서 지구 둘레 2배 멀면 1/4, 화성(1.524AU)은 0.43, 금성(0.723AU)은 1.91', () => {
  close(lightScale(AU_KM, 1.2 * AU_KM), 1 / 1.44, 1e-12);
  close(lightScale(AU_KM, 1.524 * AU_KM), 1 / 1.524 ** 2, 1e-12);
  close(lightScale(AU_KM, 0.723 * AU_KM), 1 / 0.723 ** 2, 1e-12);
});
test('방향: 가까울수록 밝고 멀수록 어둡다(초점 1AU 기준, 줄어들기만 한다)', () => {
  let prev = Infinity;
  for (const a of [0.2, 0.39, 0.72, 1, 1.5, 2, 3, 5.2, 10, 30]) { const v = lightScale(AU_KM, a * AU_KM); assert.ok(v <= prev, `${a}AU`); prev = v; }
  assert.ok(lightScale(AU_KM, 0.5 * AU_KM) > lightScale(AU_KM, 2 * AU_KM));
});
test('자르기: 수성은 LIGHT_MAX, 해왕성·토성은 LIGHT_MIN — 서로 구별은 안 되지만 보인다', () => {
  assert.equal(lightScale(AU_KM, 0.387 * AU_KM), LIGHT_MAX);
  assert.equal(lightScale(AU_KM, 30.07 * AU_KM), LIGHT_MIN);
  assert.equal(lightScale(AU_KM, 9.5 * AU_KM), LIGHT_MIN);
  assert.equal(lightScale(30 * AU_KM, 1 * AU_KM), LIGHT_MAX); // 해왕성을 보면서 지구가 보이면 밝게
  assert.equal(lightScale(0, 5), 1); // 잘못된 값은 건드리지 않는다
});
