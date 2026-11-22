// 토성 고리 셰이더의 식(GLSL) — src/rings.js 식을 GLSL로 쓴 것. three.js 없이 문자열만 내보낸다.
// tests/rings_glsl.test.mjs가 이 문자열의 함수를 JS로 옮겨 rings.js와 같은 값을 내는지 대조한다(식을 고치면 둘 다).
// 대조할 수 있게 지킬 것: 함수는 스칼라 연산·vec2/vec3 생성자·dot·length·.x/.y/.z만 쓴다(벡터 사칙연산·여러 글자 스위즐 금지 —
// tests/glsl_to_js.mjs가 이런 것을 만나면 멈춘다). 단면 τ를 읽는 ringTau(텍스처)만 main.js에 남는다 —
// uv = (r − r0)/(r1 − r0)를 LinearFilter로 읽으면 rings.js ringTau의 칸 보간(n·x − 0.5)과 같다.
// 좌표는 토성 로컬(km): 고리면 법선 = +Y.

import { RING_EDGES, RING_ALBEDO } from './rings.js';

// 고리 한 점의 비침 T와 밝기 F(rings.js ringLight) — vec2(T, F)
export const RING_LIGHT_GLSL = /* glsl */`
  vec2 ringLight(float tau, float mu, float mu0, bool sameSide) {
    mu = max(1e-3, abs(mu));
    mu0 = max(1e-3, abs(mu0));
    float T = exp(-tau / mu);
    float F;
    if (sameSide) F = 2.0 * mu0 / (mu + mu0) * (1.0 - exp(-tau * (1.0 / mu + 1.0 / mu0)));
    else if (abs(mu - mu0) < 1e-4) F = 2.0 * tau / mu * T;
    else F = 2.0 * mu0 / (mu - mu0) * (T - exp(-tau / mu0));
    return vec2(T, F);
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
