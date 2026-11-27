// 토성 고리 셰이더의 식(GLSL) — src/rings.js 식을 GLSL로 쓴 것. three.js 없이 문자열만 내보낸다.
// tests/rings_glsl.test.mjs가 이 문자열의 함수를 JS로 옮겨 rings.js와 같은 값을 내는지 대조한다(식을 고치면 둘 다).
// 대조할 수 있게 지킬 것: 함수는 스칼라 연산·vec2/vec3 생성자·dot·length·.x/.y/.z만 쓴다(벡터 사칙연산·여러 글자 스위즐 금지 —
// tests/glsl_to_js.mjs가 이런 것을 만나면 멈춘다). 단면 τ를 읽는 ringTau(텍스처)만 main.js에 남는다 —
// uv = (r − r0)/(r1 − r0)를 LinearFilter로 읽으면 rings.js ringTau의 칸 보간(n·x − 0.5)과 같다.
// 좌표는 토성 로컬(km): 고리면 법선 = +Y.

import { RING_EDGES, RING_ALBEDO, RING_SLANT_MU } from './rings.js';

// 고리 한 점의 비침 T와 밝기 F(rings.js ringLight·ringLight3) — vec2(T, F)
export const RING_LIGHT_GLSL = /* glsl */`
  vec2 ringLight3(float tauV, float tauS, float tauH, float mu, float mu0, bool sameSide) {
    mu = max(1e-3, abs(mu));
    mu0 = max(1e-3, abs(mu0));
    float T = exp(-tauV / mu);
    float F;
    if (sameSide) F = 2.0 * mu0 / (mu + mu0) * (1.0 - exp(-tauH * (1.0 / mu + 1.0 / mu0)));
    else if (abs(mu - mu0) < 1e-4) F = 2.0 * tauV / mu * T;
    else F = 2.0 * mu0 / (mu - mu0) * (T - exp(-tauS / mu0));
    return vec2(T, F);
  }

  vec2 ringLight(float tau, float mu, float mu0, bool sameSide) {
    return ringLight3(tau, tau, tau, mu, mu0, sameSide);
  }

  // 보는 방향 v·해 방향 s로 본 고리 한 점(rings.js ringView, 법선 +Y)
  vec2 ringView(float tau, vec3 v, vec3 s) {
    return ringLight(tau, v.y, s.y, v.y * s.y > 0.0);
  }

  // 점 p에서 해 쪽(s)으로 간 빛줄기가 회전 타원체(적도 R, 극 Rp, 극축 = y)에 막히는가(rings.js inPlanetShadow)
  bool inPlanetShadow(vec3 p, vec3 s, float R, float Rp) {
    float k = R / Rp;
    vec3 P = vec3(p.x, p.y * k, p.z);
    vec3 S = vec3(s.x, s.y * k, s.z);
    float a = dot(S, S);
    float b = dot(P, S);
    if (b > 0.0) return false;
    float c = dot(P, P) - R * R;
    return b * b - a * c > 0.0;
  }`;

// 표면 점 p에서 해 쪽(s)으로 간 빛줄기가 고리면(y = 0)을 지나는 반지름, 닿지 않으면 −1(rings.js ringShadowRadius, 법선 +Y)
export const RING_SHADOW_GLSL = /* glsl */`
  float ringShadowRadius(vec3 p, vec3 s) {
    if (abs(s.y) < 1e-6) return -1.0;
    float t = -p.y / s.y;
    if (t <= 0.0) return -1.0;
    return length(vec3(p.x + s.x * t, p.y + s.y * t, p.z + s.z * t));
  }

  // 고리 그림자 속 햇빛의 몫(rings.js ringShadowT, sn = s.y)
  float ringShadowT(float tau, float sn) {
    return exp(-tau / abs(sn));
  }`;

// 고리별 반사율·색 — rings.js RING_EDGES·RING_ALBEDO에서 만든다. toLinear: sRGB 색 → 선형 [r, g, b]
export function ringAlbedoGLSL(toLinear) {
  const v = i => [...toLinear(RING_ALBEDO[i].tint), RING_ALBEDO[i].w].map(x => x.toFixed(4)).join(', ');
  const e = k => RING_EDGES[k].toFixed(1);
  return /* glsl */`
  vec4 ringAlbedo(float r) {
    return r < ${e('cb')} ? vec4(${v(0)})
         : r < ${e('bOut')} ? vec4(${v(1)})
         : r < ${e('aIn')} ? vec4(${v(2)}) : vec4(${v(3)});
  }`;
}

// 기울기별 τ_eff(rings.js ringSlantLevels — 텍스처 두 장의 RGBA = 기울기 8개)에서 기울기 mu의 τ_eff(rings.js ringSlantTau)와
// (이름은 다른 함수와 겹치지 않게 — glslToJs는 벡터 이름을 문자열 전체에서 기억한다) 그것으로 본 고리 한 점(보는 길·햇빛 길·왕복 길을 따로). 판처럼 검어지지 않게 — rings.js RING_SLANT_MU 설명
const S = RING_SLANT_MU.map(m => (1 / m).toFixed(4));
const ch = ['ta.x', 'ta.y', 'ta.z', 'ta.w', 'tb.x', 'tb.y', 'tb.z', 'tb.w'];
export const RING_SLANT_GLSL = /* glsl */`
  float slantSeg(float t0, float t1, float s0, float s1, float w) {
    float f = (w - s0) / (s1 - s0);
    return (t0 * s0 * (1.0 - f) + t1 * s1 * f) / w;
  }

  float ringSlantTau(vec4 ta, vec4 tb, float mu) {
    float w = 1.0 / min(1.0, max(1e-3, abs(mu)));
${S.slice(1, -1).map((_, j) => `    if (w <= ${S[j + 1]}) return slantSeg(${ch[j]}, ${ch[j + 1]}, ${S[j]}, ${S[j + 1]}, w);`).join(String.fromCharCode(10))}
    return slantSeg(${ch[6]}, ${ch[7]}, ${S[6]}, ${S[7]}, w);
  }

  vec2 ringViewSlant(vec4 ta, vec4 tb, vec3 v, vec3 s) {
    float mu = max(1e-3, abs(v.y));
    float mu0 = max(1e-3, abs(s.y));
    float tauV = ringSlantTau(ta, tb, mu);
    float tauS = ringSlantTau(ta, tb, mu0);
    float tauH = ringSlantTau(ta, tb, 1.0 / (1.0 / mu + 1.0 / mu0));
    return ringLight3(tauV, tauS, tauH, v.y, s.y, v.y * s.y > 0.0);
  }`;
