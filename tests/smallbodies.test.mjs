// 소천체 — 왜행성·혜성 위치(Horizons 대조), 점 무리(소행성 대조·공명 무리 유지·카이퍼대 구조), 오르트 구름 모형
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DWARFS, COMETS, isSmallBody, smallBodyHelio, smallBodyTrail, trailSpread, parsePoints, pointPositions, oortCloud, OORT, keplerE } from '../src/smallbodies.js';
import { heliocentric } from '../src/ephemeris.js';

const here = new URL('.', import.meta.url);
const ref = fs.readFileSync(new URL('horizons_smallbodies.txt', here), 'utf8').trim().split('\n').slice(1).map(l => {
  const [key, jd, x, y, z] = l.split(' ');
  return { key, jd: +jd, h: [+x, +y, +z] };
});
const P = parsePoints(fs.readFileSync(new URL('../textures/small_bodies.bin', here)).buffer.slice(0));
const ang = (a, b) => Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.hypot(...a) / Math.hypot(...b))) * 180 / Math.PI;
const lon = v => Math.atan2(v[1], v[0]) * 180 / Math.PI;
const wrap = d => ((d % 360) + 540) % 360 - 180;
const at = (out, k) => [out[k * 3], -out[k * 3 + 2], out[k * 3 + 1]]; // 장면 → 황도
const positions = jd => pointPositions(P, jd, new Float32Array(P.count * 3));

test('왜행성 5개는 Horizons와 방향 0.01°, 거리 0.001AU 안 (1801~2050, 8개 날짜)', () => {
  for (const b of DWARFS) {
    const rows = ref.filter(r => r.key === b.key);
    assert.ok(rows.length >= 7, b.key);
    for (const r of rows) {
      const p = smallBodyHelio(b.key, r.jd);
      assert.ok(ang(p, r.h) < 0.01, `${b.key} ${r.jd} ${ang(p, r.h)}`);
      assert.ok(Math.abs(Math.hypot(...p) - Math.hypot(...r.h)) < 1e-3, `${b.key} ${r.jd}`);
    }
  }
});

test('혜성 5개는 Horizons와 방향 0.15°, 거리 0.001AU 안 — 근일점 통과 날짜 포함(핼리 1835·1910·1986)', () => {
  for (const b of COMETS) {
    for (const r of ref.filter(x => x.key === b.key)) {
      const p = smallBodyHelio(b.key, r.jd);
      assert.ok(ang(p, r.h) < 0.15, `${b.key} ${r.jd} ${ang(p, r.h)}`);
      assert.ok(Math.abs(Math.hypot(...p) - Math.hypot(...r.h)) < 1e-3, `${b.key} ${r.jd}`);
    }
  }
});

test('핼리 혜성은 1910-04-20·1986-02-09에 태양에서 0.6AU 안(근일점 0.59AU)이고 1948년엔 35AU 밖(원일점)', () => {
  const jd = s => Date.parse(s) / 86400000 + 2440587.5;
  assert.ok(Math.hypot(...smallBodyHelio('halley', jd('1910-04-20'))) < 0.6);
  assert.ok(Math.hypot(...smallBodyHelio('halley', jd('1986-02-09'))) < 0.6);
  assert.ok(Math.hypot(...smallBodyHelio('halley', jd('1948-12-09'))) > 35);
});

test('궤도선은 지금 위치에서 시작하고 한 바퀴 돌아 닫힌다', () => {
  for (const key of ['pluto', 'halebopp', 'encke']) {
    const jd = 2461365.5, pts = smallBodyTrail(key, jd, 360), p = smallBodyHelio(key, jd);
    const r = Math.hypot(...p);
    assert.ok(Math.hypot(...pts[0].map((v, i) => v - p[i])) < 0.01 * r, key);
    assert.ok(Math.hypot(...pts[0].map((v, i) => v - pts[360][i])) < 1e-9, key);
  }
});

