// 왜행성(하우메아·마케마케·에리스) 겉모습 — 관측 반사율·색지수로 정한 색과 하우메아 고리. three.js 없는 순수 함수(tests/dwarfs.test.mjs).
// 셋 다 표면 지도가 없다(무늬가 관측되지 않았거나 위치가 정해지지 않음) — 한 가지 색으로 칠한다.

// 태양 색지수(Johnson B−V, Cousins V−R) — 소천체 색 논문에서 흔히 쓰는 근삿값
export const SUN_BV = 0.65, SUN_VR = 0.36;

// 관측값: pV 기하 반사율, bv·vr 색지수
//   하우메아 pV Ortiz et al. 2017(Nature 550, 219) · 색 A&A 2010 표(가중 평균 B−V 0.64, V−R 0.33) — 거의 태양색(결정질 물 얼음)
//   마케마케 pV Ortiz et al. 2012 · Brown 2013(반지름 출처와 같은 값) · 색 Hromakina et al. 2019(B−V 0.91, V−R 0.41)
//   에리스 pV Sicardy et al. 2011(Nature 478, 493) · 색 2012 색 모음(B−V 0.805, V−R 0.389, 64번 관측)
export const DWARF_PHOTOMETRY = {
  haumea:   { pV: 0.51, bv: 0.64,  vr: 0.33 },
  makemake: { pV: 0.77, bv: 0.91,  vr: 0.41 },
  eris:     { pV: 0.96, bv: 0.805, vr: 0.389 },
};

// 색지수 → 띠별 반사율(V를 pV로 둔다). 태양보다 B−V가 크면 B에서 덜 반사(붉다), V−R이 크면 R에서 더 반사.
//   R·G·B 채널 ≈ R·V·B 띠로 보는 근사. 선형 값(0~1)으로 돌려주고 1을 넘으면 1로 자른다.
export function reflectance({ pV, bv, vr }) {
  const b = pV * 10 ** (-0.4 * (bv - SUN_BV));
  const r = pV * 10 ** (0.4 * (vr - SUN_VR));
  return [r, pV, b].map(v => Math.min(1, v));
}

const toSRGB = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
// 선형 반사율 → 화면 색(sRGB 0xRRGGBB) — 재질 color는 sRGB 값으로 받는다(three.js가 선형으로 되돌린다)
export function srgbHex(lin) {
  return lin.map(c => Math.round(Math.max(0, Math.min(1, toSRGB(c))) * 255)).reduce((h, v) => h * 256 + v, 0);
}
export const dwarfColor = key => srgbHex(reflectance(DWARF_PHOTOMETRY[key]));

// ---------- 하우메아 고리 (Ortiz et al. 2017, 2017-01-21 별 엄폐) ----------
// 반지름 2,287km(+75/−45) · 폭 70km · 겉보기 불투명도 p′ 0.5 · 열림각 B 13.8° · 반사도 I/F 약 0.09(폭 70km일 때)
// 고리와 히이아카 궤도는 하우메아 적도면에 있다 → 고리 극 = 하우메아 자전축. 극(J2000 적도): RA 285.1°, Dec −10.6°(해 1, 저자가 고른 해)
export const HAUMEA_POLE = { ra: 285.1, dec: -10.6 };
export const HAUMEA_RING_OBS = { r: 2287, width: 70, opacity: 0.5, B: 13.8, IF: 0.09 };

// 겉보기 불투명도 → 수직 광학 깊이. 엄폐로 잰 τ는 회절 때문에 기하 τ의 2배다(Braga-Ribas et al. 2014 카리클로 고리와 같은 규약):
//   τ = −(sin B / 2)·ln(1 − p′)
export function ringTauFromOpacity(p, Bdeg) {
  return -Math.sin(Bdeg * Math.PI / 180) / 2 * Math.log(1 - p);
}

// 관측 I/F → 알갱이 반사율 w. 앱의 고리 빛 식(rings.js ringLight, 햇빛 받는 면)에서 μ = μ0 = sin B(지구에서 보면 위상각 ≈ 0)일 때
//   I/F = w · (1 − e^{−2τ/μ})  이므로  w = I/F / (1 − e^{−2τ/μ})
export function ringAlbedoFromIF(IF, tau, Bdeg) {
  const mu = Math.sin(Bdeg * Math.PI / 180);
  return IF / (1 - Math.exp(-2 * tau / mu));
}

const o = HAUMEA_RING_OBS;
export const HAUMEA_RING = (() => {
  const tau = ringTauFromOpacity(o.opacity, o.B);
  return { rIn: o.r - o.width / 2, rOut: o.r + o.width / 2, tau, albedo: ringAlbedoFromIF(o.IF, tau, o.B) };
})();
