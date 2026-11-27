// 목성형 고리(src/jovian_rings.js) — 단면이 등가 깊이를 지키는가, 애덤스 호 자리·방향, GLSL 대조
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RING_SETS, buildProfile, dustMipLevels, adamsArcLon, adamsArcTau, localPhiOfLon, ADAMS_ARC_GLSL, ADAMS_ARCS, URANUS_RINGS, NEPTUNE_RINGS } from '../src/jovian_rings.js';
import { bodyAxes, rotationAngles } from '../src/ephemeris.js';
import { glslToJs } from './glsl_to_js.mjs';

test('단면: 고리마다 등가 깊이(τ × 폭)를 지킨다 — 칸보다 좁은 고리 포함, 먼지 몫은 τ 가중', () => {
  for (const [key, sets] of Object.entries(RING_SETS)) for (const s of sets) {
    const p = buildProfile(s.rings, s.r0, s.r1, s.n), dr = (s.r1 - s.r0) / s.n;
    let ed = 0, edDust = 0;
    for (let k = 0; k < p.n; k++) { ed += p.tau[k] * dr; edDust += p.tau[k] * p.dust[k] * dr; }
    const want = s.rings.reduce((a, g) => a + g.tau * (g.w ?? g.r1 - g.r0), 0);
    const wantDust = s.rings.reduce((a, g) => a + g.fd * g.tau * (g.w ?? g.r1 - g.r0), 0);
    assert.ok(Math.abs(ed / want - 1) < 1e-4, `${key} ${ed} / ${want}`);
    assert.ok(Math.abs(edDust / wantDust - 1) < 1e-4, `${key} 먼지 ${edDust} / ${wantDust}`);
    for (const g of s.rings) { // 고리가 단면 범위 안에 다 든다
      assert.ok((g.r0 ?? g.r - g.w / 2) >= s.r0 && (g.r1 ?? g.r + g.w / 2) <= s.r1, `${key} ${g.name}`);
    }
  }
  // 천왕성 고리 표가 두 단면에 빠짐없이 한 번씩
  const names = RING_SETS.uranus.flatMap(s => s.rings.map(g => g.name)).sort();
  assert.deepEqual(names, URANUS_RINGS.map(g => g.name).sort());
});

test('단면 칸 수는 2의 거듭제곱 — 아니면 손으로 넣은 밉맵 폭이 WebGL 요구(내림)와 어긋나 고리가 안 보인다', () => {
  for (const [key, sets] of Object.entries(RING_SETS)) for (const s of sets) assert.equal(s.n & (s.n - 1), 0, `${key} n=${s.n}`);
});

test('단면: ε고리 자리에 τ가 있고 바로 옆 틈은 0 — 반지름이 밀리지 않았다', () => {
  const s = RING_SETS.uranus[0], p = buildProfile(s.rings, s.r0, s.r1, s.n), dr = (s.r1 - s.r0) / s.n;
  const at = r => p.tau[Math.floor((r - s.r0) / dr)];
  assert.ok(at(51149) > 0.6, `${at(51149)}`);
  assert.equal(at(51149 + 40), 0);
  assert.equal(at(51149 - 40), 0);
  assert.ok(at(47176) > 0.3); // 에타
});

test('먼지 몫 밉맵: τ 가중 평균 — 큰 알갱이 τ 1 옆 먼지 τ 0.01이면 약 0.01', () => {
  const L = dustMipLevels([1, 0.01], [0, 1]);
  assert.ok(Math.abs(L[1][0] - 0.01 / 1.01) < 1e-6);
  assert.equal(L.at(-1).length, 1);
});

