// 궤도 보기(src/orbit.js) — Horizons 대조(tests/horizons_orbit.json, tools/fetch_orbit_check.py)와 그림의 방향.
// 허용치는 2026-11-22 실측 최대 차이의 약 2배(행성은 Standish 평균 요소 ↔ Horizons 접촉 요소라 바깥 행성일수록 크다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { orbitOf, basisFromAngles, elementsFromState, apsisNames, orbitCenter, orbitMarks, orbitView, orbitFit, ellipsePoint } from '../src/orbit.js';
import { julianDateTT } from '../src/ephemeris.js';

const H = JSON.parse(fs.readFileSync(new URL('./horizons_orbit.json', import.meta.url), 'utf8'));
const D = Math.PI / 180;
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const len = u => Math.hypot(...u);
const angle = (u, v) => Math.acos(Math.max(-1, Math.min(1, dot(u, v) / (len(u) * len(v))))) / D;
const rel = (x, y) => Math.abs(x / y - 1);
const sub = (p, q) => p.map((v, i) => v - q[i]);

// [a·근점·원점 상대 오차, e 절대 오차, 궤도면 법선 W(°), 근점 방향 P(°)]
const T_IN = [3e-4, 2e-4, 0.01, 0.5];
const TOL = {
  mercury: T_IN, venus: T_IN, earth: [3e-4, 2e-4, 0.01, 0.3], mars: T_IN,
  jupiter: [1.5e-3, 1.2e-3, 0.01, 2], saturn: [7e-3, 3e-3, 0.01, 4], uranus: [1e-2, 3e-3, 0.01, 9], neptune: [2.5e-2, 1.2e-2, 0.01, 26],
  ceres: [5e-4, 3e-4, 0.01, 0.1], pluto: [7e-4, 3e-4, 0.01, 0.1], eris: [5e-4, 3e-4, 0.015, 0.1], haumea: [7e-4, 4e-4, 0.01, 0.1],
  makemake: [5e-4, 3e-4, 0.01, 0.1], halley: [1.2e-3, 1e-4, 0.015, 0.01], encke: [7e-4, 1.2e-4, 0.01, 0.01],
  churyumov: [4e-4, 1e-4, 0.01, 0.02], swifttuttle: [7e-4, 1e-4, 0.03, 0.01], halebopp: [4e-3, 3e-5, 0.06, 0.02],
  moon: [5e-4, 3e-4, 0.05, 0.25],
};

function checkElements(key, rows) {
  const [tr, te, tw, tp] = TOL[key];
  for (const r of rows) {
    const o = orbitOf(key, r.jd), B = basisFromAngles(r.i * D, r.node * D, r.argp * D), at = `${key} JD ${r.jd}`;
    assert.ok(rel(o.a, r.a) < tr, `${at} a ${o.a} ↔ ${r.a}`);
    assert.ok(rel(o.peri, r.q) < tr, `${at} 근점 ${o.peri} ↔ ${r.q}`);
    assert.ok(rel(o.apo, r.Q) < tr, `${at} 원점 ${o.apo} ↔ ${r.Q}`);
    assert.ok(Math.abs(o.e - r.e) < te, `${at} e ${o.e} ↔ ${r.e}`);
    assert.ok(angle(o.W, B.W) < tw, `${at} 궤도면 ${angle(o.W, B.W)}°`);
    assert.ok(angle(o.P, B.P) < tp, `${at} 근점 방향 ${angle(o.P, B.P)}°`);
  }
}

