// 도구(거리 재기·크기 비교)의 계산과 문구 — 화면(DOM·three.js) 없는 순수 함수. 테스트는 tests/tools.test.mjs.
import { TT_MINUS_UTC_S } from './ephemeris.js';

export const LIGHT_KM_S = 299792.458; // 빛의 속력(km/s, 정의값)

// 두 천체 중심 사이 거리(km) — 위치는 장면 좌표(km)라 좌표계를 바꿔도 같다
export const distanceKm = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

// 유효 숫자 n자리로 반올림
const roundSig = (x, n) => {
  if (x === 0) return 0;
  const u = 10 ** (Math.floor(Math.log10(Math.abs(x))) - n + 1);
  return Math.round(x / u) * u;
};
const comma = n => Math.round(n).toLocaleString('en-US');

// 거리(km)를 유효 숫자 4자리로, 만·억 단위를 섞어 쓴다 — 「2억 2,790만km」「38만 4,400km」「9,377km」
export function fmtKm(km) {
  if (roundSig(km, 3) < 1000) return `${Number(roundSig(km, 3).toPrecision(3))}km`;
  const n = roundSig(km, 4);
  const eok = Math.floor(n / 1e8), man = Math.floor((n % 1e8) / 1e4), rest = Math.round(n % 1e4);
  const parts = [];
  if (eok) parts.push(`${comma(eok)}억`);
  if (man) parts.push(`${comma(man)}만`);
  if (rest) parts.push(comma(rest));
  return `${parts.join(' ')}km`;
}

// 천문단위 — 0.01AU보다 가까우면 쓰지 않는다(달·위성은 km로 충분)
export function fmtAU(km, AU_KM) {
  const au = km / AU_KM;
  if (au < 0.01) return null;
  // 반올림한 값으로 자릿수를 정한다(9.9996 → 「10.00AU」, 「10.000AU」가 아니라)
  const digits = au.toFixed(3) < 10 ? 3 : au.toFixed(2) < 100 ? 2 : 1;
  return `${au.toFixed(digits)}AU`;
}

// 빛이 가는 데 걸리는 시간 — 「1.28초」「8분 19초」「4시간 10분」「2일 3시간」
export function fmtLight(km) {
  const s = km / LIGHT_KM_S;
  // 경계는 반올림한 값으로 본다 — 59.97초는 「60.0초」가 아니라 「1분」, 3599.8초는 「60분」이 아니라 「1시간」
  if (s.toFixed(2) < 10) return `${s.toFixed(2)}초`;
  if (s.toFixed(1) < 60) return `${s.toFixed(1)}초`;
  const two = (n, per, unitBig, unitSmall) => {
    const a = Math.floor(n / per), b = n % per;
    return b ? `${a}${unitBig} ${b}${unitSmall}` : `${a}${unitBig}`;
  };
  const sec = Math.round(s);
  if (sec < 3600) return two(sec, 60, '분', '초');
  const min = Math.round(s / 60);
  if (min < 1440) return two(min, 60, '시간', '분');
  return two(Math.round(s / 3600), 24, '일', '시간');
}

// 거리 재기 결과 한 벌
export function distanceText(km, AU_KM) {
  const au = fmtAU(km, AU_KM);
  return { km: fmtKm(km), sub: [au, `빛으로 ${fmtLight(km)}`].filter(Boolean).join(' · ') };
}

// 율리우스일(TT) → 그 순간의 날짜(이 기기 시간대) 「2003년 8월 27일」 — 위쪽 날짜 표시와 같은 시간대
export function fmtDay(jdTT) {
  const d = new Date(((jdTT - 2440587.5) * 86400 - TT_MINUS_UTC_S) * 1000);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

// 최소·최대 거리 한 줄 — 「5,576만km · 1924년 8월 23일」
export const extremeText = e => `${fmtKm(e.km)} · ${fmtDay(e.jd)}`;

// 크기 비교에 쓰는 지름 — 회전 타원체는 적도 지름(NASA 행성 자료표와 같은 기준),
// 모양이 고르지 않은 천체(포보스·데이모스·하우메아)는 부피가 같은 구의 지름(평균 지름)
export function diameterOf(b, shaped = false) {
  if (b.abc || shaped) return { km: 2 * b.radius, mean: true };
  return { km: 2 * (b.re ?? b.radius), mean: false };
}

// 지름 문구 — 100km 아래는 소수 한 자리까지(포보스 22.2km)
export function fmtDiameter({ km, mean }) {
  const v = km < 100 ? `${Number(km.toFixed(1))}km` : `${comma(km)}km`;
  return `${mean ? '평균 지름' : '지름'} ${v}`;
}

// 배율: 유효 숫자 3자리(109 · 11.2 · 3.67)
const fmtRatio = r => (r >= 100 ? comma(r) : String(Number(r.toPrecision(3))));

// 「목성의 지름은 지구의 약 11.2배」 — 늘 큰 쪽을 작은 쪽에 견준다
export function ratioText(a, da, b, db) {
  if (a.key === b.key) return '같은 천체';
  const [big, dBig, small, dSmall] = da >= db ? [a, da, b, db] : [b, db, a, da];
  return `${big.name}의 지름은 ${small.name}의 약 ${fmtRatio(dBig / dSmall)}배`;
}

// 처음 고를 두 천체 — 지구와 지금 보는 천체(지구를 보고 있으면 달)
export function defaultPair(focus) {
  return ['earth', focus === 'earth' ? 'moon' : focus];
}

// 크기 비교 화면의 배치. 천체마다 반폭 w·반높이 h(km), 그릴 칸(가로 W, 세로 top~bottom px).
// 두 천체를 같은 축척 s(px/km)로 가로로 나란히(사이 간격 = 큰 쪽 반폭의 25%), 가운데 정렬.
// 반환: s, 두 중심의 화면 x, 공통 중심 y(px)
export function compareLayout(A, B, W, top, bottom) {
  const gap = 0.25 * Math.max(A.w, B.w);
  const total = 2 * A.w + gap + 2 * B.w;
  const H = bottom - top;
  const s = Math.min(W * 0.9 / total, H * 0.72 / (2 * Math.max(A.h, B.h)));
  const left = W / 2 - (total * s) / 2;
  return { s, xA: left + A.w * s, xB: left + (2 * A.w + gap + B.w) * s, y: top + H / 2 };
}

// 화면의 선분 (x0,y0)-(x1,y1)을 상자 [l,r]×[t,b]로 잘라 보이는 구간의 가운데를 돌려준다(없으면 null) — Liang–Barsky
export function visibleMid(x0, y0, x1, y1, l, t, r, b) {
  const dx = x1 - x0, dy = y1 - y0;
  let u0 = 0, u1 = 1;
  for (const [p, q] of [[-dx, x0 - l], [dx, r - x0], [-dy, y0 - t], [dy, b - y0]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const u = q / p;
    if (p < 0) { if (u > u1) return null; if (u > u0) u0 = u; }
    else { if (u < u0) return null; if (u < u1) u1 = u; }
  }
  const m = (u0 + u1) / 2;
  return { x: x0 + dx * m, y: y0 + dy * m, len: Math.hypot(dx, dy) * (u1 - u0) };
}
