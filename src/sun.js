// 태양 가장자리 어두워짐(주연감광) — 순수 함수와 같은 식의 GLSL 문자열(tests/sun.test.mjs가 둘을 대조한다).
// I(μ)/I(1) = a0 + a1·μ + a2·μ², a0 = 1 − a1 − a2. μ = 그 자리 법선과 시선의 코사인(원판 가운데 1, 가장자리 0).
// 계수: Cox (ed.) 2000, Allen's Astrophysical Quantities 4th ed., 550nm — a1 = 0.93, a2 = −0.23(가장자리 30%, 원판 평균 80.5%).
// 한 파장 값을 세 색에 같이 쓴다(가장자리가 붉어지는 것은 없음). 색별 값은 Neckel & Labs 1994(Sol. Phys. 153, 91)를 받으면 바꾼다.
export const LIMB = { a1: 0.93, a2: -0.23 };
export const LIMB_A0 = 1 - LIMB.a1 - LIMB.a2;

export function limbDarkening(mu) {
  const m = Math.min(Math.max(mu, 0), 1);
  return LIMB_A0 + LIMB.a1 * m + LIMB.a2 * m * m;
}
const f = x => (Number.isInteger(x) ? x.toFixed(1) : String(+x.toFixed(6)));
export const LIMB_GLSL = `
float limbDarkening(float mu) {
  float m = min(max(mu, 0.0), 1.0);
  return ${f(LIMB_A0)} + ${f(LIMB.a1)} * m + ${f(LIMB.a2)} * m * m;
}
`;
