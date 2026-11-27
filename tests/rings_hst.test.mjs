// 토성 고리와 몸체를 같이 볼 때의 밝기 비 — HST 관측과 대조. 정답이 정해진 것: 고리 I/F ÷ 몸체 원반 평균(pV)이 관측과 같다(B > A > C 순서 포함).
// 관측: Salo & French 2010(Icarus 209; arXiv 1007.0349) 표 1~3, F555W, 위상각 약 6°, 같은 주기 값 평균.
//   C고리 78,000~83,000km · B고리 100,000~107,000km · A고리 127,000~129,000km. 몸체 pV 0.499(albedo.js, 고리 뺀 몸체).
// 앱에서 몸체는 지도 값을 램버트로 그려 보름 원반 평균이 (2/3)·지도 평균, 고리는 실제 I/F × realToMap — 둘 다 같은 노출을 곱한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ringLight, ringAlbedo } from '../src/rings.js';
import { saturnPhaseRatio } from '../src/phase.js';
import { PV, realToMap } from '../src/albedo.js';
import { MAP_STATS } from '../src/map_stats.js';

const prof = JSON.parse(readFileSync(new URL('../textures/saturn_rings.json', import.meta.url), 'utf8'));
const lin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = t => 0.2126 * lin(t[0]) + 0.7152 * lin(t[1]) + 0.0722 * lin(t[2]);
const D = Math.PI / 180;
// 관측 화소 하나는 여러 칸(약 15km)을 덮는다 → 칸마다 밝기를 구해 평균. 지구에서 보니 μ = μ0 = sin B
function ringIF(a, b, Bdeg, adeg) {
  const { r0, r1, n, tau } = prof, mu = Math.sin(Bdeg * D);
  let s = 0, k = 0;
  for (let i = 0; i < n; i++) {
    const r = r0 + (i + 0.5) * (r1 - r0) / n;
    if (r < a || r > b) continue;
    const A = ringAlbedo(r);
    s += A.w * lum(A.tint) * ringLight(tau[i], mu, mu, true).F * saturnPhaseRatio(adeg * D); k++;
  }
  return s / k;
}
const OBS = [ // [고리 기울기 B(°), 위상각(°), C, B고리, A]
  [4.48, 5.670, 0.1106, 0.3739, 0.3401],
  [10.15, 6.017, 0.0785, 0.4224, 0.3275],
  [15.45, 6.257, 0.0583, 0.4423, 0.3152],
  [20.11, 6.105, 0.0479, 0.4575, 0.3069],
  [23.62, 6.094, 0.0437, 0.4631, 0.2968],
];
const REG = { C: [78000, 83000, 2], B: [100000, 107000, 3], A: [127000, 129000, 4] };
const S = MAP_STATS.saturn;
const globeShown = 2 / 3 * S.mean;                       // 앱 몸체 원반 평균(지도 눈금)
const ringShown = (k, o) => ringIF(REG[k][0], REG[k][1], o[0], o[1]) * realToMap(PV.saturn, S); // 앱 고리(같은 눈금)

// C고리는 기울기가 낮을수록 관측이 더 밝아지는 경향을 앱 식이 덜 따른다(B=4.5°에서 실제의 0.78배, 23.6°에서 1.14배 —
//   단면이 3.6cm 전파 엄폐라 가시광 τ보다 얕은 탓으로 보임) → C는 ±30%, B·A는 ±20%
const TOL = { C: 1.30, B: 1.20, A: 1.20 };
test('고리/몸체 밝기 비가 HST 관측과 맞는다 — 기울기 다섯 개 각각 C ±30%·B·A ±20%, 평균 ±3%', () => {
  for (const k of Object.keys(REG)) {
    let lsum = 0;
    for (const o of OBS) {
      const app = ringShown(k, o) / globeShown, real = o[REG[k][2]] / PV.saturn;
      assert.ok(Math.abs(Math.log(app / real)) < Math.log(TOL[k]), `${k}고리 B=${o[0]}°: 앱 ${app.toFixed(3)} 실제 ${real.toFixed(3)}`);
      lsum += Math.log(app / real);
    }
    assert.ok(Math.abs(lsum / OBS.length) < 0.03, `${k}고리 평균 ${Math.exp(lsum / OBS.length).toFixed(3)}`);
  }
});

test('지구에서 보는 각도(B=23.6°)에서 B고리는 몸체 원반 평균과 비슷하고(0.8~1.0) B > A > C', () => {
  const o = OBS[4], r = k => ringShown(k, o) / globeShown;
  assert.ok(r('B') > 0.8 && r('B') < 1.0, `B ${r('B')}`);
  assert.ok(r('B') > r('A') && r('A') > r('C'));
  assert.ok(r('C') < 0.15, `C ${r('C')}`);
});

test('고리 셰이더 세 곳 모두 빛에 그 몸체의 realToMap 배수를 곱한다(main.js)', () => {
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(src, /uLight: \{ value: 3 \/ Math\.PI \* byKey\.saturn\.albedo\.ring \}/);
  assert.match(src, /uLight: \{ value: 3 \/ Math\.PI \* b\.albedo\.ring \}/);
  assert.match(src, /uLight: \{ value: 3 \/ Math\.PI \* byKey\.haumea\.albedo\.ring \}/);
  assert.match(src, /ring: b\.key === 'sun' \? 1 : realToMap\(PV\[b\.key\]/);
});
