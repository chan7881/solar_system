// 지구 밤 불빛·대기 가장자리 빛 — src/atmosphere.js
// 기준값: JPL Horizons 지구 태양 직하점(tests/horizons_subsolar.txt, 측지 위도·동경+).
// 직하점은 「법선이 태양을 향하는 점」이므로 도시 법선과 직하점 법선의 코사인이 곧 그 도시의 sin(태양 고도)다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nightWeight, sunMu, rimGlow, NIGHT_GLSL, RIM_GLSL, TWILIGHT_DEG } from '../src/atmosphere.js';
import { glslToJs } from './glsl_to_js.mjs';

const DEG = Math.PI / 180;
const JD = { '1950-Jun-18': 2433450.5, '2000-Jan-01': 2451544.5, '2026-Nov-21': 2461365.5, '2046-Mar-01': 2468405.5 };
const rows = readFileSync(new URL('./horizons_subsolar.txt', import.meta.url), 'utf8').split(/\r?\n/)
  .filter(l => l.startsWith('399 ')).map(l => l.trim().split(/\s+/))
  .map(([, date, time, lon, lat, lt]) => {
    const [h, m, s] = time.split(':').map(Number);
    return { jd: JD[date] + (h + m / 60 + s / 3600) / 24, lon: +lon, lat: +lat, lt: +lt };
  });
const CITIES = { 서울: [126.98, 37.57], 런던: [-0.13, 51.51], 뉴욕: [-74.0, 40.71], 시드니: [151.21, -33.87], 케이프타운: [18.42, -33.92] };
const normal = (lon, lat) => [Math.cos(lat * DEG) * Math.cos(lon * DEG), Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG)];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test('기준값: 지구 직하점 4개', () => assert.equal(rows.length, 4));

for (const { jd, lon, lat, lt } of rows) {
  test(`JD ${jd} — 도시 5곳의 태양 고도가 Horizons 직하점과 맞는다(0.2° 안 — 실측 최대 0.145°, ΔT 69초 = 0.29°를 빠뜨리면 실패)`, () => {
    const sub = normal(lon, lat);
    for (const [name, [clon, clat]] of Object.entries(CITIES)) {
      const want = dot(normal(clon, clat), sub);
      const got = sunMu('earth', jd - lt / 1440, clon, clat);
      const dAlt = Math.abs(Math.asin(got) - Math.asin(want)) / DEG;
      assert.ok(dAlt < 0.2, `${name}: 태양 고도 ${(Math.asin(got) / DEG).toFixed(2)}° ≠ ${(Math.asin(want) / DEG).toFixed(2)}°`);
    }
  });
}

test('서울 2026-11-21: 09시(KST)는 낮이라 불빛 0, 21시는 밤이라 불빛 1', () => {
  const jd0 = 2461365.5 + 69.184 / 86400; // UTC 0시 → TT
  const [lon, lat] = CITIES.서울;
  const am = sunMu('earth', jd0, lon, lat), pm = sunMu('earth', jd0 + 0.5, lon, lat);
  assert.ok(am > 0.2, `09시 태양 고도 ${(Math.asin(am) / DEG).toFixed(1)}°`);
  assert.ok(pm < -0.5, `21시 태양 고도 ${(Math.asin(pm) / DEG).toFixed(1)}°`);
  assert.equal(nightWeight(am), 0);
  assert.equal(nightWeight(pm), 1);
});

test('밤 불빛 세기: 직하점 0 · 반대쪽 1 · 해 질 때 0 · 고도 −12°에서 1 · 고도가 낮을수록 커진다', () => {
  assert.equal(nightWeight(1), 0);
  assert.equal(nightWeight(-1), 1);
  assert.equal(nightWeight(0), 0);
  assert.equal(nightWeight(Math.sin(-TWILIGHT_DEG * DEG)), 1);
  const mid = nightWeight(Math.sin(-6 * DEG));
  assert.ok(mid > 0.4 && mid < 0.6, `−6°에서 ${mid}`);
  let prev = -1;
  for (let a = 10; a >= -20; a -= 0.5) {
    const w = nightWeight(Math.sin(a * DEG));
    assert.ok(w >= prev, `고도 ${a}°에서 줄어듦`);
    prev = w;
  }
});

test('셰이더 식이 JS와 같다 — nightWeight·rimGlow', () => {
  const G = glslToJs(NIGHT_GLSL + RIM_GLSL);
  for (let mu = -1; mu <= 1; mu += 0.01) assert.ok(Math.abs(G.nightWeight(mu) - nightWeight(mu)) < 1e-12, `mu ${mu}`);
  for (const k of [1.01, 1.016, 1.05]) for (let v = 0; v <= 1; v += 0.01) for (let s = -1; s <= 1; s += 0.05) {
    assert.ok(Math.abs(G.rimGlow(v, s, k) - rimGlow(v, s, k)) < 1e-12, `v ${v} s ${s} k ${k}`);
  }
});

test('가장자리 빛: 몸체 가장자리(b=1)에서 가장 밝고 원판 가운데·껍질 끝에서 0, b=1에서 이어진다', () => {
  const k = 1.016, edge = Math.sqrt(1 - 1 / (k * k)); // b=1인 muView
  const g = v => rimGlow(v, 1, k);
  assert.ok(Math.abs(g(edge) - 1) < 1e-9, `가장자리 ${g(edge)}`);
  assert.ok(g(1) < 1e-12, `원판 가운데 ${g(1)}`);
  assert.ok(g(0) < 1e-12, `껍질 끝 ${g(0)}`);
  // 원판 쪽은 가장자리에서 기울기가 무한대(구의 가장자리)라 아주 가까운 두 점으로 본다
  assert.ok(Math.abs(g(edge + 1e-12) - g(edge - 1e-12)) < 1e-4, 'b=1에서 끊긴다');
  // 가장자리 안쪽(원판 위)과 바깥(하늘) 모두 가장자리에서 멀어질수록 어두워진다
  for (let v = edge; v < 1; v += 0.02) assert.ok(g(v + 0.02 > 1 ? 1 : v + 0.02) <= g(v) + 1e-12, `원판 위 v ${v}`);
  for (let v = edge; v > 0.005; v -= 0.005) assert.ok(g(v - 0.005) <= g(v) + 1e-12, `하늘 v ${v}`);
});

test('가장자리 빛: 낮 쪽만 밝다 — 태양 쪽 1, 반대쪽 0, 해 질 녘은 그 사이', () => {
  const k = 1.016, edge = Math.sqrt(1 - 1 / (k * k));
  assert.equal(rimGlow(edge, 1, k), rimGlow(edge, 0.5, k));
  assert.equal(rimGlow(edge, -1, k), 0);
  const dusk = rimGlow(edge, 0, k);
  assert.ok(dusk > 0.1 && dusk < 0.9, `해 질 녘 ${dusk}`);
  assert.ok(rimGlow(edge, 0.1, k) > rimGlow(edge, -0.1, k));
});
