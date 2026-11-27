// 햇빛 세기의 거리 효과 — 순수 함수(three.js 없음). 화면은 main.js의 `step`(몸체마다 uExpo)과 재질 패치.
// 실제로 햇빛은 거리의 제곱에 반비례한다(1/r²). 그대로 두면 한 화면에서 해왕성이 지구의 1/900이라 보이지 않으므로,
// 사진기의 자동 노출처럼 「지금 보는 천체」(초점)가 늘 같은 밝기로 찍히게 노출을 맞추고, 다른 천체는 초점 대비 실제 비율(1/r²)로 하되
// 화면이 담는 밝기 폭(LIGHT_MIN ~ LIGHT_MAX)에서 잘린다(가시성). 초점 천체 하나만 볼 때는 예전 밝기와 같다.
import { AU_KM } from './ephemeris.js';

export const LIGHT_MIN = 0.1;  // 가장 어두운 쪽(초점보다 약 3.2배 먼 곳부터 같은 밝기) — 해왕성도 낮 쪽 윤곽이 보이는 정도
export const LIGHT_MAX = 2.5;  // 가장 밝은 쪽(초점보다 약 1.6배 가까운 곳부터 같다) — 이보다 밝으면 지도가 하얗게 날아간다

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 노출 기준 거리(km): 초점이 태양에서 d(km) 떨어져 있을 때. 초점이 태양 곁(d < 0.15AU — 수성도 0.3AU 밖)이면
// 기준을 1AU로 두어, 태양을 보다가 행성으로 날아갈 때 값이 부드럽게 이어지게 한다.
export function refDistance(d) {
  const t = smooth(0.02 * AU_KM, 0.15 * AU_KM, d);
  return Math.exp(Math.log(AU_KM) + (Math.log(Math.max(d, 1)) - Math.log(AU_KM)) * t);
}
// 태양에서 d(km) 떨어진 천체에 곱하는 밝기: 초점(기준 거리 dRef) 대비 k·(dRef/d)²을 LIGHT_MIN~LIGHT_MAX로 자른 값
//   k는 초점 대비 반사율 비(albedo.js albedoRatio) — 없으면 1(거리 효과만)
export function lightScale(dRef, d, k = 1) {
  if (!(d > 0) || !(dRef > 0)) return 1;
  return Math.min(LIGHT_MAX, Math.max(LIGHT_MIN, k * (dRef / d) ** 2));
}
