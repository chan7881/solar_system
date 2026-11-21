// 포보스·데이모스 자세(IAU 2015 회전 모델, 주기 항 M1~M10) 검사 — 기준값: JPL Horizons(2026-11-21 받음)
//   horizons_marsmoons_rot.txt: 태양 직하점(sun)·화성 중심에서 본 원판 가운데(mars), 서경+ · Horizons 측지 위도
//   horizons_marsmoons_vec.txt: 같은 줄의 「빛이 떠난 때」 위성 위치(관측자 중심)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bodyAxes, bodyLonLat } from '../src/ephemeris.js';
import { moonPosition } from '../src/moons.js';

const DEG = Math.PI / 180;
const JD = { '1950-Jun-18': 2433450.5, '2000-Jan-01': 2451544.5, '2013-Aug-05': 2456509.5, '2026-Nov-21': 2461365.5, '2046-Mar-01': 2468405.5 };
// pck00011 BODY401·402_RADII — Horizons 머리글과 같음
const RADII = { phobos: [13.0, 11.4, 9.1], deimos: [7.8, 6.0, 5.1] };
// 허용(°) — 2026-11-21 실측:
//   sun(태양 직하점): 최대 0.00002° — 주기 항 하나(포보스 W의 −1.143° M5 항 등)만 빠져도 넘는다
//   mars(화성 중심에서 본 점): 최대 0.0047° — Horizons 겉보기 방향에 화성의 공전 속도(약 24km/s)로 생기는 광행차(약 0.005°)가 들어 있다.
//     태양은 거의 서 있어 sun 줄에는 이 차이가 없다. 자세 오류는 sun 줄이 잡는다.
const TOL = { sun: 0.0001, mars: 0.01 };

const lines = f => readFileSync(new URL(f, import.meta.url), 'utf8').split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#')).map(l => l.trim().split(/\s+/));
const rows = lines('./horizons_marsmoons_rot.txt').map(([body, obs, date, time, lonW, lat, lt]) => {
  if (!(date in JD)) throw new Error(`JD 표에 없는 날짜: ${date}`);
  const [h, m, s] = time.split(':').map(Number);
  return { body, obs, jd: JD[date] + (h + m / 60 + s / 3600) / 24, lonE: (360 - +lonW) % 360, lat: +lat, lt: +lt };
});
const vec = lines('./horizons_marsmoons_vec.txt').map(([body, obs, jp, x, y, z]) => ({ body, obs, jp: +jp, v: [+x, +y, +z] }));
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Horizons 측지 위도: 방향 u(천체 고정 좌표)의 광선이 3축 타원체와 만나는 점 p → 회전 타원체(a,a,c) 기준 측지 위도(고도 포함, 반복)
function horizonsLat(key, u) {
  const [a, b, c] = RADII[key];
  const s = 1 / Math.sqrt((u[0] / a) ** 2 + (u[1] / b) ** 2 + (u[2] / c) ** 2), p = u.map(z => z * s);
  const e2 = 1 - (c / a) ** 2, r = Math.hypot(p[0], p[1]);
  let lat = Math.atan2(p[2], r * (1 - e2));
  for (let i = 0; i < 200; i++) { // 납작한(c/a 0.65) 고위도는 천천히 모인다 — 30번이면 0.0008° 남음
    const N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2), h = r / Math.cos(lat) - N;
    lat = Math.atan2(p[2], r * (1 - e2 * N / (N + h)));
  }
  return lat / DEG;
}
// 위성에서 관측자 쪽 방향 d(황도) → { lonE, lat(Horizons식) }
function point(key, jd, d) {
  const { pole, prime, east } = bodyAxes(key, jd), n = Math.hypot(...d);
  const u = [dot(prime, d) / n, dot(east, d) / n, dot(pole, d) / n];
  return { lonE: (Math.atan2(u[1], u[0]) / DEG + 360) % 360, lat: horizonsLat(key, u) };
}

test('기준값이 천체 2 × 관측자 2 × 날짜 5, 위치 자료가 같은 줄·같은 시각', () => {
  assert.equal(rows.length, 20);
  assert.equal(vec.length, 20);
  rows.forEach((r, k) => {
    assert.equal(vec[k].body, r.body); assert.equal(vec[k].obs, r.obs);
    assert.ok(Math.abs(vec[k].jp - (r.jd - r.lt / 1440)) < 1e-6, `${r.body} ${r.obs} ${r.jd}`);
  });
});

rows.forEach((r, k) => {
  test(`${r.body} ${r.obs} JD ${r.jd} — Horizons 위치로 잰 가운데 점이 ${TOL[r.obs]}° 안`, () => {
    const p = point(r.body, vec[k].jp, vec[k].v.map(x => -x));
    assert.ok(Math.abs(p.lat - r.lat) < TOL[r.obs], `위도 ${p.lat.toFixed(6)} ≠ ${r.lat}`);
    assert.ok(angDiff(p.lonE, r.lonE) < TOL[r.obs], `동경 ${p.lonE.toFixed(6)} ≠ ${r.lonE}`);
  });
});

// 앱 위치(맞춘 궤도 식)로 잰 「화성 쪽 점」 — 위치 맞춤 오차가 그대로 옮겨 온다
test('앱 위치로도 화성 쪽 가운데 점이 Horizons와 0.3° 안', () => {
  let worst = 0;
  for (const r of rows.filter(r => r.obs === 'mars')) {
    const jp = r.jd - r.lt / 1440, p = point(r.body, jp, moonPosition(r.body, jp).map(x => -x));
    worst = Math.max(worst, Math.abs(p.lat - r.lat), angDiff(p.lonE, r.lonE));
  }
  console.log(`포보스·데이모스 화성 쪽 점 최대 오차(앱 위치) ${worst.toFixed(4)}°`);
  assert.ok(worst < 0.3, `${worst}`);
});

test('긴 축(경도 0°)이 화성을 향하고, 북극이 공전 방향과 같다(순행)', () => {
  for (const key of ['phobos', 'deimos']) {
    for (let k = 0; k < 40; k++) {
      const jd = 2451545 + k * 913.3;
      const r = moonPosition(key, jd), r2 = moonPosition(key, jd + 0.01);
      const p = bodyLonLat(key, jd, r.map(x => -x));
      assert.ok(angDiff(p.lonE, 0) < 3 && Math.abs(p.lat) < 1, `${key} ${jd}: ${p.lonE.toFixed(2)}, ${p.lat.toFixed(2)}`);
      const h = [r[1] * r2[2] - r[2] * r2[1], r[2] * r2[0] - r[0] * r2[2], r[0] * r2[1] - r[1] * r2[0]];
      assert.ok(dot(h, bodyAxes(key, jd).pole) > 0, `${key} ${jd}: 역행`);
    }
  }
});