test('궤도선은 어디서도 한 칸에 5° 넘게 꺾이지 않는다 — 헤일-밥(e 0.995)·핼리·엔케, 근일점 무렵 포함', () => {
  for (const [key, jd] of [['halebopp', 2450539.5], ['halebopp', 2461365.5], ['halley', 2446471.0], ['encke', 2461365.5]]) {
    const pts = smallBodyTrail(key, jd, 360);
    let worst = 0;
    for (let j = 2; j < pts.length; j++) {
      const u = pts[j - 1].map((v, i) => v - pts[j - 2][i]), v = pts[j].map((x, i) => x - pts[j - 1][i]);
      worst = Math.max(worst, ang(u, v));
    }
    assert.ok(worst < 5, `${key} ${jd} 최대 ${worst.toFixed(1)}°`);
  }
  assert.equal(trailSpread(0), 0); // 원 궤도면 고른 E 그대로
});

test('하우메아는 가장 먼 점(긴 반지름 1161km)을 reach로 둔다 — 카메라가 몸체 안으로 들어가지 않게', () => {
  const h = DWARFS.find(b => b.key === 'haumea');
  assert.equal(h.reach, Math.max(...h.abc));
});

test('몸체로 그리는 왜행성은 점 무리에 겹쳐 찍히지 않는다(2026-11-21 위치에서 0.05AU 안에 점 없음)', () => {
  const jd = 2461365.5, out = positions(jd);
  for (const b of DWARFS) {
    const h = smallBodyHelio(b.key, jd);
    let best = Infinity;
    for (let k = 0; k < P.count; k++) best = Math.min(best, Math.hypot(...at(out, k).map((v, i) => v - h[i])));
    assert.ok(best > 0.05, `${b.key} ${best}`);
  }
});

test('케플러 방정식 — 이심률 0.995에서도 풀린다', () => {
  for (const M of [1e-4, 0.01, 0.5, 3, -2]) {
    const E = keplerE(M, 0.995);
    assert.ok(Math.abs(E - 0.995 * Math.sin(E) - M) < 1e-11, String(M));
  }
});

test('isSmallBody는 소천체만', () => {
  assert.ok(isSmallBody('pluto') && isSmallBody('halley'));
  assert.ok(!isSmallBody('earth') && !isSmallBody('moon'));
});

// ---------- 점 무리 ----------
const count = g => P.group.reduce((s, x) => s + (x === g), 0);

test('점 무리 개수 — 소행성대·힐다·트로이(H<14)와 카이퍼대', () => {
  assert.ok(count(0) > 15000 && count(1) > 300 && count(2) > 3000 && count(3) > 3000, [0, 1, 2, 3].map(count).join(' '));
});

test('무리마다 궤도 긴반지름 범위 — 소행성대 1.7~3.7AU 중 2.1~3.3에 95%, 힐다 3.7~4.2, 트로이 4.8~5.6, 카이퍼대 30AU 밖', () => {
  let belt = 0, beltIn = 0;
  for (let k = 0; k < P.count; k++) {
    const a = P.a[k], g = P.group[k];
    if (g === 0) { belt++; beltIn += a > 2.1 && a < 3.3; assert.ok(a > 1.7 && a < 4.7, String(a)); }
    if (g === 1) assert.ok(a >= 3.7 && a <= 4.2);
    if (g === 2) assert.ok(a > 4.8 && a < 5.6, String(a));
    if (g === 3) assert.ok(a > 30);
  }
  assert.ok(beltIn / belt > 0.95);
});

test('카이퍼대 구조 — 명왕성족(3:2, 39.4AU) 봉우리와 48AU 절벽', () => {
  const h = {};
  for (let k = 0; k < P.count; k++) if (P.group[k] === 3) h[Math.floor(P.a[k])] = (h[Math.floor(P.a[k])] || 0) + 1;
  assert.ok(h[39] > 3 * h[38] && h[39] > 3 * h[40], `39AU ${h[39]} 38 ${h[38]} 40 ${h[40]}`);
  const classical = h[42] + h[43] + h[44] + h[45] + h[46] + h[47], beyond = h[48] + h[49] + h[50] + h[51] + h[52] + h[53];
  assert.ok(classical > 5 * beyond, `${classical} 대 ${beyond}`); // 42~48AU 고전 카이퍼대 대비 48~54AU가 크게 줄어든다
});

