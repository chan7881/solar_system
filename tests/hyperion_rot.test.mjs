// 히페리온 보기용 회전 — IAU 모형이 없어(혼돈 자전) 긴 축을 황도 북극에 두고 Cassini 2005 순간 자전 빠르기 4.2~4.5n의 가운데(4.35n)로 순행
// n은 Horizons에 맞춘 공전 평균 운동(src/moon_fits.js)으로 따로 잰다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyAxes, hasRotation } from '../src/ephemeris.js';
import FITS from '../src/moon_fits.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const JDS = [2378497, 2451545, 2461366.5, 2469807];
const nDeg = FITS.hyperion.n * 180 / Math.PI; // °/일

test('히페리온: 자전축(몸체 +Y = 긴 축)이 1800~2050년 내내 J2000 황도 북극', () => {
  assert.ok(hasRotation('hyperion'));
  for (const jd of JDS) {
    const { pole } = bodyAxes('hyperion', jd);
    assert.ok(dot(pole, [0, 0, 1]) > 1 - 1e-12, `${jd}: ${pole}`);
  }
});

test('히페리온: 북극에서 보아 반시계(순행)로 4.35n ≈ 73.6°/일 — Cassini 4.2~4.5n 안', () => {
  for (const jd of JDS) {
    const a = bodyAxes('hyperion', jd), b = bodyAxes('hyperion', jd + 0.1);
    const ang = Math.atan2(dot(cross(a.prime, b.prime), a.pole), dot(a.prime, b.prime)) * 180 / Math.PI / 0.1;
    assert.ok(ang > 0, `${jd}: 역행 ${ang}`);
    assert.ok(Math.abs(ang / nDeg - 4.35) < 0.001, `${jd}: ${(ang / nDeg).toFixed(4)}n`);
    assert.ok(ang / nDeg > 4.2 && ang / nDeg < 4.5);
  }
});
