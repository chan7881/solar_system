// 명왕성·카론 자세(IAU 2015 회전 모델)와 카론 위치 검사 — 기준값: JPL Horizons(2026-11-22 받음)
//   horizons_pluto_rot.txt: 태양 직하점(sun)과 상대 천체 쪽 가운데 점(pair) · horizons_pluto_vec.txt: 태양 행 시각의 태양 중심 위치.
//   Horizons 경도는 둘 다 동경+, 두 천체 모두 구라 위도 환산이 없다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bodyLonLat } from '../src/ephemeris.js';
import { moonPosition } from '../src/moons.js';

const JD = { '1950-Jun-18': 2433450.5, '2000-Jan-01': 2451544.5, '2015-Jul-14': 2457217.5, '2026-Nov-21': 2461365.5, '2046-Mar-01': 2468405.5 };
const KEY = { 999: 'pluto', 901: 'charon' };
const read = f => readFileSync(new URL(f, import.meta.url), 'utf8').split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#')).map(l => l.trim().split(/\s+/));
const rows = read('./horizons_pluto_rot.txt').map(([id, obs, date, time, lonE, lat, lt]) => {
  if (!(date in JD)) throw new Error(`JD 표에 없는 날짜: ${date}`);
  const [h, m, s] = time.split(':').map(Number);
  return { key: KEY[id], obs, jd: JD[date] + (h + m / 60 + s / 3600) / 24, lonE: +lonE, lat: +lat, lt: +lt };
});
const vec = read('./horizons_pluto_vec.txt').map(([id, jp, x, y, z]) => ({ key: KEY[id], jp: +jp, r: [+x, +y, +z] }));
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
// 자세만(Horizons 위치로 방향을 잡음): 2026-11-22 실측 최대 오차는 아래 「실측」 시험이 찍는다. W를 0.05° 틀면 실패해야 한다
const TOL_ROT = 0.01;
// 카론 쪽 가운데 점(앱 카론 위치 — 맞춘 궤도 식의 오차가 들어온다)
const TOL_PAIR = 0.35;

test('기준값이 천체 2 × 관측자 2 × 날짜 5, 위치 2 × 5', () => {
  assert.equal(rows.length, 20);
  assert.equal(vec.length, 10);
});

const sunRows = rows.filter(r => r.obs === 'sun');
for (const r of sunRows) {
  const v = vec.find(x => x.key === r.key && Math.abs(x.jp - (r.jd - r.lt / 1440)) < 1e-6);
  test(`${r.key} 자세 JD ${r.jd} — Horizons 위치로 잰 태양 직하점이 ${TOL_ROT}° 안`, () => {
    assert.ok(v, '같은 시각 위치 자료');
    const p = bodyLonLat(r.key, v.jp, v.r.map(x => -x));
    assert.ok(Math.abs(p.lat - r.lat) < TOL_ROT, `위도 ${p.lat.toFixed(4)} ≠ ${r.lat}`);
    assert.ok(angDiff(p.lonE, r.lonE) < TOL_ROT, `동경 ${p.lonE.toFixed(4)} ≠ ${r.lonE}`);
  });
}

// 서로 마주 보고 돈다 — 명왕성에서 카론 쪽은 동경 0° 근처, 카론에서 명왕성 쪽도 0° 근처(이심률·궤도면 차로 1.5° 안팎 흔들림)
const pairRows = rows.filter(r => r.obs === 'pair');
const pairPoint = ({ key, jd }) => {
  const c = moonPosition('charon', jd); // 명왕성 중심에서 본 카론(광행시 0.07초는 무시)
  return bodyLonLat(key, jd, key === 'pluto' ? c : c.map(x => -x));
};
for (const r of pairRows) {
  test(`${r.key} JD ${r.jd} — 상대 천체 쪽 가운데 점이 Horizons와 ${TOL_PAIR}° 안`, () => {
    const p = pairPoint(r);
    assert.ok(Math.abs(p.lat - r.lat) < TOL_PAIR, `위도 ${p.lat.toFixed(4)} ≠ ${r.lat}`);
    assert.ok(angDiff(p.lonE, r.lonE) < TOL_PAIR, `동경 ${p.lonE.toFixed(4)} ≠ ${r.lonE}`);
  });
}

test('실측 최대 오차 기록', () => {
  const rot = Math.max(...sunRows.map(r => {
    const v = vec.find(x => x.key === r.key && Math.abs(x.jp - (r.jd - r.lt / 1440)) < 1e-6);
    const p = bodyLonLat(r.key, v.jp, v.r.map(x => -x));
    return Math.max(Math.abs(p.lat - r.lat), angDiff(p.lonE, r.lonE));
  }));
  const pair = Math.max(...pairRows.map(r => { const p = pairPoint(r); return Math.max(Math.abs(p.lat - r.lat), angDiff(p.lonE, r.lonE)); }));
  console.log(`명왕성·카론 태양 직하점 최대 오차(자세만) ${rot.toFixed(5)}° · 마주 보는 점 최대 오차 ${pair.toFixed(4)}°`);
});
