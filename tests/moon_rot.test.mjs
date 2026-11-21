// 달 자세(IAU 2015 회전 모델 + 주기 항 E1~E13) 검사 — 기준값: JPL Horizons(tests/horizons_moon_rot.txt, 2026-11-21 받음)
//   sun: 태양 직하점, earth: 지구 중심에서 본 원판 가운데(칭동). 둘 다 MOON_ME 좌표, 동경+, 달은 구(1737.4km)라 위도 환산 없음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { heliocentric, bodyLonLat, AU_KM } from '../src/ephemeris.js';
import { moonGeocentric, systemOffsets } from '../src/moons.js';

const JD = { '1950-Jun-18': 2433450.5, '2000-Jan-01': 2451544.5, '2013-Aug-05': 2456509.5, '2026-Nov-21': 2461365.5, '2046-Mar-01': 2468405.5 };
// 허용(°): 달 위치(ELP 주요 항, Horizons와 0.01°)와 IAU 모형 대 ME 좌표 차(약 0.005°)의 몇 배
const TOL = 0.05;

const rows = readFileSync(new URL('./horizons_moon_rot.txt', import.meta.url), 'utf8').split(/\r?\n/)
  .filter(l => l.trim() && !l.startsWith('#')).map(l => l.trim().split(/\s+/))
  .map(([obs, date, , lon, lat, lt]) => ({ obs, jd: JD[date], lon: +lon, lat: +lat, lt: +lt }));
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

test('기준값이 관측자 2 × 날짜 5', () => assert.equal(rows.length, 10));

for (const { obs, jd, lon, lat, lt } of rows) {
  test(`달 ${obs} JD ${jd} — 가운데 점이 Horizons와 일치`, () => {
    const jp = jd - lt / 1440; // 빛이 달을 떠난 때
    const g = moonGeocentric(jp);
    let toObs;
    if (obs === 'earth') toObs = g.map(v => -v);
    else {
      const h = heliocentric('earth', jp).map(v => v * AU_KM), o = systemOffsets('earth', jp).planet;
      toObs = h.map((v, i) => -(v + o[i] + g[i]));
    }
    const p = bodyLonLat('moon', jp, toObs);
    assert.ok(Math.abs(p.lat - lat) < TOL, `위도 ${p.lat.toFixed(4)} ≠ ${lat}`);
    assert.ok(angDiff(p.lonE, lon) < TOL, `경도 ${p.lonE.toFixed(4)} ≠ ${lon}`);
  });
}

test('달은 늘 같은 면 — 지구 쪽 가운데가 경도 0° 둘레 ±8° 안(30일 동안 하루 간격)', () => {
  for (let k = 0; k < 30; k++) {
    const jd = 2461365.5 + k;
    const p = bodyLonLat('moon', jd, moonGeocentric(jd).map(v => -v));
    assert.ok(angDiff(p.lonE, 0) < 8 && Math.abs(p.lat) < 8, `${jd}: ${p.lonE.toFixed(2)}, ${p.lat.toFixed(2)}`);
  }
});