test('애덤스 호: 프라테르니테 가운데 τ 0.1, 쿠라주 0.05, 호 사이(18°)와 뒤쪽(−10°)은 0', () => {
  assert.equal(adamsArcTau(0), 0.1);
  assert.equal(adamsArcTau(32.3), 0.05);
  assert.equal(adamsArcTau(18), 0);
  assert.equal(adamsArcTau(-10), 0);
  assert.equal(adamsArcTau(10.7), 0.1);
  assert.equal(adamsArcTau(25), 0.1);
  assert.ok(adamsArcTau(5) > 0 && adamsArcTau(5) < 0.1); // 끝은 서서히
  assert.equal(adamsArcTau(360), 0.1); // 접기
  // 앞쪽(공전 방향, +)에 리베르테·쿠라주 — 호는 프라테르니테 앞으로만 펼쳐진다
  for (const a of ADAMS_ARCS) assert.ok(a.dl >= 0);
});

test('애덤스 호 GLSL이 JS와 같다', () => {
  const G = glslToJs(ADAMS_ARC_GLSL);
  for (let i = 0; i <= 7200; i++) {
    const dl = -180 + i / 20;
    assert.ok(Math.abs(G.adamsArcTau(dl) - adamsArcTau(dl)) < 1e-9, `${dl}`);
  }
});

test('애덤스 호 경도: 1989-08-18 12h에 251.88°, 하루에 820.11178° 앞으로', () => {
  assert.ok(Math.abs(adamsArcLon(2447757.0) - 251.88) < 1e-9);
  assert.ok(Math.abs(adamsArcLon(2447758.0) - ((251.88 + 820.11178) % 360)) < 1e-6);
  // Souami et al. 2022: 기준 영상 시각 MJD 57623.23185137(UT, 지구에서 받은 때 — 표 1)에 217.43 ± 0.30°. 논문이 평균 운동을 Voyager 값과
  // 이것으로 맞췄으니 되살아나야 한다. 해왕성에서의 시각 = 받은 때 − 빛 시간(지구 거리 28.959AU, 같은 표). 빛 시간을 안 빼면 354.9°
  const jd = 2400000.5 + 57623.23185137 - 28.959 * 499.004784 / 86400;
  const L = adamsArcLon(jd);
  assert.ok(Math.abs(L - 217.43) < 0.5, `${L}`);
});

test('로컬 각: 경도 0°는 해왕성 적도의 J2000 오름 교점, 경도가 커지면 북쪽으로(공전 방향)', () => {
  const OB = 23.4392911 * Math.PI / 180;
  const zEq = v => Math.sin(OB) * v[1] + Math.cos(OB) * v[2]; // 황도 → 적도 z
  for (const jd of [2447757.0, 2451545.0, 2460000.5]) {
    const { prime, east, pole } = bodyAxes('neptune', jd);
    const W = rotationAngles('neptune', jd).W;
    // 로컬 (cos φ, 0, sin φ) → 황도: +X = prime, +Z = −east
    const dir = L => { const p = localPhiOfLon(W, L); return prime.map((x, i) => x * Math.cos(p) - east[i] * Math.sin(p)); };
    const d0 = dir(0), d90 = dir(90);
    assert.ok(Math.abs(zEq(d0)) < 1e-9, `오름 교점 z ${zEq(d0)}`);
    assert.ok(zEq(d90) > 0.1, `경도 90°는 적도 북쪽 ${zEq(d90)}`);
    // d0 × d90 = 북극(공전 방향이 북극 둘레 반시계)
    const c = [d0[1] * d90[2] - d0[2] * d90[1], d0[2] * d90[0] - d0[0] * d90[2], d0[0] * d90[1] - d0[1] * d90[0]];
    assert.ok(c[0] * pole[0] + c[1] * pole[1] + c[2] * pole[2] > 0.999);
  }
});

test('해왕성 고리 표: 애덤스·르베리에 자리(Porco et al. 1995)', () => {
  const by = Object.fromEntries(NEPTUNE_RINGS.map(g => [g.name, g]));
  assert.equal(by['애덤스'].r, 62933);
  assert.equal(by['르베리에'].r, 53200);
});
