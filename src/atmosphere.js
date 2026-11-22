// 지구 밤 불빛·대기 가장자리 빛 — 순수 함수와 같은 식의 GLSL 문자열(tests/atmosphere.test.mjs가 둘을 대조한다).
// GLSL은 tests/glsl_to_js.mjs가 옮길 수 있는 문법만 쓴다(스칼라 연산 · max·min·sqrt·exp — clamp·pow·smoothstep 없음).
import { heliocentric, bodyAxes } from './ephemeris.js';

const DEG = Math.PI / 180;

// ---------- 밤 불빛 ----------
// 태양이 지평선 아래로 내려가면서 켜져 TWILIGHT_DEG 아래(항해 박명 끝)에서 다 켜진다.
// mu = 그 자리 법선(측지 — 타원체 면의 법선)과 태양 방향의 코사인 = sin(태양 고도). 대기 굴절은 넣지 않는다.
export const TWILIGHT_DEG = 12;
const TW = Math.sin(TWILIGHT_DEG * DEG);
const smooth = t => t * t * (3 - 2 * t);
export function nightWeight(mu) {
  return smooth(Math.min(Math.max(-mu / TW, 0), 1));
}
const f = x => (Number.isInteger(x) ? x.toFixed(1) : String(x)); // GLSL 실수 글자
export const NIGHT_GLSL = `
float nightWeight(float mu) {
  float t = min(max(-mu / ${f(TW)}, 0.0), 1.0);
  return t * t * (3.0 - 2.0 * t);
}
`;

// 측지 동경·위도(°)의 법선이 태양 방향과 이루는 코사인(jd: TT). 지구 중심에서 본 태양 방향 = −(태양 중심 지구 위치).
// 화면 셰이더는 같은 값을 몸체의 법선과 태양 위치로 낸다 — 이 함수는 그 자세·방향이 맞는지 테스트하는 데 쓴다.
export function sunMu(key, jd, lonE, latDeg) {
  const { pole, prime, east } = bodyAxes(key, jd);
  const lo = lonE * DEG, la = latDeg * DEG;
  const n = [0, 1, 2].map(i => Math.cos(la) * (Math.cos(lo) * prime[i] + Math.sin(lo) * east[i]) + Math.sin(la) * pole[i]);
  const s = heliocentric(key, jd).map(v => -v);
  return (n[0] * s[0] + n[1] * s[1] + n[2] * s[2]) / Math.hypot(...s);
}

// ---------- 대기 가장자리 빛 ----------
// 몸체보다 조금 큰 껍질(반지름비 k = 껍질/몸체)을 그리고, 껍질의 각 점에서 시선이 몸체 중심을 지나치는 거리 b(몸체 반지름 단위)로 밝기를 낸다.
//   b > 1(몸체 밖, 하늘에 걸친 띠): 몸체 가장자리에서 가장 밝고 바깥으로 지수로 옅어진다(껍질 끝에서 0).
//   b < 1(몸체 원판 위): 가장자리로 갈수록 대기를 비스듬히 지나 밝아진다 — 원판 법선·시선 코사인 mp에 대해 e^(−RIM_IN·mp)를
//   가운데 0·가장자리 1로 맞춘 값이라 가장자리 몇 %에만 걸린다. b=1에서 바깥 띠와 이어진다.
// muView = 껍질 법선·시선 코사인(0~1), muSun = 껍질 법선·태양 방향 코사인. 낮 쪽만 밝고 밤 쪽 가장자리는 어둡다(정적 표현).
export const RIM_FALLOFF = 4; // 껍질 두께 안에서 옅어지는 정도(e^−4 ≈ 2%까지)
export const RIM_IN = 8; // 원판 위로 번지는 폭(클수록 가장자리에 붙는다)
export const RIM_DAY = [-0.2, 0.3]; // muSun이 이 사이에서 어둠 → 낮으로(가장자리 빛이 밤 쪽으로 조금 넘어간다)
export function rimGlow(muView, muSun, k) {
  const b = Math.sqrt(Math.max(1 - muView * muView, 0)) * k;
  let g;
  if (b >= 1) {
    const h = Math.min((b - 1) / (k - 1), 1);
    g = Math.exp(-RIM_FALLOFF * h) * (1 - h);
  } else {
    g = (Math.exp(-RIM_IN * Math.sqrt(1 - b * b)) - Math.exp(-RIM_IN)) / (1 - Math.exp(-RIM_IN)); // 원판 가운데 0 → 가장자리 1
  }
  const d = smooth(Math.min(Math.max((muSun - RIM_DAY[0]) / (RIM_DAY[1] - RIM_DAY[0]), 0), 1));
  return g * d;
}
export const RIM_GLSL = `
float rimGlow(float muView, float muSun, float k) {
  float b = sqrt(max(1.0 - muView * muView, 0.0)) * k;
  float g = 0.0;
  if (b >= 1.0) {
    float h = min((b - 1.0) / (k - 1.0), 1.0);
    g = exp(-${f(RIM_FALLOFF)} * h) * (1.0 - h);
  } else {
    g = (exp(-${f(RIM_IN)} * sqrt(1.0 - b * b)) - ${f(Math.exp(-RIM_IN))}) / ${f(1 - Math.exp(-RIM_IN))};
  }
  float t = min(max((muSun - ${f(RIM_DAY[0])}) / ${f(RIM_DAY[1] - RIM_DAY[0])}, 0.0), 1.0);
  return g * t * t * (3.0 - 2.0 * t);
}
`;
