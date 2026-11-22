// 태양 렌즈 효과 — src/flare.js
// 정답이 정해진 것: 유령은 광학 중심–태양 직선 위(k<0은 반대편) · 카메라 뒤면 없음 · 가려지면 없음 ·
// 사원수 역회전 방향 · 세기는 멀수록 약해지고 태양 속·원반이 화면을 채우면 0 ·
// 후광은 원반을 따라 커지고 원반이 화면을 채워도 남음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toScreen, ghosts, GHOSTS, BLOOM, bloomScales, bloomAt, sunRadiusPx, visibleFraction, unrotate, exposure, flareStrength, offscreenFade, flareGain, bloomGain, BLOOM_NEAR_MIN } from '../src/flare.js';
import { AU_KM } from '../src/ephemeris.js';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≠ ${b} (±${eps})`);
const SUN_R = 695700;

// three.js PerspectiveCamera와 같은 투영 행렬(열 우선). 화각 45°, 가로세로비 a
function persp(fovY, a, n = 1, f = 1e12) {
  const t = 1 / Math.tan(fovY * Math.PI / 360);
  return [t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, -(f + n) / (f - n), -1, 0, 0, -2 * f * n / (f - n), 0];
}

test('화면 위치: 광축 위의 점은 화면 가운데, 위쪽 점은 위(y 작음), 오른쪽 점은 오른쪽', () => {
  const P = persp(45, 1.6), W = 1600, H = 1000;
  const c = toScreen([0, 0, -10], P, W, H);
  close(c[0], 800, 1e-9); close(c[1], 500, 1e-9);
  const up = toScreen([0, 1, -10], P, W, H), right = toScreen([1, 0, -10], P, W, H);
  assert.ok(up[1] < 500, '위쪽 점이 화면 위로');
  assert.ok(right[0] > 800, '오른쪽 점이 화면 오른쪽으로');
  // 화면 밖(화각 밖)이어도 좌표를 낸다
  const out = toScreen([100, 0, -10], P, W, H);
  assert.ok(out && out[0] > W);
});

test('화면 위치: 카메라 뒤(z ≥ 0)이면 없음, 세기 0', () => {
  const P = persp(45, 1.6);
  assert.equal(toScreen([0, 0, 10], P, 1600, 1000), null);
  assert.equal(toScreen([0, 0, 0], P, 1600, 1000), null);
  assert.equal(flareGain(null, 1600, 1000, AU_KM, SUN_R, 45, 1), 0);
});

test('유령: 모두 광학 중심–태양 직선 위, k>0은 태양 쪽, k<0은 반대편', () => {
  const c = [800, 500], p = [1300, 200], H = 1000;
  const g = ghosts(p, c, H);
  assert.equal(g.length, GHOSTS.length);
  assert.ok(GHOSTS.some(x => x.k < 0) && GHOSTS.some(x => x.k > 0));
  const d = [p[0] - c[0], p[1] - c[1]];
  g.forEach((x, i) => {
    const v = [x.x - c[0], x.y - c[1]];
    close(v[0] * d[1] - v[1] * d[0], 0, 1e-6, '직선 위(외적 0)');
    const s = v[0] * d[0] + v[1] * d[1];
    assert.ok(Math.sign(s) === Math.sign(GHOSTS[i].k), `유령 ${i}: k=${GHOSTS[i].k}인데 ${s > 0 ? '태양 쪽' : '반대편'}`);
    close(Math.hypot(...v), Math.abs(GHOSTS[i].k) * Math.hypot(...d), 1e-6, '거리 = |k|·|태양−중심|');
  });
});

test('유령: 태양이 가운데에서 멀어질수록 흐려진다', () => {
  const c = [800, 500], H = 1000;
  const a0 = ghosts([800, 500], c, H)[0].a, a1 = ghosts([1300, 500], c, H)[0].a, a2 = ghosts([2300, 500], c, H)[0].a;
  close(a0, GHOSTS[0].a, 1e-12);
  assert.ok(a0 > a1 && a1 > a2);
});

test('사원수 역회전: z축 +90° 회전은 몸체 x축을 장면 y축으로 보내므로, 장면 y → 몸체 x', () => {
  const q = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  const v = unrotate([0, 1, 0], q);
  close(v[0], 1, 1e-12); close(v[1], 0, 1e-12); close(v[2], 0, 1e-12);
  assert.deepEqual(unrotate([1, 2, 3], null), [1, 2, 3]);
});

// 장면: 카메라 원점, 태양은 +x 쪽 1AU. 가리는 몸체는 카메라 앞 거리 D(지구 반지름).
const RE = 6378;
const cam = [0, 0, 0], sun = [AU_KM, 0, 0];
const sunAt = D => SUN_R * D / AU_KM; // 거리 D에서 태양 원반이 차지하는 반지름

test('가림: 막는 것 없으면 1, 지구가 통째로 가리면 0, 세기도 0', () => {
  assert.equal(visibleFraction(cam, sun, SUN_R, []), 1);
  const earth = { c: [20000, 0, 0], radii: [RE, RE, RE], q: null };
  assert.equal(visibleFraction(cam, sun, SUN_R, [earth]), 0);
  assert.equal(flareGain([800, 500], 1600, 1000, AU_KM, SUN_R, 45, 0), 0);
  // 태양 뒤에 있는 몸체는 가리지 않는다
  assert.equal(visibleFraction(cam, sun, SUN_R, [{ c: [2 * AU_KM, 0, 0], radii: [RE * 100, RE * 100, RE * 100], q: null }]), 1);
  // 카메라 뒤의 몸체도
  assert.equal(visibleFraction(cam, sun, SUN_R, [{ c: [-20000, 0, 0], radii: [RE, RE, RE], q: null }]), 1);
});

test('가림: 지구 가장자리 뒤에서 떠오르면 보이는 비율이 0에서 1로 늘어난다(반쯤 걸치면 약 절반)', () => {
  const D = 20000, s = sunAt(D);
  // 지구 중심을 −y로 내려 가장자리가 시선에 오게 한다: 가장자리 높이 h = 태양 중심 시선 기준 y
  const at = h => visibleFraction(cam, sun, SUN_R, [{ c: [D, -RE * 1.0 + h, 0], radii: [RE, RE, RE], q: null }]);
  // h = +2s: 가장자리가 태양보다 위 → 다 가림 / h = −2s: 아래 → 다 보임
  const hs = [2, 1, 0.5, 0, -0.5, -1, -2].map(k => k * s);
  const v = hs.map(at);
  assert.equal(v[0], 0); assert.equal(v[6], 1);
  for (let i = 1; i < v.length; i++) assert.ok(v[i] >= v[i - 1], `떠오를수록 늘어난다: ${v.map(x => x.toFixed(2))}`);
  close(v[3], 0.5, 0.12, '반쯤 걸침');
});

test('가림: 납작한 몸체는 회전에 따라 가리기도 하고 안 가리기도 한다', () => {
  // 몸체 y축 방향으로 얇은 원판(반지름 5000, 두께 50). 태양 중심 시선은 몸체 중심에서 장면 y로 2000 위를 지난다
  const D = 20000, flat = q => ({ c: [D, -2000, 0], radii: [5000, 50, 5000], q });
  assert.equal(visibleFraction(cam, sun, SUN_R, [flat(null)]), 1, '얇은 방향이 장면 y — 지나간다');
  const qz90 = [0, 0, Math.SQRT1_2, Math.SQRT1_2]; // z축 90° — 얇은 방향이 장면 −x(시선 방향)로, 넓은 면이 시선을 마주 본다
  assert.equal(visibleFraction(cam, sun, SUN_R, [flat(qz90)]), 0, '넓은 면이 시선을 막는다');
  const qx90 = [Math.SQRT1_2, 0, 0, Math.SQRT1_2]; // x축 90° — 얇은 방향이 장면 z로: 시선 둘레 ±93km 중 두께 ±50km 안만 막힌다
  const v = visibleFraction(cam, sun, SUN_R, [flat(qx90)]);
  assert.ok(v > 0.2 && v < 0.8, `일부만 막힌다 (${v})`);
});

test('세기: 1AU에서 1, 멀수록 약해지다 약 300AU 넘으면 0, 태양 속 0, 원반이 화면을 채우면 0', () => {
  close(flareStrength(AU_KM, SUN_R, 45), 1, 1e-12);
  const d = [1, 5.2, 30, 100, 400].map(k => flareStrength(k * AU_KM, SUN_R, 45));
  for (let i = 1; i < d.length; i++) assert.ok(d[i] < d[i - 1], d.join());
  assert.equal(d[4], 0);
  assert.ok(d[2] > 0.3, '해왕성 거리에서도 보인다');
  assert.equal(flareStrength(SUN_R * 0.5, SUN_R, 45), 0, '태양 속');
  assert.equal(flareStrength(SUN_R * 3, SUN_R, 45), 0, '원반이 화면 반높이의 0.3을 넘음');
  assert.ok(flareStrength(SUN_R * 30, SUN_R, 45) > 0.99, '원반이 작으면 그대로(수성 안쪽도 1에서 잘림)');
});

test('화면 밖 감쇠: 화면 안이면 1, 화면 높이 절반만큼 벗어나면 0', () => {
  assert.equal(offscreenFade([800, 500], 1600, 1000), 1);
  close(offscreenFade([1600 + 250, 500], 1600, 1000), 0.5, 1e-12);
  assert.equal(offscreenFade([-600, 500], 1600, 1000), 0);
});

test('원반 반지름(px): 1AU·화각 45°·높이 1000px이면 약 5.6px, 멀수록 작고 태양 속은 무한', () => {
  const a = Math.asin(SUN_R / AU_KM);
  close(sunRadiusPx(AU_KM, SUN_R, 45, 1000), 500 * Math.tan(a) / Math.tan(22.5 * Math.PI / 180), 1e-9);
  close(sunRadiusPx(AU_KM, SUN_R, 45, 1000), 5.62, 0.01);
  assert.ok(sunRadiusPx(5 * AU_KM, SUN_R, 45, 1000) < sunRadiusPx(AU_KM, SUN_R, 45, 1000));
  assert.equal(sunRadiusPx(SUN_R, SUN_R, 45, 1000), Infinity);
});

test('후광: 원반이 커지면 넓어지고, 점이어도 남으며, 가장자리에서 멀수록 어둡고 원반 안과 이어진다', () => {
  const H = 1000, s0 = bloomScales(0, H), s1 = bloomScales(100, H), s5 = bloomScales(5, H);
  // 원반 몫(a·rs)이 있으므로 원반이 크면 넓다
  s0.forEach((v, i) => { assert.ok(v > 0, '점이어도 번짐이 있다'); assert.ok(s1[i] > s5[i], '원반이 크면 넓다'); });
  for (let i = 1; i < s0.length; i++) assert.ok(s0[i] > s0[i - 1], '겹마다 넓어진다');
  const at = [0, 5, 20, 80, 300].map(e => bloomAt(e, 50, H));
  for (let i = 1; i < at.length; i++) assert.ok(at[i] < at[i - 1], at.join());
  close(bloomAt(-30, 50, H), bloomAt(0, 50, H), 1e-12, '원반 안 = 가장자리');
  close(bloomAt(0, 50, H), BLOOM.reduce((s, g) => s + g.k, 0), 1e-12);
  // 같은 거리 e라도 원반이 큰 쪽이 밝다(후광이 원반을 따라 커진다)
  assert.ok(bloomAt(60, 200, H) > bloomAt(60, 5, H));
});

test('후광 세기: 원반이 화면을 채워 렌즈 효과가 꺼져도 남고, 가려지거나 태양 속·카메라 뒤면 0', () => {
  const W = 1600, H = 1000, p = [800, 500];
  assert.equal(flareGain(p, W, H, SUN_R * 3, SUN_R, 45, 1), 0);
  assert.ok(bloomGain(p, W, H, SUN_R * 3, SUN_R, 1) > 0.99);
  assert.equal(bloomGain(p, W, H, SUN_R * 3, SUN_R, 0), 0);
  assert.equal(bloomGain(p, W, H, SUN_R * 0.5, SUN_R, 1), 0);
  assert.equal(bloomGain(null, W, H, AU_KM, SUN_R, 1), 0);
  close(bloomGain(p, W, H, 30 * AU_KM, SUN_R, 1), exposure(30 * AU_KM, SUN_R), 1e-12);
  assert.ok(exposure(30 * AU_KM, SUN_R) < exposure(AU_KM, SUN_R));
});

test('후광 세기: 원반이 커질수록 약해지되 꺼지지 않는다', () => {
  const W = 1600, H = 1000, p = [800, 500], d = SUN_R * 3;
  const g = [0, 40, 80, 120, 160, 250].map(rs => bloomGain(p, W, H, d, SUN_R, 1, rs));
  close(g[0], g[1], 1e-12, '작은 원반은 그대로');
  for (let i = 2; i < g.length; i++) assert.ok(g[i] < g[i - 1], g.join());
  close(g[5], BLOOM_NEAR_MIN * exposure(d, SUN_R), 1e-12, '큰 원반은 최솟값');
  assert.ok(g[5] > 0 && BLOOM_NEAR_MIN < 1);
});

test('화면 밖 감쇠: 원반이 크면 중심이 화면 밖이어도 가장자리가 안이면 1', () => {
  assert.equal(offscreenFade([1600 + 300, 500], 1600, 1000, 400), 1);
  assert.ok(offscreenFade([1600 + 300, 500], 1600, 1000, 0) < 1);
  close(offscreenFade([1600 + 650, 500], 1600, 1000, 400), 0.5, 1e-12);
});

// ---- 번짐·핵 크기 상한(2026-11-23 개정): 점이어도 5px 원반과 같은 몫, 멀수록 더 줄임 ----
import { glowShrink, GLOW_SHRINK_MIN, GLOW_DIST_MIN, coreSigma, CORE_SIGMA } from '../src/flare.js';
test('번짐 몫: 원반 크기와 무관하게 GLOW_SHRINK_MIN(점이라고 커지지 않는다), 1AU보다 멀면 줄고 하한이 있다', () => {
  for (const rs of [0, 0.05, 0.5, 2, 5, 50]) close(glowShrink(rs, 1000), GLOW_SHRINK_MIN, 1e-12, `rs=${rs}`);
  close(glowShrink(0, 1000, 0.5 * AU_KM), GLOW_SHRINK_MIN, 1e-12, '1AU 안쪽은 줄이지 않음');
  let prev = GLOW_SHRINK_MIN;
  for (const au of [2, 5, 10, 30, 100]) { const g = glowShrink(0, 1000, au * AU_KM); assert.ok(g < prev, `${au}AU: ${g}`); prev = g; }
  close(glowShrink(0, 1000, 1e6 * AU_KM), GLOW_SHRINK_MIN * GLOW_DIST_MIN, 1e-12, '하한');
  close(glowShrink(0, 1000, 30 * AU_KM), 0.3 * 30 ** -0.3, 1e-12, '30AU 값');
});
test('실제 크기 우선: 점(멀리)의 핵·번짐 폭이 1AU(원반 5px)보다 크지 않다', () => {
  const H = 1000;
  close(coreSigma(5, H), CORE_SIGMA * H * GLOW_SHRINK_MIN, 1e-9);
  const sAu = bloomScales(5, H);
  for (const au of [1, 5, 30, 100]) {
    const sFar = bloomScales(5 / au, H, au * AU_KM); // 원반 반지름은 거리에 반비례
    sFar.forEach((v, i) => assert.ok(v <= sAu[i] + 1e-9, `${au}AU 겹${i}: ${v} > ${sAu[i]}`));
    assert.ok(coreSigma(5 / au, H, au * AU_KM) <= coreSigma(5, H) + 1e-9);
  }
  assert.ok(bloomScales(0, H, 30 * AU_KM)[3] < 40, `30AU 바깥 폭 ${bloomScales(0, H, 30 * AU_KM)[3]}`);
  assert.ok(bloomScales(60, H)[3] > bloomScales(5, H)[3]); // 가까이 갈수록 후광은 원반 따라 커진다
});
