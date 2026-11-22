// 포보스·데이모스 모양 파일 — 몸체 좌표로 바꾼 뒤의 크기·방향·감기
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseShape, shapeVolume, SHAPE_REACH } from '../src/shapes.js';
import { MOONS } from '../src/moons.js';

const load = key => { const b = readFileSync(new URL(`../textures/${key}_shape.bin`, import.meta.url)); return parseShape(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
// 크기 기준: pck00011 RADII(3축 타원체 반지름, km) — 몸체 좌표에서 X = a(화성 쪽 긴 축), Z = b(공전 방향), Y = c(북극)
const RADII = { phobos: [13.0, 11.4, 9.1], deimos: [7.8, 6.0, 5.1] };

for (const key of ['phobos', 'deimos']) {
  const s = load(key), p = s.positions;
  const half = [0, 1, 2].map(ax => { let lo = Infinity, hi = -Infinity; for (let i = ax; i < p.length; i += 3) { lo = Math.min(lo, p[i]); hi = Math.max(hi, p[i]); } return (hi - lo) / 2; });
  test(`${key}: 바깥 감기(부피 양수)이고 부피 같은 구 반지름이 JPL 평균 반지름과 1% 안`, () => {
    const v = shapeVolume(s);
    assert.ok(v > 0, `부피 ${v}`);
    const r = Math.cbrt(3 * v / 4 / Math.PI), ref = MOONS.find(m => m.key === key).radius;
    assert.ok(Math.abs(r / ref - 1) < 0.01, `${r.toFixed(3)} 대 ${ref}`);
  });
  test(`${key}: SHAPE_REACH가 파일의 가장 먼 점보다 크고 0.02km 안`, () => {
    let r = 0; for (let i = 0; i < p.length; i += 3) r = Math.max(r, Math.hypot(p[i], p[i + 1], p[i + 2]));
    assert.ok(SHAPE_REACH[key] >= r && SHAPE_REACH[key] - r < 0.02, `${SHAPE_REACH[key]} 대 ${r.toFixed(3)}`);
  });
  test(`${key}: 몸체 X(경도 0°)가 가장 긴 축, Y(북극)가 가장 짧은 축 — 반폭이 pck 반지름과 0.7km 안(포보스 북극 쪽 반폭 9.73 대 9.1 — 맞춘 타원체보다 튀어나온 곳이 있다)`, () => {
    const [a, b, c] = RADII[key];
    assert.ok(half[0] > half[2] && half[2] > half[1], half.map(x => x.toFixed(2)).join(' '));
    assert.ok(Math.abs(half[0] - a) < 0.7 && Math.abs(half[2] - b) < 0.7 && Math.abs(half[1] - c) < 0.7, half.map(x => x.toFixed(2)).join(' '));
  });
}

// 포보스 스티크니 충돌구(지름 약 9km, 깊이 약 1km)는 서경 49°(동경 311°)·남위 1°(USGS 행성 지명 사전) —
//   그 방향의 반지름이 pck 3축 타원체보다 0.6km 넘게 낮다(2026-11-21 실측 0.83km).
//   경도가 거꾸로(동·서)거나 몸체 좌표 바꿈이 틀리면 거울 쪽 동경 49°를 보게 되는데, 그쪽은 0.22km뿐이다.
test('포보스: 스티크니 쪽(동경 311°, 적도)이 타원체보다 움푹하고, 거울 쪽(동경 49°)은 아니다', () => {
  const { positions: p } = load('phobos');
  const [a, b] = RADII.phobos;
  // 방향 (경도 λ, 위도 0)에 가장 가까운 꼭짓점의 반지름이 그 방향 타원체 반지름보다 얼마나 낮은가. 몸체 좌표: x = cosλ, −z = sinλ
  const depth = lon => {
    const L = lon * Math.PI / 180, d = [Math.cos(L), 0, -Math.sin(L)];
    let best = -2, r = 0;
    for (let i = 0; i < p.length; i += 3) {
      const n = Math.hypot(p[i], p[i + 1], p[i + 2]), c = (p[i] * d[0] + p[i + 1] * d[1] + p[i + 2] * d[2]) / n;
      if (c > best) { best = c; r = n; }
    }
    return 1 / Math.hypot(Math.cos(L) / a, Math.sin(L) / b) - r;
  };
  const s = depth(311), m = depth(49);
  assert.ok(s > 0.6, `스티크니 ${s.toFixed(2)}km`);
  assert.ok(m < 0.4, `거울 쪽 ${m.toFixed(2)}km`);
});

// 히페리온(Thomas, Cassini ISS) — 천체 고정 z는 2005-09-26 근접 비행 때의 자전축이고 긴 축 쪽이다(원본 설명서 · Thomas 2007 반지름 180×133×103km).
//   몸체 좌표로 바꾸면 긴 축이 +Y(북극)로 가야 한다 — 바꿈 (x,y,z)→(x,z,−y)를 틀리면 긴 축이 X나 Z로 간다.
test('히페리온: 바깥 감기, 부피 같은 구 반지름이 JPL 평균 반지름 135±4km 안, 긴 축(반폭 170km)이 몸체 +Y', () => {
  const s = load('hyperion'), p = s.positions;
  const v = shapeVolume(s), r = Math.cbrt(3 * v / 4 / Math.PI);
  assert.ok(v > 0 && Math.abs(r - MOONS.find(m => m.key === 'hyperion').radius) < 4, `${r.toFixed(2)}km`);
  const half = [0, 1, 2].map(ax => { let lo = Infinity, hi = -Infinity; for (let i = ax; i < p.length; i += 3) { lo = Math.min(lo, p[i]); hi = Math.max(hi, p[i]); } return (hi - lo) / 2; });
  assert.ok(half[1] > 160 && half[0] < 140 && half[2] < 140, half.map(x => x.toFixed(1)).join(' '));
  let far = 0; for (let i = 0; i < p.length; i += 3) far = Math.max(far, Math.hypot(p[i], p[i + 1], p[i + 2]));
  assert.ok(SHAPE_REACH.hyperion >= far && SHAPE_REACH.hyperion - far < 0.02, `${SHAPE_REACH.hyperion} 대 ${far.toFixed(3)}`);
});

// 혜성 핵(tools/make_comets.py) — 부피 같은 구 반지름이 COMETS radius와, 가장 먼 점이 SHAPE_REACH와 맞는다
import { COMETS } from '../src/smallbodies.js';
for (const c of COMETS) {
  test(`${c.key}: 바깥 감기, 부피 같은 구 반지름이 COMETS radius와 1% 안, SHAPE_REACH가 가장 먼 점보다 크고 0.02km 안`, () => {
    const s = load(c.key), p = s.positions, v = shapeVolume(s);
    assert.ok(v > 0, `부피 ${v}`);
    const r = Math.cbrt(3 * v / 4 / Math.PI);
    assert.ok(Math.abs(r / c.radius - 1) < 0.01, `${r.toFixed(3)} 대 ${c.radius}`);
    let far = 0; for (let i = 0; i < p.length; i += 3) far = Math.max(far, Math.hypot(p[i], p[i + 1], p[i + 2]));
    assert.ok(SHAPE_REACH[c.key] >= far && SHAPE_REACH[c.key] - far < 0.02, `${SHAPE_REACH[c.key]} 대 ${far.toFixed(3)}`);
  });
}
// 핼리: Giotto·Vega로 잰 크기 약 16 × 8 × 8km(Keller et al. 1987 등) — 가장 긴 폭 14~17km, 나머지 둘 6.5~9km
test('핼리: 길쭉한 핵 — 가장 긴 폭 14~17km, 나머지 6.5~9km', () => {
  const { positions: p } = load('halley');
  const w = [0, 1, 2].map(ax => { let lo = Infinity, hi = -Infinity; for (let i = ax; i < p.length; i += 3) { lo = Math.min(lo, p[i]); hi = Math.max(hi, p[i]); } return hi - lo; }).sort((a, b) => b - a);
  assert.ok(w[0] > 14 && w[0] < 17 && w[1] > 6.5 && w[1] < 9 && w[2] > 6.5 && w[2] < 9, w.map(x => x.toFixed(2)).join(' '));
});
// 67P: 두 덩이 — 부피 18.8km³ 안팎(Jorda et al. 2016: 18.8 ± 0.3), 폭 4.1 × 3.3 × 1.8km짜리 큰 덩이 + 작은 덩이(전체 약 5km)
test('67P: 부피 17~20km³, 가장 긴 폭 4.6~5.4km', () => {
  const s = load('churyumov'), p = s.positions, v = shapeVolume(s);
  let lo = Infinity, hi = -Infinity; for (let i = 0; i < p.length; i += 3) { lo = Math.min(lo, p[i]); hi = Math.max(hi, p[i]); }
  assert.ok(v > 17 && v < 20, `부피 ${v.toFixed(2)}`);
  assert.ok(hi - lo > 4.6 && hi - lo < 5.4, `x 폭 ${(hi - lo).toFixed(2)}`);
});
