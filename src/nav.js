// 사이드바 목록과 시간 빠르기 — 화면(DOM·three.js) 없는 순수 함수. 테스트는 tests/nav.test.mjs.

// ---------- 천체 목록 ----------
const NAV_KINDS = new Set(['dwarf', 'comet']); // 따로 묶는 종류 — 늘리면 navGroups 반환에도 넣는다
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
  const rest = list
    .filter(b => !placed.has(b.key) && !isMoon(b))
    .map(b => (b.parent ? { body: b, moons: [] } : entry(b)));
  // 왜행성(kind 'dwarf')·혜성(kind 'comet')은 따로 묶고, 남은 것은 기타
  const of = kind => rest.filter(e => e.body.kind === kind);
  return { sun, planets, dwarfs: of('dwarf'), comets: of('comet'), other: rest.filter(e => !NAV_KINDS.has(e.body.kind)) };
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

// ---------- 레이어(오른쪽 설정 창) ----------
// 켜고 끄는 항목과 처음 값. 별자리는 처음엔 끈다(별 배경을 두지 않는 화면이라 선만 뜬다)
export const LAYERS = [
  { key: 'ui', name: '사용자 화면', on: true },
  { key: 'planets', name: '행성', on: true },
  { key: 'dwarfs', name: '왜행성', on: true },
  { key: 'comets', name: '혜성', on: true },
  { key: 'belt', name: '소행성대·트로이군', on: true },
  { key: 'kuiper', name: '카이퍼대', on: true },
  { key: 'oort', name: '오르트 구름', on: true },
  { key: 'groupColors', name: '무리별 색 구분', on: false },
  { key: 'constellations', name: '별자리', on: false },
  { key: 'trails', name: '궤적', on: true },
  { key: 'orbits', name: '궤도', on: true },
  { key: 'labels', name: '이름표', on: true },
  { key: 'icons', name: '아이콘', on: true },
  { key: 'nightLights', name: '지구 밤 불빛', on: true },
  { key: 'shadows', name: '그림자', on: true },
  { key: 'ringBoost', name: '고리 강조', on: false },
  { key: 'sunFlare', name: '태양 렌즈 효과', on: true },
];
export const defaultLayers = () => Object.fromEntries(LAYERS.map(l => [l.key, l.on]));

// 천체가 속한 레이어 — 위성은 모천체를 따른다. 태양은 늘 보인다(null)
const KIND_LAYER = { dwarf: 'dwarfs', comet: 'comets' };
export function layerOf(list, key) {
  const b = list.find(x => x.key === key);
  if (!b || key === 'sun') return null;
  if (b.parent && b.parent !== 'sun' && list.some(x => x.key === b.parent)) return layerOf(list, b.parent);
  return KIND_LAYER[b.kind] ?? 'planets';
}

// 천체를 그릴지 — 레이어가 꺼져 있어도 보고 있는 천체와 그 계(모천체·형제 위성)는 남긴다
export function bodyShown(list, key, layers, focus) {
  const layer = layerOf(list, key);
  if (!layer || layers[layer]) return true;
  if (key === focus) return true;
  const sys = systemOf(list, focus);
  if (!sys) return false;
  return key === sys || list.find(x => x.key === key)?.parent === sys;
}

// 점 무리 번호(smallbodies.js GROUPS: 소행성대·힐다·트로이·카이퍼대) → 레이어
export const GROUP_LAYER = ['belt', 'belt', 'belt', 'kuiper'];
