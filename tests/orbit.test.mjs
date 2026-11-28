// 궤도 보기(src/orbit.js) — Horizons 대조(tests/horizons_orbit.json, tools/fetch_orbit_check.py)와 그림의 방향.
// 허용치는 2026-11-22 실측 최대 차이의 약 2배(행성은 Standish 평균 요소 ↔ Horizons 접촉 요소라 바깥 행성일수록 크다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { orbitOf, basisFromAngles, elementsFromState, apsisNames, orbitCenter, orbitMarks, orbitView, orbitFit, ellipsePoint, orbitPeriodYears, periodText, centerChain, pairOrbits, orbitsFit } from '../src/orbit.js';
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

// 공전 주기 — 관측으로 알려진 항성 공전 주기(일; NASA Planetary Fact Sheet · JPL SSD Planetary/Satellite Mean Elements·Physical Parameters)와 대조.
// 허용 오차(%)는 2026-11-23 실측 차이의 약 2배 이상 — 달·미마스·엔셀라두스·테티스는 접촉(순간) 요소의 주기가 평균 주기와 달라서, 명왕성·마케마케·에리스는 Horizons 접촉 요소라서 크다.
const OBS_DAYS = { mercury: 87.969, venus: 224.701, earth: 365.256, mars: 686.980, jupiter: 4332.589, saturn: 10759.22, uranus: 30685.4, neptune: 60189,
  pluto: 90560, ceres: 1681.6, eris: 203830, haumea: 103410, makemake: 111845, moon: 27.321661, phobos: 0.31891, deimos: 1.26244, io: 1.769138,
  europa: 3.551181, ganymede: 7.154553, callisto: 16.689017, mimas: 0.942422, enceladus: 1.370218, tethys: 1.887802, dione: 2.736915, rhea: 4.5175,
  titan: 15.945421, hyperion: 21.276609, iapetus: 79.3215, miranda: 1.413479, ariel: 2.520379, umbriel: 4.144176, titania: 8.705867, oberon: 13.463234,
  triton: 5.876854, charon: 6.38723 };
const WIDE = { mercury: 0.01, venus: 0.01, earth: 0.01, mars: 0.01, jupiter: 0.01, // 안쪽 행성·목성은 0.01% 안(태양+행성계 질량을 쓴 효과가 0.05%라 이래야 가려진다)
  pluto: 1.0, makemake: 1.2, eris: 0.5, moon: 0.7, mimas: 0.8, enceladus: 0.45, tethys: 0.3 };
test('공전 주기: 관측된 항성 공전 주기와 맞는다', () => {
  const jd = julianDateTT(Date.UTC(2026, 10, 23));
  for (const [k, d] of Object.entries(OBS_DAYS)) {
    const got = orbitPeriodYears(orbitOf(k, jd)) * 365.25, pct = Math.abs(got / d - 1) * 100;
    assert.ok(pct < (WIDE[k] ?? 0.12), `${k} 주기 ${got}일 ↔ 관측 ${d}일 (${pct.toFixed(3)}%)`);
  }
});

test('주기 글자: 1년 이상 년 · 1년 미만 일 · 1일 미만 시간, 소수점 넷째', () => {
  assert.equal(periodText(1), '1.0000년');
  assert.equal(periodText(11.8618), '11.8618년');
  assert.equal(periodText(0.999), '364.8847일');
  assert.equal(periodText(87.969 / 365.25), '87.9690일');
  assert.equal(periodText(1 / 365.25), '1.0000일');
  assert.equal(periodText(0.99999 / 365.25), '23.9998시간');
  assert.equal(periodText(0.9999999 / 365.25), '1.0000일'); // 반올림하면 24시간 → 일
  assert.equal(periodText(0.99999999), '1.0000년'); // 반올림하면 365.25일 → 년
  assert.equal(periodText(0.31891 / 365.25), '7.6538시간');
});

// ---------- 거리 재기 카메라 ----------
test('거리 재기: 두 천체의 궤도를 함께 담을 중심과 바깥 궤도', () => {
  const jd = julianDateTT(Date.UTC(2026, 10, 28));
  assert.deepEqual(centerChain('moon'), ['moon', 'earth', 'sun']);
  assert.deepEqual(centerChain('sun'), ['sun']);
  const cases = [ // [A, B, 중심, 담는 궤도, 바깥(main)]
    ['earth', 'moon', 'earth', ['moon'], 'moon'], // 모행성-제 위성: 위성 궤도
    ['moon', 'earth', 'earth', ['moon'], 'moon'],
    ['sun', 'moon', 'sun', ['earth'], 'earth'], // 태양-위성: 모행성 궤도
    ['sun', 'earth', 'sun', ['earth'], 'earth'],
    ['mars', 'jupiter', 'sun', ['mars', 'jupiter'], 'jupiter'], // 행성-행성: 바깥 행성
    ['jupiter', 'mars', 'sun', ['jupiter', 'mars'], 'jupiter'],
    ['io', 'europa', 'jupiter', ['io', 'europa'], 'europa'], // 같은 모행성의 위성끼리: 바깥 위성
    ['io', 'titan', 'sun', ['jupiter', 'saturn'], 'saturn'], // 다른 모행성의 위성끼리: 바깥 모행성
    ['earth', 'io', 'sun', ['earth', 'jupiter'], 'jupiter'],
    ['pluto', 'charon', 'pluto', ['charon'], 'charon'],
    ['halley', 'neptune', 'sun', ['halley', 'neptune'], 'halley'], // 원일점 35AU > 해왕성 30AU
  ];
  for (const [a, b, c, ks, main] of cases) {
    const p = pairOrbits(a, b, jd);
    assert.equal(p.center, c, `${a}-${b} 중심`);
    assert.deepEqual(p.orbits.map(o => o.key), ks, `${a}-${b} 궤도`);
    assert.equal(p.main.key, main, `${a}-${b} 바깥`);
    for (const o of p.orbits) assert.equal(o.center, c);
  }
  assert.equal(pairOrbits('mars', 'mars', jd), null);
});

