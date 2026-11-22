// 위성 위치 — 기준값: JPL Horizons(행성 중심 500@<행성>, J2000 황도, km), tests/horizons_moons.txt(2026-11-21에 받음).
// 날짜 4개(1950·2000·2026·2045년)는 맞추기(tools/fit_moons.py, 3.14일 간격 격자)에 쓴 시각이 아니다.
// 히페리온 4줄은 2026-11-22에 받음. 줄 399 3은 지구-달 질량중심에서 본 지구 중심, 999 9는 명왕성-카론 질량중심에서 본 명왕성 중심(2026-11-22에 받음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MOONS, moonPosition, moonTrail, moonTrailCache, moonPeriod, systemOffsets } from '../src/moons.js';
import { bodyAxes } from '../src/ephemeris.js';
import { SMALL_BODIES } from '../src/smallbodies.js';

const ID = { 301: 'moon', 401: 'phobos', 402: 'deimos', 501: 'io', 502: 'europa', 503: 'ganymede', 504: 'callisto',
  601: 'mimas', 602: 'enceladus', 603: 'tethys', 604: 'dione', 605: 'rhea', 606: 'titan', 607: 'hyperion', 608: 'iapetus',
  701: 'ariel', 702: 'umbriel', 703: 'titania', 704: 'oberon', 705: 'miranda', 801: 'triton', 901: 'charon' };
// 허용 오차(행성에서 본 방향, °) — 맞춘 식의 따로 둔 자료 최대 오차(미마스 1.06° · 히페리온 0.49° · 나머지 0.18° 이하, 2026-11-21·22 tools/fit_moons.py)의 약 2배(히페리온은 1.2배 — 아래 40개 날짜 시험 참고)
const TOL_DEG = { moon: 0.05, mimas: 2.0, hyperion: 0.6 };
const TOL_DEFAULT = 0.35;

const rows = readFileSync(new URL('./horizons_moons.txt', import.meta.url), 'utf8').trim().split(/\r?\n/)
  .map(l => l.trim().split(/\s+/)).map(([id, c, jd, x, y, z]) => ({ id: +id, c: +c, jd: +jd, r: [+x, +y, +z] }));
const norm = v => Math.hypot(...v);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sepDeg = (a, b) => Math.atan2(norm(cross(a, b)), dot(a, b)) * 180 / Math.PI;

test('기준값이 위성 22개 × 날짜 4개 + 지구 4줄 + 명왕성 4줄', () => {
  assert.equal(rows.length, 96);
  assert.equal(new Set(rows.filter(r => ID[r.id]).map(r => r.id)).size, 22);
  assert.equal(MOONS.length, 22);
});

for (const { id, jd, r } of rows.filter(r => ID[r.id])) {
  const key = ID[id];
  test(`${key} JD ${jd} — Horizons와 방향·거리 일치`, () => {
    const p = moonPosition(key, jd);
    const sep = sepDeg(p, r), tol = TOL_DEG[key] ?? TOL_DEFAULT;
    assert.ok(sep < tol, `방향 차이 ${sep.toFixed(3)}° ≥ ${tol}°`);
    const dr = Math.abs(norm(p) - norm(r)) / norm(r);
    assert.ok(dr < 0.01, `거리 차이 ${(dr * 100).toFixed(2)}%`);
  });
}

// 히페리온은 타이탄과 4:3 공명이라 근점 세차가 흔들린다 — 날짜 4개로는 근점 항이 빠져도(최대 3°) 안 걸려서 40개(약 6.3년 간격)로 본다.
//   2026-11-22 실측 최대 0.40°·거리 0.57%. 허용 0.6° — K 항을 3개만 남기면 0.66°, L 주기 항을 3개만 남기면 0.69°로 실패한다.
test('히페리온 — 1800~2050년 40개 날짜에서 Horizons와 방향 0.6° · 거리 1% 안', () => {
  const ref = readFileSync(new URL('./horizons_hyperion.txt', import.meta.url), 'utf8').trim().split(/\r?\n/)
    .filter(l => !l.startsWith('#')).map(l => l.trim().split(/\s+/).map(Number));
  assert.equal(ref.length, 40);
  for (const [jd, ...r] of ref) {
    const p = moonPosition('hyperion', jd), sep = sepDeg(p, r), dr = Math.abs(norm(p) / norm(r) - 1);
    assert.ok(sep < 0.6 && dr < 0.01, `JD ${jd}: ${sep.toFixed(3)}° · ${(dr * 100).toFixed(2)}%`);
  }
});

