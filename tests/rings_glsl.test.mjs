// 고리 셰이더 식(src/rings_glsl.js의 GLSL)이 src/rings.js와 같은 값을 내는가
// GLSL 함수를 문자열 그대로 JS로 옮겨(타입 지우기·vec 생성자·.x/.y/.z) 같은 입력으로 비교한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RING_LIGHT_GLSL, RING_SHADOW_GLSL, ringAlbedoGLSL } from '../src/rings_glsl.js';
import { glslToJs } from './glsl_to_js.mjs';
import { RING_EDGES, ringLight, inPlanetShadow, ringShadowRadius, ringAlbedo, ringShadowT, ringView } from '../src/rings.js';

const G = glslToJs(RING_LIGHT_GLSL + RING_SHADOW_GLSL + ringAlbedoGLSL(t => t));
const RE = 60268, RP = 54364;
// 같은 씨앗의 의사 난수 — 실패를 다시 낼 수 있게
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const close = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));

test('옮기기: GLSL 함수 6개가 다 나온다', () => {
  for (const k of ['ringLight', 'ringView', 'inPlanetShadow', 'ringShadowRadius', 'ringShadowT', 'ringAlbedo']) assert.equal(typeof G[k], 'function', k);
});

test('ringLight: 셰이더 식이 rings.js와 같다 — 앞·뒷면, 얇은·두꺼운 고리, 비스듬한 빛, μ≈μ0', () => {
  const cases = [];
  for (let i = 0; i < 3000; i++) {
    const tau = [0.01, 0.1, 0.5, 1.5, 4][i % 5] * (0.5 + rnd());
    const mu = (rnd() * 2 - 1), mu0 = i % 7 === 0 ? mu * (1 + 1e-5) : (rnd() * 2 - 1);
    cases.push([tau, mu, mu0, rnd() < 0.5]);
  }
  cases.push([0.8, 0.4, 0.4, false], [2, 0.0001, 0.3, true], [2, 0.3, -0.0002, false]);
  for (const [tau, mu, mu0, same] of cases) {
    const { T, F } = ringLight(tau, mu, mu0, same);
    const [t, f] = G.ringLight(tau, mu, mu0, same);
    assert.ok(close(T, t) && close(F, f, 1e-7), `τ=${tau} μ=${mu} μ0=${mu0} ${same}: JS ${T},${F} / GLSL ${t},${f}`);
  }
});

test('inPlanetShadow: 셰이더 식이 rings.js와 같다 — 고리면 점, 여러 해 방향, 회전 타원체', () => {
  let shadowed = 0;
  for (let i = 0; i < 5000; i++) {
    const r = RING_EDGES.cIn + rnd() * (RING_EDGES.aOut - RING_EDGES.cIn), th = rnd() * 2 * Math.PI;
    const p = [r * Math.cos(th), (rnd() - 0.5) * 2e4, r * Math.sin(th)];
    const el = (rnd() - 0.5) * 1.2, az = rnd() * 2 * Math.PI;
    const s = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
    const a = inPlanetShadow(p, s, RE, RP), b = G.inPlanetShadow(p, s, RE, RP);
    assert.equal(b, a, `p=${p} s=${s}`);
    shadowed += a;
  }
  assert.ok(shadowed > 200 && shadowed < 4800, `그림자 안 ${shadowed}개 — 양쪽이 다 시험되어야`);
});

