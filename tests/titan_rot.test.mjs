// 타이탄 자세(IAU 2015 회전 모델) 검사 — 기준값: JPL Horizons(tests/horizons_titan_rot.txt, 2026-11-21 받음)
//   sun: 태양 직하점, earth: 지구 중심에서 본 원판 가운데. Horizons는 서경+ · 측지 위도 → 행성 중심 위도로 바꿔 댄다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { heliocentric, bodyLonLat, AU_KM } from '../src/ephemeris.js';
import { moonPosition, systemOffsets } from '../src/moons.js';

const JD = { '1950-Jun-18': 2433450.5, '2000-Jan-01': 2451544.5, '2013-Aug-05': 2456509.5, '2026-Nov-21': 2461365.5, '2046-Mar-01': 2468405.5 };
// 허용(°) — 두 갈래로 잰다(2026-11-21 실측):
//   자세만: Horizons 타이탄 위치(horizons_titan_vec.txt)로 태양 방향을 잡으면 최대 0.0033°(측지→중심 위도 환산 뒤).
//   앱 전체: 우리 위치로 잡으면 최대 0.159° — 토성 Standish 위치 오차(ephemeris.test 허용 1200″=0.33°)가 그대로 옮겨 온다.
//   그래서 자세 오류는 「자세만」 시험이 잡는다(W·자전 속도·극을 0.05° 틀면 실패).
const TOL_ROT = 0.01, TOL = 0.35;
// pck00011 BODY606_RADII(2575.15, 2574.78, 2574.47) — 측지 위도 → 행성 중심 위도(적도 반지름은 두 값의 평균)
const A = (2575.15 + 2574.78) / 2, C = 2574.47;
const centric = latG => Math.atan((C / A) ** 2 * Math.tan(latG * Math.PI / 180)) * 180 / Math.PI;

const rows = readFileSync(new URL('./horizons_titan_rot.txt', import.meta.url), 'utf8').split(/\r?\n/)
  .filter(l => l.trim() && !l.startsWith('#')).map(l => l.trim().split(/\s+/))
  .map(([obs, date, time, lonW, lat, lt]) => {
    if (!(date in JD)) throw new Error(`JD 표에 없는 날짜: ${date}`);
    const [h, m, s] = time.split(':').map(Number);
    return { obs, jd: JD[date] + (h + m / 60 + s / 3600) / 24, lonE: (360 - +lonW) % 360, lat: centric(+lat), lt: +lt };
  });
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const helioKm = (key, t) => heliocentric(key, t).map(v => v * AU_KM);

test('기준값이 관측자 2 × 날짜 5', () => assert.equal(rows.length, 10));

// 앱과 같은 위치 계산으로 잰 가운데 점
function appPoint({ obs, jd, lt }) {
  const jp = jd - lt / 1440; // 빛이 타이탄을 떠난 때
  const sat = helioKm('saturn', jp), off = systemOffsets('saturn', jp).planet, t = moonPosition('titan', jp);
  const titan = sat.map((v, i) => v + off[i] + t[i]);
  let obsPos = [0, 0, 0];
  if (obs === 'earth') { const e = helioKm('earth', jd), o = systemOffsets('earth', jd).planet; obsPos = e.map((v, i) => v + o[i]); }
  return bodyLonLat('titan', jp, obsPos.map((v, i) => v - titan[i]));
}
for (const r of rows) {
  const { obs, jd, lonE, lat } = r;
  test(`타이탄 ${obs} JD ${jd} — 가운데 점이 Horizons와 일치`, () => {
    const p = appPoint(r);
    assert.ok(Math.abs(p.lat - lat) < TOL, `위도 ${p.lat.toFixed(4)} ≠ ${lat}`);
    assert.ok(angDiff(p.lonE, lonE) < TOL, `동경 ${p.lonE.toFixed(4)} ≠ ${lonE}`);
  });
}
test('실측 최대 오차 기록', () => {
  const worst = Math.max(...rows.map(r => { const p = appPoint(r); return Math.max(Math.abs(p.lat - r.lat), angDiff(p.lonE, r.lonE)); }));
  console.log(`타이탄 가운데 점 최대 오차(앱 위치) ${worst.toFixed(4)}°`);
});

const vec = readFileSync(new URL('./horizons_titan_vec.txt', import.meta.url), 'utf8').split(/\r?\n/)
  .filter(l => l.trim() && !l.startsWith('#')).map(l => l.trim().split(/\s+/).map(Number));
const sunRows = rows.filter(r => r.obs === 'sun');
test('위치 자료가 태양 행과 같은 시각', () => {
  assert.equal(vec.length, sunRows.length);
  vec.forEach(([jp], k) => assert.ok(Math.abs(jp - (sunRows[k].jd - sunRows[k].lt / 1440)) < 1e-6));
});
sunRows.forEach(({ jd, lonE, lat }, k) => {
  test(`타이탄 자세만 JD ${jd} — Horizons 위치로 잰 태양 직하점이 ${TOL_ROT}° 안`, () => {
    const [jp, x, y, z] = vec[k];
    const p = bodyLonLat('titan', jp, [-x, -y, -z]);
    assert.ok(Math.abs(p.lat - lat) < TOL_ROT, `위도 ${p.lat.toFixed(4)} ≠ ${lat}`);
    assert.ok(angDiff(p.lonE, lonE) < TOL_ROT, `동경 ${p.lonE.toFixed(4)} ≠ ${lonE}`);
  });
});

// 동주기 자전이지만 이심률(0.029)만큼 흔들린다 — Horizons 500@699(토성 중심)에서 본 가운데 동경이 2026-11-21~12-07 반나절 간격으로 −1.21°~+5.36°
test('타이탄은 늘 같은 면 — 토성 쪽 가운데 동경의 최소·최대가 Horizons와 0.3° 안', () => {
  const a = [];
  for (let k = 0; k <= 32; k++) {
    const jd = 2461365.5 + k / 2;
    const p = bodyLonLat('titan', jd, moonPosition('titan', jd).map(v => -v));
    assert.ok(Math.abs(p.lat) < 1, `${jd}: 위도 ${p.lat.toFixed(2)}`);
    a.push(((p.lonE + 180) % 360) - 180);
  }
  assert.ok(Math.abs(Math.min(...a) + 1.21) < 0.3 && Math.abs(Math.max(...a) - 5.36) < 0.3, `${Math.min(...a).toFixed(2)}~${Math.max(...a).toFixed(2)}`);
});