test('2026-11-21 위치가 Horizons와 맞는다 — 베스타·힐다·헥토르·아로코스(가장 가까운 점이 0.03AU 안, 방향 0.3°)', () => {
  const jd = 2461365.5, out = positions(jd);
  for (const key of ['vesta', 'hilda', 'hektor', 'arrokoth']) {
    const r = ref.find(x => x.key === key && x.jd === jd);
    let best = Infinity, bk = -1;
    for (let k = 0; k < P.count; k++) {
      const d = Math.hypot(...at(out, k).map((v, i) => v - r.h[i]));
      if (d < best) { best = d; bk = k; }
    }
    assert.ok(best < 0.03 && ang(at(out, bk), r.h) < 0.3, `${key} ${best}`);
  }
});

// 공명 무리는 1800·2050년에도 무리 모양을 지킨다 — 접촉 궤도 요소의 평균 운동으로 돌리면 흩어진다
for (const jd of [2378496.5, 2470172.5]) {
  test(`트로이는 목성 앞뒤 60°(L4·L5) 둘레에 모인다 — ${jd < 2.4e6 ? 1800 : 2050}년`, () => {
    const out = positions(jd), J = lon(heliocentric('jupiter', jd));
    let n = 0, near = 0, l4 = 0;
    for (let k = 0; k < P.count; k++) {
      if (P.group[k] !== 2) continue;
      const d = wrap(lon(at(out, k)) - J);
      n++; near += Math.abs(Math.abs(d) - 60) < 40; l4 += d > 0;
    }
    assert.ok(near / n > 0.97, `${near}/${n}`);
    assert.ok(l4 / n > 0.5 && l4 / n < 0.75, `L4 비율 ${l4 / n}`); // L4(그리스군)가 L5보다 많다(약 1.6~2배)
  });
  test(`힐다는 원일점이 목성과 180°·±60°에 모인다(삼각형) — ${jd < 2.4e6 ? 1800 : 2050}년`, () => {
    const out = positions(jd), J = lon(heliocentric('jupiter', jd));
    let n = 0, ok = 0;
    for (let k = 0; k < P.count; k++) {
      if (P.group[k] !== 1) continue;
      const p = at(out, k), r = Math.hypot(...p), Q = P.a[k] * (1 + P.e[k]);
      if (r < Q - 0.25 * (Q - P.a[k] * (1 - P.e[k]))) continue; // 원일점 가까이에 있는 것만
      const d = wrap(lon(p) - J);
      n++; ok += [180, 60, -60, -180].some(c => Math.abs(wrap(d - c)) < 30);
    }
    assert.ok(n > 50 && ok / n > 0.85, `${ok}/${n}`);
  });
}

// ---------- 오르트 구름 ----------
test('오르트 구름 모형 — 3,000~100,000AU, 밀도 기울기 −3.5, 방향은 고르게', () => {
  const N = 40000, pts = oortCloud(N);
  const r = [];
  let zsum = 0, ysum = 0;
  for (let k = 0; k < N; k++) {
    const x = pts[k * 3], y = pts[k * 3 + 1], z = pts[k * 3 + 2], d = Math.hypot(x, y, z);
    r.push(d); ysum += y / d; zsum += Math.abs(y / d);
  }
  assert.ok(Math.min(...r) >= OORT.rIn * 0.999 && Math.max(...r) <= OORT.rOut * 1.001);
  // 로그 간격 껍질의 밀도로 기울기를 잰다
  const edges = [3000, 6000, 12000, 24000, 48000, 96000];
  const dens = edges.slice(0, -1).map((a, i) => {
    const b = edges[i + 1], n = r.filter(x => x >= a && x < b).length;
    return [Math.log(Math.sqrt(a * b)), Math.log(n / (4 / 3 * Math.PI * (b ** 3 - a ** 3)))];
  });
  const mx = dens.reduce((s, d) => s + d[0], 0) / dens.length, my = dens.reduce((s, d) => s + d[1], 0) / dens.length;
  const slope = dens.reduce((s, d) => s + (d[0] - mx) * (d[1] - my), 0) / dens.reduce((s, d) => s + (d[0] - mx) ** 2, 0);
  assert.ok(Math.abs(slope + 3.5) < 0.1, `기울기 ${slope}`);
  assert.ok(Math.abs(ysum / N) < 0.02 && Math.abs(zsum / N - 0.5) < 0.02); // 고른 방향이면 |cos| 평균 0.5
  // 안쪽(20,000AU 미만, 힐스 구름)이 바깥보다 많다
  assert.ok(r.filter(x => x < 20000).length > 2 * r.filter(x => x >= 20000).length);
});