test('행성 궤도 요소 — Horizons 접촉 요소와 대조', () => {
  for (const [k, rows] of Object.entries(H.planets)) checkElements(k, rows);
});
test('왜행성·혜성 — 1년 격자 사이 날짜에서 Horizons 접촉 요소와 대조', () => {
  for (const [k, rows] of Object.entries(H.small)) checkElements(k, rows);
});
test('달 — ELP 위치·속도의 접촉 요소가 Horizons(같은 μ = 지구+달)와 맞다', () => {
  assert.ok(Math.abs(H.moon.gm - 403503.2356) < 0.01, `Horizons 달 GM ${H.moon.gm}`);
  checkElements('moon', H.moon.rows);
});
test('위성 — 그린 근점·원점이 실제 한 바퀴의 가장 가까운·먼 거리와 맞고, 궤도면도 맞다', () => {
  const loose = new Set(['mimas', 'hyperion']); // 미마스 공명 흔들림, 히페리온 타이탄 섭동 — 실측 4.7e-3
  for (const [k, rows] of Object.entries(H.moons)) {
    const tq = loose.has(k) ? 1e-2 : 4e-3, tw = k === 'hyperion' ? 0.5 : 0.25;
    for (const r of rows) {
      const o = orbitOf(k, r.jd);
      assert.ok(Math.abs(o.peri - r.min) / o.a < tq, `${k} 근점 ${o.peri} ↔ 실제 ${r.min}`);
      assert.ok(Math.abs(o.apo - r.max) / o.a < tq, `${k} 원점 ${o.apo} ↔ 실제 ${r.max}`);
      assert.ok(angle(o.W, r.pole) < tw, `${k} 궤도면 ${angle(o.W, r.pole)}°`);
    }
  }
});

