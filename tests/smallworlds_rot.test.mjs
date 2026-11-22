// 트리톤·천왕성 위성 5개·세레스 자세(IAU 2015 회전 모델) 검사 — 기준값: JPL Horizons
//   horizons_smallworlds_rot.txt: 태양 직하점(동경+, 측지 위도) · horizons_smallworlds_vec.txt: 같은 행 시각의 태양 중심 위치.
//   Horizons 위치로 태양 방향을 잡아 자세만 잰다. 위도는 머리글 반지름(적도 a, 극 c — Horizons는 3축 천체도 (a,a,c) 회전 타원체 기준 측지 위도)으로 행성 중심 위도로 바꿔 댄다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bodyLonLat } from '../src/ephemeris.js';

const JD = { '1950-Jun-18': 2433450.5, '2000-Jan-01': 2451544.5, '2015-Jul-14': 2457217.5, '2026-Nov-21': 2461365.5, '2046-Mar-01': 2468405.5 };
const lines = f => readFileSync(new URL(f, import.meta.url), 'utf8').split(/\r?\n/).filter(l => l.trim());
const radii = {};
for (const l of lines('./horizons_smallworlds_rot.txt').filter(l => l.startsWith('# radii'))) {
  const [, , k, a, b, c] = l.trim().split(/\s+/); radii[k] = { A: +a, C: +c };
}
const data = f => lines(f).filter(l => !l.startsWith('#')).map(l => l.trim().split(/\s+/));
const centric = (k, latG) => Math.atan((radii[k].C / radii[k].A) ** 2 * Math.tan(latG * Math.PI / 180)) * 180 / Math.PI;
const rows = data('./horizons_smallworlds_rot.txt').map(([key, obs, date, time, lonE, lat, lt]) => {
  if (!(date in JD)) throw new Error(`JD 표에 없는 날짜: ${date}`);
  const [h, m, s] = time.split(':').map(Number);
  return { key, jd: JD[date] + (h + m / 60 + s / 3600) / 24, lonE: +lonE, lat: centric(key, +lat), lt: +lt };
});
const vec = data('./horizons_smallworlds_vec.txt').map(([key, jp, x, y, z]) => ({ key, jp: +jp, r: [+x, +y, +z] }));
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
// 자세만(Horizons 위치로 방향을 잡음) 허용(°). 세레스 동경만 1.6°: Horizons 세레스 자전 모형은 IAU 2015(W = 170.650 + 952.1532 d, 앱)와
// 자전 빠르기·기준이 조금 달라 오차가 시간에 곧게 늘어난다(2015년 0.03° → 1950년 −1.48°·2046년 +0.74°, 위도는 0.005°로 맞음). 어느 쪽이
// 맞는지는 가리지 않았다 — 앱은 지도(Dawn 모자이크, IAU 경도)와 같은 IAU 2015 모형을 쓴다.
const TOL = { triton: 0.01, ariel: 0.01, umbriel: 0.01, titania: 0.01, oberon: 0.01, miranda: 0.03, ceres: 0.01 };
const TOL_LON = { ...TOL, ceres: 1.6 };
const err = r => {
  const v = vec.find(x => x.key === r.key && Math.abs(x.jp - (r.jd - r.lt / 1440)) < 1e-6);
  assert.ok(v, '같은 시각 위치 자료');
  const p = bodyLonLat(r.key, v.jp, v.r.map(x => -x));
  return { lat: Math.abs(p.lat - r.lat), lon: angDiff(p.lonE, r.lonE) * Math.max(Math.cos(r.lat * Math.PI / 180), 0.2) };
};

test('기준값이 천체 7 × 날짜 5', () => { assert.equal(rows.length, 35); assert.equal(vec.length, 35); });
for (const r of rows) {
  test(`${r.key} JD ${r.jd} — Horizons 위치로 잰 태양 직하점이 위도 ${TOL[r.key]}°·동경 ${TOL_LON[r.key]}° 안`, () => {
    const e = err(r);
    assert.ok(e.lat < TOL[r.key], `위도 오차 ${e.lat.toFixed(4)}`);
    assert.ok(e.lon < TOL_LON[r.key], `동경 오차(위도 보정) ${e.lon.toFixed(4)}`);
  });
}
test('실측 최대 오차 기록', () => {
  for (const k of Object.keys(TOL)) {
    const es = rows.filter(r => r.key === k).map(err);
    console.log(`${k} 최대 오차 위도 ${Math.max(...es.map(e => e.lat)).toFixed(5)}° · 동경 ${Math.max(...es.map(e => e.lon)).toFixed(5)}°`);
  }
});