test('ringShadowRadius: 셰이더 식이 rings.js(법선 +Y)와 같다 — 닿지 않으면 −1', () => {
  let misses = 0;
  for (let i = 0; i < 5000; i++) {
    const lat = (rnd() - 0.5) * Math.PI, lon = rnd() * 2 * Math.PI;
    const p = [RE * Math.cos(lat) * Math.cos(lon), RP * Math.sin(lat), RE * Math.cos(lat) * Math.sin(lon)];
    const el = (rnd() - 0.5) * 1.0, az = rnd() * 2 * Math.PI;
    const s = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
    const a = ringShadowRadius(p, s, [0, 1, 0]), b = G.ringShadowRadius(p, s);
    if (a === null) { misses++; assert.equal(b, -1, `p=${p} s=${s}`); }
    else assert.ok(close(a, b), `p=${p} s=${s}: JS ${a} / GLSL ${b}`);
  }
  assert.ok(misses > 500 && misses < 4500, `닿지 않음 ${misses}개`);
  // 해가 고리면과 거의 나란할 때(분점) — 두 쪽 모두 같은 문턱(|s·n| < 1e-6)에서 「닿지 않음」
  for (const sy of [5e-7, -5e-7, 2e-6, -2e-6]) {
    const p = [RE * 0.8, -RP * 0.3, 1000], s = [Math.sqrt(1 - sy * sy), sy, 0];
    const a = ringShadowRadius(p, s, [0, 1, 0]), b = G.ringShadowRadius(p, s);
    if (a === null) assert.equal(b, -1, `s.y=${sy}`); else assert.ok(close(a, b), `s.y=${sy}: JS ${a} / GLSL ${b}`);
  }
  assert.equal(ringShadowRadius([RE, -1000, 0], [1, 5e-7, 0], [0, 1, 0]), null);
});

test('ringAlbedo: 고리 경계 바로 위·아래·경계 위에서도 셰이더가 rings.js와 같은 반사율·색', () => {
  const rs = [];
  for (let r = RING_EDGES.cIn; r <= RING_EDGES.aOut; r += 37) rs.push(r);
  for (const k of ['cb', 'bOut', 'aIn']) rs.push(RING_EDGES[k] - 0.5, RING_EDGES[k], RING_EDGES[k] + 0.5);
  for (const r of rs) {
    const { w, tint } = ringAlbedo(r), g = G.ringAlbedo(r);
    assert.deepEqual(g.map(x => +x.toFixed(4)), [...tint, w].map(x => +x.toFixed(4)), `r=${r}`);
  }
});

test('ringView: 보는 방향·해 방향에서 앞·뒷면을 가르는 것이 rings.js와 같다', () => {
  let same = 0;
  for (let i = 0; i < 3000; i++) {
    const tau = 0.05 + rnd() * 3;
    const unit = () => { const el = (rnd() - 0.5) * Math.PI, az = rnd() * 2 * Math.PI; return [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)]; };
    const v = unit(), s = unit();
    const { T, F } = ringView(tau, v, s), [t, f] = G.ringView(tau, v, s);
    assert.ok(close(T, t) && close(F, f, 1e-7), `v=${v} s=${s}: JS ${T},${F} / GLSL ${t},${f}`);
    same += v[1] * s[1] > 0;
  }
  assert.ok(same > 1000 && same < 2000, `같은 면 ${same}개`);
});

test('ringShadowT: 고리 그림자 속 햇빛의 몫이 rings.js와 같다 — 해 고도 부호와 상관없이', () => {
  for (let i = 0; i < 2000; i++) {
    const tau = rnd() * 4, sn = (rnd() - 0.5) * 2;
    if (Math.abs(sn) < 1e-6) continue;
    assert.ok(close(ringShadowT(tau, sn), G.ringShadowT(tau, sn)), `τ=${tau} sn=${sn}`);
  }
  assert.ok(Math.abs(ringShadowT(1, -0.5) - Math.exp(-2)) < 1e-12);
});

test('옮기기 도구: 대조할 수 없는 GLSL은 조용히 넘기지 않고 멈춘다', () => {
  assert.throws(() => glslToJs('float f(vec3 p) { return length(p.xz); }'), /스위즐|문법/);
  assert.throws(() => glslToJs('float f(vec3 p, vec3 s) { vec3 q = p - s; return q.x; }'), /벡터 사칙연산/);
  assert.throws(() => glslToJs('float f(vec3 p) { return length(p * 2.0); }'), /벡터 사칙연산/);
  assert.throws(() => glslToJs('float f(float r) { return texture2D(t, vec2(r, 0.5)).r; }'), /문법/);
  assert.equal(glslToJs('float f(vec3 p) { return -p.y * 2.0 + p.x; }').f([3, 4, 5]), -5);
});
