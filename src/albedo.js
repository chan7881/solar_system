// 천체 사이의 밝기 — 실제 기하 반사율(pV) 비로 맞춘다. three.js 없는 순수 함수(tests/albedo.test.mjs).
// 사진기의 자동 노출처럼 「지금 보는 천체」(초점)는 늘 비슷한 밝기(화면 평균 반사율 DISPLAY_MEAN)로 찍고,
// 다른 천체는 초점 대비 (반사율 비) × (거리 비)²로 그린다 — 거리 효과·자르기는 exposure.js lightScale.
// 지도는 출처마다 밝기 기준이 제각각이라(지도 평균 ÷ pV가 0.23~2.6배) 지도 자체가 아니라 이 배율로 맞춘다.
import { MAP_STATS } from './map_stats.js';

// 기하 반사율(가시광). NASA NSSDC Fact Sheet(행성: <행성>fact.html 「Geometric albedo」, 위성: joviansatfact·saturniansatfact·
//   uraniansatfact·neptuniansatfact 「Visual geometric albedo」, 포보스·데이모스 marsfact, 카론 plutofact) — 2026-11-27 읽음.
//   세레스 Reddy et al. 2015(Icarus 260, 332) 표 4의 555nm. 왜행성 셋은 dwarfs.js DWARF_PHOTOMETRY와 같은 값.
//   혜성 핵은 측정이 고르지 않아 모두 0.04(Halley 핵 Giotto 관측값과 같은 크기, 혜성 핵 통상값).
//   이아페투스는 NSSDC가 「0.05 / 0.5」(두 반구) — 밝은 쪽 0.5를 지도의 밝은 쪽 평균에 맞춰 전체 평균으로 바꾼다(아래 IAPETUS_PV).
export const PV = {
  mercury: 0.142, venus: 0.689, earth: 0.434, mars: 0.170, jupiter: 0.538, saturn: 0.499, uranus: 0.488, neptune: 0.442,
  moon: 0.12, phobos: 0.07, deimos: 0.08,
  io: 0.62, europa: 0.68, ganymede: 0.44, callisto: 0.19,
  mimas: 0.6, enceladus: 1.0, tethys: 0.8, dione: 0.7, rhea: 0.7, titan: 0.22, hyperion: 0.3,
  miranda: 0.32, ariel: 0.39, umbriel: 0.21, titania: 0.27, oberon: 0.23, triton: 0.72, charon: 0.42,
  ceres: 0.099, pluto: 0.52, haumea: 0.51, makemake: 0.77, eris: 0.96,
  halley: 0.04, encke: 0.04, churyumov: 0.04, swifttuttle: 0.04, halebopp: 0.04,
};
export const IAPETUS_BRIGHT_PV = 0.5;
export const IAPETUS_PV = IAPETUS_BRIGHT_PV * MAP_STATS.iapetus.mean / MAP_STATS.iapetus.bright;
PV.iapetus = IAPETUS_PV;

// 초점 천체를 그릴 화면 평균 반사율(선형). 예전 지도 평균들의 가운데 값(약 0.23)으로 — 대부분 천체가 혼자 볼 때 예전과 비슷하다.
//   다만 지도의 밝은 곳(peak)이 1을 넘지 않을 만큼만 올린다(수성·화성·칼리스토는 이 값보다 조금 어둡게 찍힌다).
export const DISPLAY_MEAN = 0.23;

// 지구는 바탕 지도 위에 구름 껍질·대기 빛이 따로 얹혀 지도 평균이 보이는 밝기가 아니다 — 배율은 1(예전 그대로)로 두고,
//   화면 평균은 화면에서 잰 값을 쓴다(tools/check_albedo.js, 2026-11-27): 보름 위상 원반 평균 D가 지구 0.2035, 같은 식으로 잰
//   단색 구(금성 0.2582·천왕성 0.2659 — 화면 평균 0.23)의 비 1.14로 나눠 0.18.
export const EARTH_DISPLAY = 0.18;

const lin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
// 단색 천체의 통계: 선형 Rec.709 밝기와 가장 큰 채널
export function colorStats(hex) {
  const c = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(v => lin(v / 255));
  return { mean: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], peak: Math.max(...c) };
}

// 천체의 밝기 배율과 혼자 볼 때 화면 평균. stats = { mean, peak } (지도면 MAP_STATS, 단색이면 colorStats)
export function surfaceGain(key, stats) {
  if (key === 'earth') return { gain: 1, display: EARTH_DISPLAY };
  const display = Math.min(DISPLAY_MEAN, stats.mean / stats.peak);
  return { gain: display / stats.mean, display };
}

// 초점 F를 볼 때 천체 i에 곱할 반사율 비(거리 효과 전): i가 화면에서 F보다 pV_i/pV_F배 밝게 보이도록
//   (i는 이미 display_i로, F는 display_F로 찍히므로 그 차이를 되돌린다)
export const albedoRef = (pv, display) => pv / display;
export function albedoRatio(refI, refF) {
  return refI / refF;
}

// 실제 I/F로 정한 빛(고리)을 그 천체 몸체와 같은 눈금으로 — 몸체는 지도 값을 램버트 반사율로 그려 보름 원반 평균이 (2/3)·지도 평균인데
//   실제 원반 평균은 pV다. 고리 빛에 이 배수를 곱해야 몸체와 고리가 실제 밝기 비로 보인다(토성 0.405: 지도가 실제보다 어둡게 그려져서).
//   몸체 배율(gain)·노출(expo)은 이 위에 몸체와 같이 곱해진다.
export const realToMap = (pv, stats) => (2 / 3) * stats.mean / pv;