test('지구 중심 =지구-달 질량중심 − 달 위치 × 질량비 (Horizons와 5km 안)', () => {
  for (const { jd, r } of rows.filter(r => r.id === 399)) {
    const o = systemOffsets('earth', jd).planet;
    const d = norm(o.map((v, i) => v - r[i]));
    assert.ok(d < 5, `JD ${jd}: ${d.toFixed(1)}km`);
    assert.ok(dot(o, moonPosition('moon', jd)) < 0, '지구는 질량중심에서 달 반대쪽');
  }
});

// 카론은 명왕성 질량의 12%라 질량중심이 명왕성 몸체 밖(약 2,100km — 명왕성 반지름 1,188km)에 있다
test('명왕성 중심 = 계 질량중심 − 카론 위치 × 질량비 (Horizons와 10km 안)', () => {
  const pl = rows.filter(r => r.id === 999);
  assert.equal(pl.length, 4);
  for (const { jd, r } of pl) {
    const o = systemOffsets('pluto', jd).planet;
    const d = norm(o.map((v, i) => v - r[i]));
    assert.ok(d < 10, `JD ${jd}: ${d.toFixed(1)}km`);
    assert.ok(norm(o) > SMALL_BODIES.find(b => b.key === 'pluto').radius, '질량중심이 명왕성 몸체 밖');
    assert.ok(dot(o, moonPosition('charon', jd)) < 0, '명왕성은 질량중심에서 카론 반대쪽');
  }
});

// 공전 방향: 행성 자전 벡터에 대한 각운동량 부호. 트리톤만 역행.
// 천왕성의 IAU 북극은 불변면 북쪽 극이라 자전 벡터와 반대다(README 「함정」) — 자전 벡터 = −IAU 북극.
const SPIN = { uranus: -1 };
test('공전 방향 — 트리톤만 역행', () => {
  const jd = 2461365.5;
  for (const m of MOONS) {
    const p0 = moonPosition(m.key, jd), p1 = moonPosition(m.key, jd + 0.01);
    const h = cross(p0, p1.map((v, i) => v - p0[i]));
    const s = Math.sign(dot(h, bodyAxes(m.parent, jd).pole)) * (SPIN[m.parent] ?? 1);
    assert.equal(s, m.key === 'triton' ? -1 : 1, m.key);
  }
});

test('궤도선 0번 점이 지금 위치, 한 바퀴 뒤 점은 제자리 가까이', () => {
  for (const m of MOONS) {
    const pts = moonTrail(m.key, 2461365.5, 360);
    assert.deepEqual(pts[0], moonPosition(m.key, 2461365.5));
    assert.ok(norm(pts[360].map((v, i) => v - pts[0][i])) < 0.1 * norm(pts[0]), m.key);
  }
});

test('궤도선 캐시: 앞·뒤로 조금·많이 옮겨도 매번 새로 셈한 격자와 같고, 한 바퀴를 덮는다', () => {
  const n = 360;
  for (const key of ['mimas', 'moon', 'triton']) {
    const P = moonPeriod(key), h = P / (n - 1), trail = moonTrailCache(key, n);
    // 처음 · 조금 앞 · 많이 앞 · 조금 뒤 · 많이 뒤 · 격자 안에서만 · 한 바퀴 넘게 뛰기
    const steps = [0, 0.3 * h, 5.2 * h, 200.7 * h, -3.1 * h, -150.4 * h, 0.1 * h, 2 * P, -0.5 * h];
    let jd = 2461365.5;
    for (const s of steps) {
      jd += s;
      const pts = trail(jd), i = Math.floor(jd / h);
      assert.equal(pts.length, n + 1);
      assert.deepEqual(pts[0], moonPosition(key, jd), `${key} 0번`);
      for (let j = 0; j < n; j++) assert.deepEqual(pts[j + 1], moonPosition(key, (i - j) * h), `${key} ${s / h}칸 뒤 ${j}번`);
      // 마지막 점은 한 주기 이상 거슬러 간 시각(고리가 닫힌다), 한 칸 넘게 지나치지 않는다
      const tLast = (i - n + 1) * h;
      assert.ok(jd - tLast >= P - 1e-9 && jd - tLast < P + h, `${key} 덮는 길이`);
    }
  }
});
