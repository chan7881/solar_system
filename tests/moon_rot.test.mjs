// 달 자세(IAU 2015 회전 모델 + 주기 항 E1~E13) 검사 — 기준값: JPL Horizons(tests/horizons_moon_rot.txt, 2026-11-21 받음)
//   sun: 태양 직하점, earth: 지구 중심에서 본 원판 가운데(칭동). 둘 다 MOON_ME 좌표, 동경+, 달은 구(1737.4km)라 위도 환산 없음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { heliocentric, bodyLonLat, AU_KM } from '../src/ephemeris.js';
import { moonGeocentric, systemOffsets } from '../src/moons.js';

const JD = { '1950-Jun-18': 2433450.5, '2000-Jan-01': 2451544.5, '2013-Aug-05': 2456509.5, '2026-Nov-21': 2461365.5, '2046-Mar-01': 2468405.5 };
// 허용(°): 실측 최대 0.011°(2026-11-21)의 약 2배. 변이 검사: 계수 0.07°·0.12° 항 하나를 빼면 걸리고(10·9개 실패),
//   0.025° 이하 항(W의 E5 0.0252 등)은 달 위치 오차(ELP 주요 항, 약 0.01°)에 묻혀 이 시험으로는 못 가린다.
const TOL = 0.025;

const rows = readFileSync(new URL('./horizons_moon_rot.txt', import.meta.url), 'utf8').split(/\r?\n/)
  .filter(l => l.trim() && !l.startsWith('#')).map(l => l.trim().split(/\s+/))
  .map(([obs, date, time, lon, lat, lt]) => {
    if (!(date in JD)) throw new Error(`JD 표에 없는 날짜: ${date}`);
    const [h, m, s] = time.split(':').map(Number);
    return { obs, jd: JD[date] + (h + m / 60 + s / 3600) / 24, lon: +lon, lat: +lat, lt: +lt };
  });
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

test('기준값이 관측자 2 × 날짜 5', () => assert.equal(rows.length, 10));

for (const { obs, jd, lon, lat, lt } of rows) {
  test(`달 ${obs} JD ${jd} — 가운데 점이 Horizons와 일치`, () => {
    const jp = jd - lt / 1440; // 빛이 달을 떠난 때
    const earthAt = t => { const h = heliocentric('earth', t), o = systemOffsets('earth', t).planet; return h.map((v, i) => v * AU_KM + o[i]); };
    const e0 = earthAt(jp), g = moonGeocentric(jp), moon = e0.map((v, i) => v + g[i]);
    // 지구 관측자는 관측 시각 jd의 지구 중심, 태양은 원점
    const obsPos = obs === 'earth' ? earthAt(jd) : [0, 0, 0];
    const toObs = obsPos.map((v, i) => v - moon[i]);
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
