// 도구(거리 재기·크기 비교) 계산과 문구(src/tools.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AU_KM, BODIES, heliocentric } from '../src/ephemeris.js';
import { MOONS } from '../src/moons.js';
import { SMALL_BODIES } from '../src/smallbodies.js';
import { distanceKm, fmtKm, fmtAU, fmtLight, distanceText, diameterOf, fmtDiameter, ratioText, defaultPair, compareLayout, visibleMid } from '../src/tools.js';

const B = Object.fromEntries([...BODIES, ...MOONS, ...SMALL_BODIES].map(b => [b.key, b]));

test('거리 문구: 유효 숫자 4자리, 만·억 단위, 숫자와 km는 붙여 쓴다', () => {
  assert.equal(fmtKm(227_939_200), '2억 2,790만km');
  assert.equal(fmtKm(384_400), '38만 4,400km');
  assert.equal(fmtKm(149_597_870.7), '1억 4,960만km');
  assert.equal(fmtKm(5_906_376_272), '59억 600만km');
  assert.equal(fmtKm(9_376), '9,376km');
  assert.equal(fmtKm(9_999.6), '1만km'); // 반올림으로 자리가 넘어가도
  assert.equal(fmtKm(123.4), '123km');
  assert.equal(fmtKm(1e8), '1억km');
  assert.equal(fmtKm(999.7), '1,000km');
  assert.equal(fmtKm(999.4), '999km');
});

test('천문단위는 0.01AU부터, 자릿수는 크기에 따라', () => {
  assert.equal(fmtAU(384_400, AU_KM), null);
  assert.equal(fmtAU(AU_KM, AU_KM), '1.000AU');
  assert.equal(fmtAU(9.9996 * AU_KM, AU_KM), '10.00AU');
  assert.equal(fmtAU(99.996 * AU_KM, AU_KM), '100.0AU');
  assert.equal(fmtAU(30.07 * AU_KM, AU_KM), '30.07AU');
  assert.equal(fmtAU(96.4 * AU_KM, AU_KM), '96.40AU');
  assert.equal(fmtAU(120.34 * AU_KM, AU_KM), '120.3AU');
});

test('빛이 가는 시간: 1AU는 8분 19초(499.0초), 달은 약 1.28초', () => {
  assert.equal(fmtLight(AU_KM), '8분 19초');
  assert.equal(fmtLight(384_400), '1.28초');
  assert.equal(fmtLight(30 * AU_KM), '4시간 10분'); // 14,970초 = 4시간 9.5분
  assert.equal(fmtLight(370 * AU_KM), '2일 3시간'); // 184,624초
  assert.equal(fmtLight(299_792.458 * 59.7), '59.7초');
  assert.equal(fmtLight(299_792.458 * 119.8), '2분'); // 1분 59.8초 → 2분 0초는 「2분」
  // 단위 경계: 반올림해서 넘어가면 위 단위로
  const c = 299_792.458;
  assert.equal(fmtLight(c * 9.996), '10.0초');
  assert.equal(fmtLight(c * 59.97), '1분');
  assert.equal(fmtLight(c * 3599.8), '1시간');
  assert.equal(fmtLight(c * 86399), '1일');
  assert.equal(fmtLight(c * 3659.6), '1시간 1분');
  assert.deepEqual(distanceText(384_400, AU_KM), { km: '38만 4,400km', sub: '빛으로 1.28초' });
  assert.equal(distanceText(AU_KM, AU_KM).sub, '1.000AU · 빛으로 8분 19초');
});

test('거리: 2000-01-01 지구-태양은 Horizons(지구-달 질량중심) 값과 지구 질량중심 보정(약 4,700km) 안', () => {
  const rows = readFileSync(new URL('./horizons_raw.txt', import.meta.url), 'utf8').trim().split(/\r?\n/).map(l => l.trim().split(/\s+/).map(Number));
  const emb = rows.find(r => r[0] === 3 && r[1] === 2451545.0).slice(2).map(v => v * AU_KM);
  const app = heliocentric('earth', 2451545.0).map(v => v * AU_KM);
  const d = distanceKm(app, [0, 0, 0]), ref = distanceKm(emb, [0, 0, 0]);
  assert.ok(Math.abs(d - ref) < 6000, `${d} vs ${ref}`);
  assert.ok(d > 0.98 * AU_KM && d < 0.99 * AU_KM); // 1월 초 근일점 무렵(0.983AU)
  assert.equal(distanceKm([1, 2, 3], [4, 6, 3]), 5);
});

