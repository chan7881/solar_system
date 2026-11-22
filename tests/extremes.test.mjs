// 거리 재기의 최소·최대 거리(src/extremes.js)와 그 문구
import test from 'node:test';
import assert from 'node:assert/strict';
import { AU_KM, VALID_FROM, VALID_TO, julianDateTT, heliocentric } from '../src/ephemeris.js';
import { moonPosition, PLANET_GM, MOONS } from '../src/moons.js';
import { absPos, distanceExtremes } from '../src/extremes.js';
import { fmtDay, extremeText } from '../src/tools.js';

const J0 = julianDateTT(VALID_FROM), J1 = julianDateTT(VALID_TO);
const jd = (y, m, d, h = 0) => julianDateTT(Date.UTC(y, m - 1, d, h));
const dist = (a, b, t) => Math.hypot(...absPos(a, t).map((v, i) => v - absPos(b, t)[i]));
const utcDay = t => new Date((t - 2440587.5) * 864e5 - 69184).toISOString().slice(0, 10);

// 촘촘히 다 훑은 값(정답)
function brute(a, b, t0, t1, h) {
  let lo = Infinity, hi = -Infinity;
  const n = Math.ceil((t1 - t0) / h); // 끝점까지 정확히 잰다
  for (let k = 0; k <= n; k++) { const d = dist(a, b, t0 + ((t1 - t0) * k) / n); lo = Math.min(lo, d); hi = Math.max(hi, d); }
  return { lo, hi };
}

test('위치: 달 − 지구 = 지구 중심 달 위치, 지구·달 질량 가중 평균 = 지구-달 질량중심', () => {
  const t = jd(2024, 3, 1);
  const e = absPos('earth', t), m = absPos('moon', t), g = moonPosition('moon', t);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(m[i] - e[i] - g[i]) < 1e-6);
  const gmM = MOONS.find(o => o.key === 'moon').gm, gmE = PLANET_GM.earth;
  const bary = heliocentric('earth', t).map(v => v * AU_KM);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs((e[i] * gmE + m[i] * gmM) / (gmE + gmM) - bary[i]) < 1, `축 ${i}`);
});

test('다른 계: 위성·흔들림까지 넣은 값이 촘촘히 훑은 값과 같다(지구-포보스 2003 접근, 화성 2003 원지)', () => {
  // 질량중심만 보면 포보스 궤도(약 9,400km)·지구 흔들림(약 4,700km)만큼 틀린다
  for (const [a, b, t0, t1] of [['earth', 'phobos', jd(2003, 8, 20), jd(2003, 9, 3)], ['sun', 'phobos', jd(2003, 5, 1), jd(2003, 7, 15)]]) {
    const r = distanceExtremes(a, b, t0, t1), x = brute(a, b, t0, t1, 0.003);
    assert.ok(r.min.km <= x.lo + 0.01 && r.min.km > x.lo - 2, `${a}-${b} 최소 ${r.min.km} 대 ${x.lo}`);
    assert.ok(r.max.km >= x.hi - 0.01 && r.max.km < x.hi + 2, `${a}-${b} 최대 ${r.max.km} 대 ${x.hi}`);
  }
});

test('다른 계: 공전이 긴 위성(이아페투스 79일)은 가장 가까운 때가 질량중심의 때에서 수십 일 밀린다', () => {
  const t0 = jd(2010, 1, 1), t1 = jd(2010, 7, 1); // 토성 충 2010-03-22 앞뒤
  const r = distanceExtremes('earth', 'iapetus', t0, t1), x = brute('earth', 'iapetus', t0, t1, 0.01);
  assert.ok(Math.abs(r.min.km - x.lo) < 1, `최소 ${r.min.km} 대 ${x.lo}`);
});

test('같은 계: 화성-포보스·포보스-데이모스가 촘촘히 훑은 값과 같다', () => {
  for (const [a, b] of [['mars', 'phobos'], ['phobos', 'deimos']]) {
    const t0 = jd(2010, 1, 1), t1 = jd(2010, 1, 12);
    const r = distanceExtremes(a, b, t0, t1), x = brute(a, b, t0, t1, 0.0005);
    assert.ok(Math.abs(r.min.km - x.lo) < 0.5, `${a}-${b} 최소 ${r.min.km} 대 ${x.lo}`);
    assert.ok(Math.abs(r.max.km - x.hi) < 0.5, `${a}-${b} 최대 ${r.max.km} 대 ${x.hi}`);
  }
});

test('지구-달 1800~2050: 가장 가까운 근지점 1912-01-04 약 35만 6,375km(실제 값과 50km 안)', () => {
  const r = distanceExtremes('earth', 'moon', J0, J1);
  assert.equal(utcDay(r.min.jd), '1912-01-04');
  assert.ok(Math.abs(r.min.km - 356375) < 50, String(r.min.km));
  assert.ok(r.max.km > 406500 && r.max.km < 406800, String(r.max.km));
  // 돌려준 위치로 잰 거리가 그 값이다
  assert.ok(Math.abs(Math.hypot(...r.min.a.map((v, i) => v - r.min.b[i])) - r.min.km) < 1e-6);
});

test('태양-지구: 최소는 1월 초(근일점), 최대는 7월 초(원일점)', () => {
  const r = distanceExtremes('sun', 'earth', J0, J1);
  const mn = new Date((r.min.jd - 2440587.5) * 864e5), mx = new Date((r.max.jd - 2440587.5) * 864e5);
  assert.ok(mn.getUTCMonth() === 0 || (mn.getUTCMonth() === 11 && mn.getUTCDate() > 28), utcDay(r.min.jd));
  assert.equal(mx.getUTCMonth(), 6, utcDay(r.max.jd));
  assert.ok(r.min.km > 1.4705e8 && r.min.km < 1.4712e8, String(r.min.km));
  assert.ok(r.max.km > 1.5208e8 && r.max.km < 1.5215e8, String(r.max.km));
});

test('지구-핼리 혜성: 가장 가까운 때 1910-05-20 약 0.15AU', () => {
  const r = distanceExtremes('earth', 'halley', J0, J1);
  assert.equal(utcDay(r.min.jd), '1910-05-20');
  assert.ok(Math.abs(r.min.km / AU_KM - 0.1515) < 0.002, String(r.min.km / AU_KM));
});

test('지구-화성: 최소 약 5,580만km(대접근 해 8월), 최대 약 4억km', () => {
  const r = distanceExtremes('earth', 'mars', J0, J1);
  assert.ok(r.min.km > 5.57e7 && r.min.km < 5.59e7, String(r.min.km));
  assert.equal(new Date((r.min.jd - 2440587.5) * 864e5).getUTCMonth(), 7);
  assert.ok(r.max.km > 3.99e8 && r.max.km < 4.02e8, String(r.max.km));
});

test('날짜 문구: 이 기기 시간대의 날짜, 숫자와 km는 붙여 쓴다', () => {
  const t = julianDateTT(new Date(2003, 7, 27, 12).getTime()); // 이 기기 시간대 정오
  assert.equal(fmtDay(t), '2003년 8월 27일');
  assert.equal(fmtDay(julianDateTT(new Date(2003, 7, 27, 23, 59, 30).getTime())), '2003년 8월 27일'); // TT−UTC(69초)를 빼야 자정 앞
  assert.equal(extremeText({ km: 55_758_006, jd: t }), '5,576만km · 2003년 8월 27일');
});
