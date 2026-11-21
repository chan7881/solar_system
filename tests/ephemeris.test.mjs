// 실행: node --test tests/
// 기준값: JPL Horizons(태양 중심 500@10, J2000 황도, AU) — tests/horizons_raw.txt 를 2026-11-21에 받은 것.
// 지구는 지구-달 질량중심(3), 목성~해왕성은 계 질량중심(5~8), 수성·금성·화성은 행성 중심.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { heliocentric, orbitTrail, eclipticToScene, julianDateTT, solveKepler } from '../src/ephemeris.js';

const ID = { 199: 'mercury', 299: 'venus', 3: 'earth', 499: 'mars', 5: 'jupiter', 6: 'saturn', 7: 'uranus', 8: 'neptune' };
// 허용 오차(″) — 내행성은 Standish Table 1 오차의 2배, 목성~해왕성은 2026-11-21 실측 최대(401·517·71·45″)의 약 2배
const TOL_ARCSEC = { mercury: 30, venus: 40, earth: 40, mars: 80, jupiter: 800, saturn: 1200, uranus: 150, neptune: 100 };

const rows = readFileSync(new URL('./horizons_raw.txt', import.meta.url), 'utf8').trim().split(/\r?\n/)
  .map(l => l.trim().split(/\s+/)).map(([id, jd, x, y, z]) => ({ key: ID[id], jd: +jd, r: [+x, +y, +z] }));

const norm = v => Math.hypot(...v);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sepArcsec = (a, b) => Math.atan2(norm(cross(a, b)), dot(a, b)) * 180 / Math.PI * 3600;

test('기준값이 행성 8개 × 날짜 4개', () => {
  assert.equal(rows.length, 32);
  assert.equal(new Set(rows.map(r => r.key)).size, 8);
});

for (const { key, jd, r } of rows) {
  test(`${key} JD ${jd} — Horizons와 방향·거리 일치`, () => {
    const p = heliocentric(key, jd);
    const sep = sepArcsec(p, r);
    assert.ok(sep < TOL_ARCSEC[key], `방향 차이 ${sep.toFixed(1)}″ ≥ ${TOL_ARCSEC[key]}″`);
    const dr = Math.abs(norm(p) - norm(r)) / norm(r);
    assert.ok(dr < 2e-3, `거리 차이 ${(dr * 100).toFixed(3)}%`);
    // 황도 위·아래(z 부호)까지 맞는지 — z가 충분히 클 때만
    if (Math.abs(r[2]) > 0.01) assert.equal(Math.sign(p[2]), Math.sign(r[2]), 'z 부호');
  });
}

test('케플러 방정식 해가 방정식을 만족', () => {
  for (const e of [0, 0.0167, 0.2056, 0.9]) for (let M = -3; M <= 3; M += 0.37) {
    const E = solveKepler(M, e);
    assert.ok(Math.abs(E - e * Math.sin(E) - M) < 1e-12);
  }
});

test('율리우스일: 2026-11-21 00:00 UTC = JD 2461365.5 + (TT−UTC)', () => {
  const jd = julianDateTT(Date.UTC(2026, 10, 21));
  assert.ok(Math.abs(jd - (2461365.5 + 69.184 / 86400)) < 1e-9);
});

test('궤도선 0번 점 = 지금 위치, 1번 점은 지난 위치(공전 방향의 반대)', () => {
  for (const key of Object.values(ID)) {
    const jd = 2461365.5;
    const t = orbitTrail(key, jd, 360);
    assert.equal(t.length, 361);
    assert.ok(norm(t[0].map((v, i) => v - heliocentric(key, jd)[i])) < 1e-12);
    // 0번 → 하루 뒤 위치 쪽으로 가야 순행. 1번 점은 반대쪽(과거)에 있어야 한다.
    const future = heliocentric(key, jd + 1);
    const v = future.map((x, i) => x - t[0][i]);
    const back = t[1].map((x, i) => x - t[0][i]);
    assert.ok(dot(v, back) < 0, `${key}: 궤도선이 공전 방향 쪽으로 그려짐`);
    assert.ok(norm(t[360].map((v, i) => v - t[0][i])) < 1e-9, '한 바퀴 닫힘');
  }
});

test('모든 행성이 황도 북극에서 볼 때 반시계(순행) — 황도 좌표 z, 화면 좌표 +Y', () => {
  for (const key of Object.values(ID)) {
    const jd = 2461365.5;
    const L = cross(heliocentric(key, jd), heliocentric(key, jd + 1));
    assert.ok(L[2] > 0, `${key} 황도 좌표 역행`);
    const Ls = cross(eclipticToScene(heliocentric(key, jd)), eclipticToScene(heliocentric(key, jd + 1)));
    assert.ok(Ls[1] > 0, `${key} 화면 좌표에서 +Y 쪽이 북쪽이 아님`);
  }
});

test('황도→화면 변환은 회전(행렬식 +1)', () => {
  const ex = eclipticToScene([1, 0, 0]), ey = eclipticToScene([0, 1, 0]), ez = eclipticToScene([0, 0, 1]);
  assert.ok(Math.abs(dot(cross(ex, ey), ez) - 1) < 1e-15);
});
