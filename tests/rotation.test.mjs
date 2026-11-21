// 자세(IAU 자전 모델) 검사 — 기준값: JPL Horizons 태양 직하점(tests/horizons_subsolar.txt, 2026-11-21 받음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { heliocentric, bodyAxes, bodyLonLat } from '../src/ephemeris.js';

const ID = { 199: 'mercury', 299: 'venus', 399: 'earth', 499: 'mars', 599: 'jupiter', 699: 'saturn', 799: 'uranus', 899: 'neptune' };
const WEST = new Set([199, 499, 599, 699, 899]); // Horizons가 서경+로 주는 천체
const RADII = { 199: [2440.53, 2438.26], 299: [6051.8, 6051.8], 399: [6378.137, 6356.752], 499: [3396.19, 3376.2],
  599: [71492, 66854], 699: [60268, 54364], 799: [25559, 24973], 899: [24764, 24341] };
const JD = { '1950-Jun-18': 2433450.5, '2000-Jan-01': 2451544.5, '2026-Nov-21': 2461365.5, '2046-Mar-01': 2468405.5 };
// 허용(°): 위도는 행성 위치 오차(토성 최대 약 0.3°)까지, 경도는 위치 오차 + 생략한 주기 항
const TOL_LAT = 0.5, TOL_LON = 0.6;

const rows = readFileSync(new URL('./horizons_subsolar.txt', import.meta.url), 'utf8').split(/\r?\n/)
  .filter(l => l.trim() && !l.startsWith('#')).map(l => l.trim().split(/\s+/))
  .map(([id, date, time, lon, lat, lt]) => {
    const [h, m, s] = time.split(':').map(Number);
    return { id: +id, key: ID[id], jd: JD[date] + (h + m / 60 + s / 3600) / 24, lon: +lon, lat: +lat, lt: +lt };
  });
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

test('기준값이 행성 8개 × 날짜 4개', () => assert.equal(rows.length, 32));

for (const { id, key, jd, lon, lat, lt } of rows) {
  test(`${key} JD ${jd} — 태양 직하점이 Horizons와 일치`, () => {
    const jp = jd - lt / 1440; // 태양에서 본 모습 = 빛이 떠난 때의 행성
    const toSun = heliocentric(key, jp).map(v => -v);
    const p = bodyLonLat(key, jp, toSun);
    const [a, c] = RADII[id];
    const latD = Math.atan(Math.tan(p.lat * Math.PI / 180) * (a / c) ** 2) * 180 / Math.PI; // 행성 중심 → 측지 위도
    assert.ok(Math.abs(latD - lat) < TOL_LAT, `위도 ${latD.toFixed(3)} ≠ ${lat}`);
    const lonH = WEST.has(id) ? (360 - p.lonE) % 360 : p.lonE;
    assert.ok(angDiff(lonH, lon) < TOL_LON, `경도 ${lonH.toFixed(3)} ≠ ${lon}`);
  });
}

test('축이 오른손 정규 직교계(pole = prime × east)', () => {
  for (const key of [...Object.values(ID), 'sun']) {
    const { pole: p, prime: x, east: y } = bodyAxes(key, 2461365.5);
    const cr = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(cr[i] - p[i]) < 1e-12, key);
    assert.ok(Math.abs(Math.hypot(...x) - 1) < 1e-12 && Math.abs(Math.hypot(...y) - 1) < 1e-12);
  }
});

test('자전 방향: 금성·천왕성만 거꾸로 — 황도 북쪽에서 볼 때 나머지는 반시계', () => {
  for (const key of [...Object.values(ID), 'sun']) {
    // 1시간 동안 본초 자오선이 도는 방향과 황도 북극(z)의 관계
    const a = bodyAxes(key, 2461365.5).prime, b = bodyAxes(key, 2461365.5 + 1 / 24).prime;
    const spinZ = a[0] * b[1] - a[1] * b[0];
    const retro = key === 'venus' || key === 'uranus';
    assert.equal(spinZ < 0, retro, `${key} 자전 방향`);
  }
});

test('자전축 기울기(공전면 기준, °) — 지구 23.4 · 화성 25.2 · 토성 26.7 · 천왕성 97.8 · 금성 177.4', () => {
  // 공전면 법선 = r × v,  자전 벡터 = 본초 자오선이 도는 방향(오른손) — IAU 북극은 천왕성·금성에서 자전 벡터의 반대
  const tilt = key => {
    const jd = 2461365.5, r = heliocentric(key, jd), r2 = heliocentric(key, jd + 1);
    const n = [r[1] * r2[2] - r[2] * r2[1], r[2] * r2[0] - r[0] * r2[2], r[0] * r2[1] - r[1] * r2[0]];
    const x0 = bodyAxes(key, jd).prime, x1 = bodyAxes(key, jd + 0.01).prime;
    const p = [x0[1] * x1[2] - x0[2] * x1[1], x0[2] * x1[0] - x0[0] * x1[2], x0[0] * x1[1] - x0[1] * x1[0]];
    const pn = Math.hypot(...p);
    return Math.acos((n[0] * p[0] + n[1] * p[1] + n[2] * p[2]) / Math.hypot(...n) / pn) * 180 / Math.PI;
  };
  for (const [key, want] of [['earth', 23.44], ['mars', 25.19], ['saturn', 26.73], ['uranus', 97.77], ['venus', 177.36]]) {
    assert.ok(Math.abs(tilt(key) - want) < 0.3, `${key} ${tilt(key).toFixed(2)}°`);
  }
});

test('토성 고리면을 지구가 지나는 때: 2025-03-23 앞뒤로 부호가 바뀜', () => {
  const B = jd => {
    const s = heliocentric('saturn', jd), e = heliocentric('earth', jd);
    return bodyLonLat('saturn', jd, e.map((v, i) => v - s[i])).lat;
  };
  const jd0 = 2460757.5; // 2025-03-23 00:00
  assert.ok(B(jd0 - 10) > 0 && B(jd0 + 10) < 0, `${B(jd0 - 10)} → ${B(jd0 + 10)}`);
});