test('식: b = a√(1−e²), 근점 = a(1−e), 원점 = a(1+e), 중심–초점 = ae', () => {
  const jd = julianDateTT(Date.UTC(2026, 10, 22));
  for (const k of ['mars', 'halley', 'moon', 'io', 'charon']) {
    const o = orbitOf(k, jd), m = orbitMarks(o);
    assert.ok(rel(o.b, o.a * Math.sqrt(1 - o.e * o.e)) < 1e-12);
    assert.ok(rel(o.peri, o.a * (1 - o.e)) < 1e-12 && rel(o.apo, o.a * (1 + o.e)) < 1e-12);
    assert.ok(rel(len(sub(m.peri, m.center)), o.a) < 1e-9, `${k} 중심→근점 = a`);
    assert.ok(rel(len(sub(m.minor, m.center)), o.b) < 1e-9, `${k} 중심→단축 끝 = b`);
    assert.ok(Math.abs(dot(sub(m.minor, m.center), o.P)) < 1e-6 * o.a, `${k} 단반경 ⟂ 장반경`);
    assert.ok(rel(len(m.center), o.a * o.e) < 1e-9, `${k} 중심–초점 = ae`);
    assert.ok(len(m.peri) < len(m.apo), `${k} 근점이 원점보다 가깝다`);
    assert.ok(len(sub(ellipsePoint(o, 0), m.peri)) < 1e-6 * o.a && len(sub(ellipsePoint(o, Math.PI), m.apo)) < 1e-6 * o.a);
  }
});
test('Q는 운동 방향 — 근점 직후 점이 +Q 쪽, W = P × Q', () => {
  const o = orbitOf('mars', julianDateTT(Date.UTC(2026, 10, 22)));
  const W = [o.P[1] * o.Q[2] - o.P[2] * o.Q[1], o.P[2] * o.Q[0] - o.P[0] * o.Q[2], o.P[0] * o.Q[1] - o.P[1] * o.Q[0]];
  assert.ok(angle(W, o.W) < 1e-4);
  assert.ok(o.W[2] > 0.99, '화성은 순행 — 법선이 황도 북쪽');
  // 원 궤도 상태 벡터: x축 위, +y로 움직이면 W = +z
  const s = elementsFromState([7000, 0, 0], [0, Math.sqrt(398600 / 7000) * 1.01, 0], 398600);
  assert.ok(s.W[2] > 0.999 && s.P[0] > 0.999 && s.Q[1] > 0.999 && s.e > 0);
});
test('근점·원점 이름과 중심 천체', () => {
  assert.deepEqual(apsisNames('sun'), ['근일점', '원일점']);
  assert.deepEqual(apsisNames('earth'), ['근지점', '원지점']);
  assert.deepEqual(apsisNames('jupiter'), ['근점', '원점']);
  assert.equal(orbitCenter('moon'), 'earth'); assert.equal(orbitCenter('charon'), 'pluto');
  assert.equal(orbitCenter('mars'), 'sun'); assert.equal(orbitCenter('halley'), 'sun');
});
test('카메라: 황도 북쪽 편에서 궤도면에 수직, 근점이 화면 왼쪽', () => {
  const jd = julianDateTT(Date.UTC(2026, 10, 22));
  for (const k of ['mars', 'halley', 'triton', 'miranda', 'moon']) {
    const o = orbitOf(k, jd), v = orbitView(o);
    assert.ok(v.dir[2] >= 0, `${k} 황도 북쪽 편`);
    assert.ok(angle(v.dir, o.W) < 1e-3 || angle(v.dir, o.W) > 179.999, `${k} 궤도면에 수직`);
    assert.ok(Math.abs(dot(v.up, v.dir)) < 1e-9 && Math.abs(dot(v.up, o.P)) < 1e-9, `${k} up은 화면에 놓인 단축 방향`);
    // 카메라 오른쪽 = up × dir(카메라 쪽) — 근점 방향 P의 반대
    const r = [v.up[1] * v.dir[2] - v.up[2] * v.dir[1], v.up[2] * v.dir[0] - v.up[0] * v.dir[2], v.up[0] * v.dir[1] - v.up[1] * v.dir[0]];
    assert.ok(angle(r, o.P) > 179.999, `${k} 근점이 왼쪽`);
    assert.ok(angle(r, v.right) < 1e-3);
  }
  // 핼리는 역행(i 162°) — 황도 북쪽에서 보면 법선 반대편, 시계 방향
  const h = orbitOf('halley', jd);
  assert.ok(h.W[2] < 0 && angle(orbitView(h).dir, h.W) > 179.9);
});
test('화면 맞추기: 장반경·단반경이 영역 안에 들고 타원 중심이 영역 가운데로', () => {
  const o = { a: 1e8, b: 4e7 }, f = 800, box = { l: 0, t: 300, r: 390, b: 650 };
  const { d, dx, dy } = orbitFit(o, box, 195, 325, f);
  assert.ok((o.a * f) / d <= 195 - 28 + 1e-9 && (o.b * f) / d <= 175 - 28 + 1e-9);
  assert.ok(Math.abs((o.a * f) / d - (195 - 28)) < 1e-6 || Math.abs((o.b * f) / d - (175 - 28)) < 1e-6, '어느 한쪽은 꽉 찬다');
  assert.equal(dx, 0); assert.equal(dy, 475 - 325);
});
test('천체의 지금 위치가 그린 타원 위에 있다(근점 방향까지)', async () => {
  const { moonPosition, MOONS } = await import('../src/moons.js');
  const { heliocentric, AU_KM, BODIES } = await import('../src/ephemeris.js');
  const { smallBodyHelio, SMALL_BODIES } = await import('../src/smallbodies.js');
  const pos = k => MOONS.some(m => m.key === k) ? moonPosition(k, jd)
    : SMALL_BODIES.some(b => b.key === k) ? smallBodyHelio(k, jd).map(v => v * AU_KM) : heliocentric(k, jd).map(v => v * AU_KM);
  let jd;
  const keys = [...BODIES.filter(b => b.key !== 'sun').map(b => b.key), ...MOONS.map(m => m.key).filter(k => k !== 'moon'), ...SMALL_BODIES.map(b => b.key)];
  for (const ms of [Date.UTC(1850, 5, 15), Date.UTC(2026, 10, 22, 7), Date.UTC(2049, 6, 1)]) {
    jd = julianDateTT(ms);
    for (const k of keys) {
      const o = orbitOf(k, jd), r = pos(k);
      // 궤도면 안에서 근점으로부터 잰 각 ν → 타원 식 r = a(1−e²)/(1 + e cos ν)
      const x = dot(r, o.P), y = dot(r, o.Q), nu = Math.atan2(y, x);
      const rr = o.a * (1 - o.e * o.e) / (1 + o.e * Math.cos(nu));
      const tol = SMALL_BODIES.some(b => b.key === k) ? 2e-3 : 1e-6; // 소천체 위치는 두 기원의 위치를 보간 — 요소 보간과 조금 다르다
      assert.ok(Math.abs(len(r) / rr - 1) < tol, `${k} 거리 ${len(r)} ↔ 타원 ${rr}`);
      assert.ok(Math.abs(dot(r, o.W)) / len(r) < tol, `${k} 궤도면 밖 ${dot(r, o.W) / len(r)}`);
    }
  }
});