test('지름: 회전 타원체는 적도 지름, 모양이 고르지 않은 천체는 평균 지름', () => {
  assert.deepEqual(diameterOf(B.earth), { km: 12756.2732, mean: false });
  assert.equal(diameterOf(B.jupiter).km, 142984);
  assert.equal(diameterOf(B.moon).km, 3474.8);       // 위성은 re가 없어 평균 반지름
  assert.deepEqual(diameterOf(B.haumea), { km: 1594, mean: true });
  assert.deepEqual(diameterOf(B.phobos, true), { km: 22.16, mean: true });
  assert.equal(fmtDiameter(diameterOf(B.earth)), '지름 12,756km');
  assert.equal(fmtDiameter(diameterOf(B.phobos, true)), '평균 지름 22.2km');
  assert.equal(fmtDiameter(diameterOf(B.sun)), '지름 1,391,400km');
});

test('배율 문구: 큰 쪽을 작은 쪽에 견준다(순서와 상관없이)', () => {
  const d = k => diameterOf(B[k]).km;
  assert.equal(ratioText(B.earth, d('earth'), B.jupiter, d('jupiter')), '목성의 지름은 지구의 약 11.2배');
  assert.equal(ratioText(B.jupiter, d('jupiter'), B.earth, d('earth')), '목성의 지름은 지구의 약 11.2배');
  assert.equal(ratioText(B.earth, d('earth'), B.sun, d('sun')), '태양의 지름은 지구의 약 109배');
  assert.equal(ratioText(B.earth, d('earth'), B.moon, d('moon')), '지구의 지름은 달의 약 3.67배');
  assert.equal(ratioText(B.earth, d('earth'), B.earth, d('earth')), '같은 천체');
});

test('처음 고르는 두 천체: 지구와 보는 천체, 지구를 보면 달', () => {
  assert.deepEqual(defaultPair('mars'), ['earth', 'mars']);
  assert.deepEqual(defaultPair('sun'), ['earth', 'sun']);
  assert.deepEqual(defaultPair('earth'), ['earth', 'moon']);
});

test('크기 비교 배치: 같은 축척, A가 왼쪽, 겹치지 않고 칸 안에 든다', () => {
  for (const [a, b] of [['earth', 'sun'], ['sun', 'earth'], ['earth', 'moon'], ['jupiter', 'saturn'], ['phobos', 'deimos']]) {
    const A = { w: B[a].radius, h: B[a].radius }, Bb = { w: B[b].radius, h: B[b].radius };
    for (const [W, top, bottom] of [[375, 120, 700], [1280, 80, 720]]) {
      const L = compareLayout(A, Bb, W, top, bottom);
      assert.ok(L.xA < L.xB, `${a}가 왼쪽`);
      assert.ok(L.xA - A.w * L.s >= 0 && L.xB + Bb.w * L.s <= W, '가로로 칸 안');
      assert.ok(L.xB - Bb.w * L.s - (L.xA + A.w * L.s) > 0, '사이가 떨어진다');
      assert.ok(L.y - Math.max(A.h, Bb.h) * L.s >= top && L.y + Math.max(A.h, Bb.h) * L.s <= bottom, '세로로 칸 안');
      // 화면 반지름 비 = 실제 반지름 비(같은 축척)
      assert.ok(Math.abs((A.w * L.s) / (Bb.w * L.s) - B[a].radius / B[b].radius) < 1e-12);
    }
  }
  // 큰 천체가 칸을 넉넉히 채운다 — 좁은 쪽(가로 또는 세로)에 닿는다
  const L = compareLayout({ w: 1, h: 1 }, { w: 1, h: 1 }, 1000, 0, 1000);
  assert.ok(Math.abs((2 + 0.25 + 2) * L.s - 900) < 1e-9);
});

test('선 가운데 거리 글자: 상자 안에 보이는 구간의 가운데', () => {
  // 다 보이면 그냥 가운데
  assert.deepEqual(visibleMid(0, 0, 100, 0, -10, -10, 200, 10), { x: 50, y: 0, len: 100 });
  // 위쪽(창에 가린 곳)으로 나간 선은 보이는 쪽 가운데로 — 위로 옮기면(부호를 뒤집으면) 실패
  const m = visibleMid(50, 300, 50, -100, 0, 100, 400, 800);
  assert.deepEqual(m, { x: 50, y: 200, len: 200 });
  // 오른쪽으로 비스듬히 나가는 선
  const n = visibleMid(0, 0, 200, 100, 0, 0, 100, 100);
  assert.ok(Math.abs(n.x - 50) < 1e-9 && Math.abs(n.y - 25) < 1e-9);
  // 상자를 지나지 않는 선
  assert.equal(visibleMid(0, 0, 10, 0, 20, -5, 30, 5), null);
  assert.equal(visibleMid(0, 50, 100, 50, 0, 0, 100, 40), null);
});
