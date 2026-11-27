// 왜행성 겉모습(src/dwarfs.js) — 관측 반사율·색지수로 낸 색의 순서·방향, 하우메아 고리가 엄폐 관측값을 되살리는지.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reflectance, srgbHex, dwarfColor, DWARF_PHOTOMETRY, SUN_BV, SUN_VR, HAUMEA_POLE, HAUMEA_RING, HAUMEA_RING_OBS, ringTauFromOpacity, ringAlbedoFromIF } from '../src/dwarfs.js';
import { ringLight } from '../src/rings.js';
import { DWARFS, smallBodyHelio } from '../src/smallbodies.js';
import { heliocentric, julianDateTT, raDecToScene, eclipticToScene } from '../src/ephemeris.js';

const R = k => reflectance(DWARF_PHOTOMETRY[k]);
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

test('밝기: 에리스 > 마케마케 > 하우메아(반사율 0.96 · 0.77 · 0.51)', () => {
  assert.ok(lum(R('eris')) > lum(R('makemake')));
  assert.ok(lum(R('makemake')) > lum(R('haumea')));
  assert.equal(R('haumea')[1], 0.51); // G(V띠) = pV
});

test('색: 마케마케가 가장 붉고, 하우메아는 거의 태양색(회색)', () => {
  const red = k => R(k)[0] / R(k)[2];
  assert.ok(red('makemake') > red('eris'));
  assert.ok(red('eris') > red('haumea'));
  assert.ok(red('makemake') > 1.2);
  assert.ok(Math.abs(red('haumea') - 1) < 0.05);
});

test('색지수 방향: 태양색이면 회색, B−V가 크면 B가 줄고, V−R이 크면 R이 는다', () => {
  assert.deepEqual(reflectance({ pV: 0.5, bv: SUN_BV, vr: SUN_VR }).map(v => +v.toFixed(12)), [0.5, 0.5, 0.5]);
  const base = reflectance({ pV: 0.5, bv: SUN_BV, vr: SUN_VR });
  const redB = reflectance({ pV: 0.5, bv: SUN_BV + 0.2, vr: SUN_VR });
  const redR = reflectance({ pV: 0.5, bv: SUN_BV, vr: SUN_VR + 0.2 });
  assert.ok(redB[2] < base[2] && redB[0] === base[0]);
  assert.ok(redR[0] > base[0] && redR[2] === base[2]);
  assert.ok(Math.abs(redB[2] / base[2] - 10 ** (-0.08)) < 1e-12); // 0.2등급 = 10^(−0.4·0.2)
  assert.deepEqual(reflectance({ pV: 0.98, bv: SUN_BV, vr: SUN_VR + 0.3 })[0], 1); // 1을 넘으면 자른다
});

test('sRGB 변환과 smallbodies 색 연결', () => {
  assert.equal(srgbHex([0, 0, 0]), 0x000000);
  assert.equal(srgbHex([1, 1, 1]), 0xffffff);
  assert.equal(srgbHex([0.5, 0.5, 0.5]), 0xbcbcbc); // 선형 0.5 = sRGB 188
  assert.equal(srgbHex([1, 0, 0]), 0xff0000); // 채널 순서 R·G·B
  for (const k of ['haumea', 'makemake', 'eris']) assert.equal(DWARFS.find(d => d.key === k).color, dwarfColor(k));
  // 값을 못 박는다(같은 함수끼리 견주면 부호·채널 순서가 틀려도 통과하므로) — 2026-11-27 관측 색으로 정한 값
  assert.equal(dwarfColor('haumea'), 0xbbbdbe);
  assert.equal(dwarfColor('makemake'), 0xe8e3cc);
  assert.equal(dwarfColor('eris'), 0xfdfaeb);
});

test('하우메아 고리: τ·반사율이 엄폐 관측값(불투명도 0.5 · I/F 0.09)을 되살린다', () => {
  const { tau, albedo, rIn, rOut } = HAUMEA_RING, mu = Math.sin(HAUMEA_RING_OBS.B * Math.PI / 180);
  assert.equal(rOut - rIn, 70);
  assert.equal((rOut + rIn) / 2, 2287);
  // 엄폐 τ는 기하 τ의 2배: 별빛 투과 = e^{−2τ/μ} = 1 − p′
  assert.ok(Math.abs(Math.exp(-2 * tau / mu) - 0.5) < 1e-12);
  assert.ok(tau > 0.08 && tau < 0.085);
  // 앱 빛 식으로 지구에서(μ = μ0, 같은 면) 본 I/F
  const { F } = ringLight(tau, mu, mu, true);
  assert.ok(Math.abs(albedo * F - 0.09) < 1e-12);
  assert.ok(albedo > 0.1 && albedo < 0.3); // 알갱이 반사율이 물리적인 범위
  assert.ok(Math.abs(ringTauFromOpacity(0.5, 90) - Math.LN2 / 2) < 1e-12);
  assert.ok(ringAlbedoFromIF(0.09, tau, 13.8) > 0.09);
});

test('하우메아 고리 극: 2017-01-21 지구에서 본 열림각 13.8°, 남쪽 면이 보인다(Ortiz et al. 2017)', () => {
  const jd = julianDateTT(Date.UTC(2017, 0, 21, 3, 9));
  const h = smallBodyHelio('haumea', jd), e = heliocentric('earth', jd);
  const los = eclipticToScene([e[0] - h[0], e[1] - h[1], e[2] - h[2]]); // 하우메아 → 지구
  const n = Math.hypot(...los), pole = raDecToScene(HAUMEA_POLE.ra, HAUMEA_POLE.dec);
  const sinB = (los[0] * pole[0] + los[1] * pole[1] + los[2] * pole[2]) / n;
  const B = Math.asin(sinB) * 180 / Math.PI;
  assert.ok(Math.abs(Math.abs(B) - 13.8) < 1.0, `열림각 ${B.toFixed(2)}°`);
  assert.ok(B < 0, '지구가 고리면 남쪽에 있어야 한다(히이아카 궤도 기준 −15.7°와 같은 쪽)');
});
