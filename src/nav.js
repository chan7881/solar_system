// 사이드바 목록과 시간 빠르기 — 화면(DOM·three.js) 없는 순수 함수. 테스트는 tests/nav.test.mjs.

// ---------- 천체 목록 ----------
export const PLANET_KEYS = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];

// 태양 · 행성(공전 순서, 그 아래 위성) · 기타(행성·위성이 아닌 천체, 그 아래 딸린 위성)로 나눈다.
// 위성(parent가 있는 것)은 모천체 아래에만 들어간다. 모천체가 목록에 없는 위성은 기타로.
// parent가 'sun'인 천체(태양 둘레를 도는 것)는 위성이 아니라 기타로.
export function navGroups(list) {
  const keys = new Set(list.map(b => b.key));
  const childrenOf = k => list.filter(b => b.parent === k);
  const entry = b => ({ body: b, moons: childrenOf(b.key) });
  const sun = list.find(b => b.key === 'sun') ?? null;
  const planets = PLANET_KEYS.map(k => list.find(b => b.key === k)).filter(Boolean).map(entry);
  const placed = new Set(['sun', ...PLANET_KEYS]);
  const isMoon = b => b.parent && b.parent !== 'sun' && keys.has(b.parent);
  const other = list
    .filter(b => !placed.has(b.key) && !isMoon(b))
    .map(b => (b.parent ? { body: b, moons: [] } : entry(b)));
  return { sun, planets, other };
}

// 펼칠 계 — 초점이 위성이면 모천체, 위성이 있는 천체면 그 천체, 아니면 없음
export function systemOf(list, key) {
  const b = list.find(x => x.key === key);
  if (!b || key === 'sun') return null;
  if (b.parent && b.parent !== 'sun') return b.parent;
  return list.some(x => x.parent === key) ? key : null;
}

// ---------- 시간 빠르기 ----------
const MIN = 60, HOUR = 3600, DAY = 86400;
// 실제 1초에 흐르는 초. 가운데(REALTIME)가 실제 빠르기, 왼쪽은 과거로, 오른쪽은 미래로. 멈춤은 따로(paused).
export const RATES = [-365.25 * DAY, -30 * DAY, -7 * DAY, -DAY, -HOUR, -MIN, 1, MIN, HOUR, DAY, 7 * DAY, 30 * DAY, 365.25 * DAY];
const RATE_NAMES = ['1년', '1달', '1주', '1일', '1시간', '1분', '', '1분', '1시간', '1일', '1주', '1달', '1년'];
export const REALTIME = RATES.indexOf(1);

export const clampRate = i => Math.min(RATES.length - 1, Math.max(0, i));

// 화면에 보일 빠르기 문구
// 실시간 여부는 「실시간」 단추가 보이므로 여기서는 빠르기만 말한다
export function rateText({ rateIdx, paused }) {
  if (paused) return '멈춤';
  if (rateIdx === REALTIME) return '실제 빠르기';
  return `${RATES[rateIdx] < 0 ? '과거로' : '미래로'} · 1초에 ${RATE_NAMES[rateIdx]}`;
}

// 한 그림 틀 동안 흐르는 시뮬레이션 시간(ms)
export function advanceMs({ rateIdx, live, paused }, dtSec) {
  if (paused || live) return 0; // 실시간은 시계에 직접 맞춘다
  return RATES[rateIdx] * dtSec * 1000;
}