test('거리 재기: 궤도 하나면 궤도 보기와 같은 카메라', () => {
  const jd = julianDateTT(Date.UTC(2026, 10, 28)), box = { l: 380, t: 60, r: 1500, b: 900 }, cx = 900, cy = 480, f = 1100;
  for (const k of ['earth', 'moon', 'halley', 'titan']) {
    const o = orbitOf(k, jd), v = orbitView(o), fit = orbitFit(o, box, cx, cy, f), m = orbitMarks(o);
    const q = orbitsFit([o], o, box, cx, cy, f);
    assert.ok(rel(q.d, fit.d) < 1e-4, `${k} d ${q.d} ${fit.d}`);
    assert.deepEqual(q.dir, v.dir); assert.deepEqual(q.up, v.up);
    // 궤도 보기의 바라보는 점: 타원 중심 − right·dx·d/f + up·dy·d/f
    const t = [0, 1, 2].map(i => m.center[i] - v.right[i] * fit.dx * fit.d / f + v.up[i] * fit.dy * fit.d / f);
    assert.ok(len(sub(q.target, t)) < 1e-4 * o.a, `${k} target`);
  }
});

test('거리 재기: 두 궤도의 모든 점이 영역 안에, 한 변에는 닿는다(원근 포함)', () => {
  const jd = julianDateTT(Date.UTC(2026, 10, 28)), box = { l: 8, t: 300, r: 400, b: 840 }, cx = 204, cy = 420, f = 800, pad = 28;
  for (const [a, b] of [['halley', 'neptune'], ['swifttuttle', 'neptune'], ['io', 'titan'], ['earth', 'moon'], ['io', 'europa'], ['pluto', 'eris'], ['sun', 'halebopp']]) {
    const p = pairOrbits(a, b, jd), q = orbitsFit(p.orbits, p.main, box, cx, cy, f, pad);
    // 황도 북쪽 편에서 main 궤도면에 수직으로
    assert.ok(q.dir[2] >= 0 && Math.abs(Math.abs(dot(q.dir, p.main.W)) - 1) < 1e-12, `${a}-${b} 방향`);
    let edge = Infinity;
    for (const o of p.orbits) for (let k = 0; k < 720; k++) {
      const r = sub(ellipsePoint(o, (2 * Math.PI * k) / 720), q.target);
      const z = dot(r, q.dir), sx = cx + (f * dot(r, q.right)) / (q.d - z), sy = cy - (f * dot(r, q.up)) / (q.d - z);
      assert.ok(z < q.d, `${a}-${b} 카메라 뒤`);
      const m = Math.min(sx - (box.l + pad), box.r - pad - sx, sy - (box.t + pad), box.b - pad - sy);
      assert.ok(m > -0.5, `${a}-${b} ${o.key} 밖으로 ${-m}px`);
      edge = Math.min(edge, m);
    }
    assert.ok(edge < 2, `${a}-${b} 여유가 남음 ${edge}px`);
  }
});

test('거리 재기: 궤도면 밖으로 나온 가장자리 점은 원근만큼 더 물러난다(가상 궤도)', () => {
  // main: xy 평면의 반지름 1 원 · 다른 궤도: y축으로 50° 기울인 반지름 1.3 원 — x 끝점이 카메라 쪽(z>0)에 있다
  const c = Math.cos(50 * D), s = Math.sin(50 * D);
  const main = { a: 1, e: 0, b: 1, P: [1, 0, 0], Q: [0, 1, 0], W: [0, 0, 1] };
  const tilt = { a: 1.3, e: 0, b: 1.3, P: [-c, 0, s], Q: [0, -1, 0], W: [s, 0, c] };
  const box = { l: 0, t: 0, r: 400, b: 1000 }, cx = 200, cy = 500, f = 800, pad = 0;
  const q = orbitsFit([main, tilt], main, box, cx, cy, f, pad);
  let worst = Infinity;
  for (const o of [main, tilt]) for (let k = 0; k < 720; k++) {
    const r = sub(ellipsePoint(o, (2 * Math.PI * k) / 720), q.target);
    const z = dot(r, q.dir), sx = cx + (f * dot(r, q.right)) / (q.d - z);
    worst = Math.min(worst, sx - box.l, box.r - sx);
  }
  assert.ok(worst > -0.5 && worst < 2, `가로 여유 ${worst}px`);
});
