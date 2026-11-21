// 사이드바 분류와 시간 빠르기(src/nav.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { BODIES } from '../src/ephemeris.js';
import { MOONS } from '../src/moons.js';
import { SMALL_BODIES } from '../src/smallbodies.js';
import { navGroups, systemOf, RATES, REALTIME, clampRate, rateText, advanceMs } from '../src/nav.js';

const ALL = [...BODIES, ...MOONS];

test('행성은 공전 순서, 위성은 모행성 아래에만 들어간다', () => {
  const g = navGroups(ALL);
  assert.equal(g.sun.key, 'sun');
  assert.deepEqual(g.planets.map(e => e.body.key), ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']);
  const n = Object.fromEntries(g.planets.map(e => [e.body.key, e.moons.length]));
  assert.deepEqual(n, { mercury: 0, venus: 0, earth: 1, mars: 2, jupiter: 4, saturn: 7, uranus: 5, neptune: 1 });
  for (const e of g.planets) for (const m of e.moons) assert.equal(m.parent, e.body.key);
  // 모든 천체가 정확히 한 번씩 나온다
  const seen = [g.sun.key, ...g.planets.flatMap(e => [e.body.key, ...e.moons.map(m => m.key)])];
  assert.equal(seen.length, ALL.length);
  assert.equal(new Set(seen).size, ALL.length);
  assert.equal(g.other.length, 0);
});

test('행성·위성이 아닌 천체는 기타로, 그 위성은 그 아래로', () => {
  const extra = [
    { key: 'pluto', name: '명왕성' },
    { key: 'charon', name: '카론', parent: 'pluto' },
    { key: 'ceres', name: '세레스' },
    { key: 'orphan', name: '고아', parent: 'nowhere' },
    { key: 'halley', name: '핼리 혜성', parent: 'sun' },
  ];
  const g = navGroups([...ALL, ...extra]);
  assert.deepEqual(g.other.map(e => e.body.key), ['pluto', 'ceres', 'orphan', 'halley']);
  assert.equal(systemOf([...ALL, ...extra], 'halley'), null);
  assert.equal(systemOf([...ALL, ...extra], 'charon'), 'pluto');
  assert.deepEqual(g.other[0].moons.map(m => m.key), ['charon']);
  assert.equal(g.planets.length, 8);
});

test('왜행성·혜성은 각각 묶이고 목록 순서를 지킨다 — 기타에는 안 들어간다', () => {
  const list = [...ALL, ...SMALL_BODIES, { key: 'orphan', name: '고아' }];
  const g = navGroups(list);
  assert.deepEqual(g.dwarfs.map(e => e.body.key), ['ceres', 'pluto', 'haumea', 'makemake', 'eris']);
  assert.deepEqual(g.comets.map(e => e.body.key), ['halley', 'encke', 'churyumov', 'swifttuttle', 'halebopp']);
  assert.deepEqual(g.other.map(e => e.body.key), ['orphan']);
});

test('펼칠 계: 위성이면 모천체, 위성이 있는 행성은 자기, 없으면 null', () => {
  assert.equal(systemOf(ALL, 'titan'), 'saturn');
  assert.equal(systemOf(ALL, 'saturn'), 'saturn');
  assert.equal(systemOf(ALL, 'venus'), null);
  assert.equal(systemOf(ALL, 'sun'), null);
});

test('빠르기 칸: 가운데가 실제 빠르기, 왼쪽은 과거(음수)·오른쪽은 미래(양수)로 단조 증가', () => {
  assert.equal(RATES[REALTIME], 1);
  assert.equal(REALTIME, (RATES.length - 1) / 2); // 정확히 가운데
  assert.ok(!RATES.includes(0)); // 멈춤은 칸이 아니라 단추
  for (let i = 1; i < RATES.length; i++) assert.ok(RATES[i] > RATES[i - 1]);
  for (let i = 0; i < REALTIME; i++) assert.ok(RATES[i] < 0);
  for (let i = REALTIME; i < RATES.length; i++) assert.ok(RATES[i] > 0);
  assert.equal(clampRate(-3), 0);
  assert.equal(clampRate(99), RATES.length - 1);
});

test('빠르기 문구와 흐르는 시간의 방향', () => {
  const day = RATES.indexOf(86400), back = RATES.indexOf(-86400);
  assert.equal(rateText({ rateIdx: day, live: false, paused: false }), '미래로 · 1초에 1일');
  assert.equal(rateText({ rateIdx: back, live: false, paused: false }), '과거로 · 1초에 1일');
  assert.equal(rateText({ rateIdx: REALTIME, live: true, paused: false }), '실제 빠르기');
  assert.equal(rateText({ rateIdx: REALTIME, live: false, paused: false }), '실제 빠르기');
  assert.equal(rateText({ rateIdx: day, live: false, paused: true }), '멈춤');
  assert.equal(advanceMs({ rateIdx: day, live: false, paused: false }, 0.5), 43200e3);
  assert.equal(advanceMs({ rateIdx: back, live: false, paused: false }, 0.5), -43200e3);
  assert.equal(advanceMs({ rateIdx: day, live: false, paused: true }, 0.5), 0);
  assert.equal(advanceMs({ rateIdx: REALTIME, live: true, paused: false }, 0.5), 0);
});

test('레이어: 위성은 모행성을 따르고, 꺼도 보고 있는 계는 남는다', async () => {
  const { layerOf, bodyShown, defaultLayers, GROUP_LAYER } = await import('../src/nav.js');
  const list = [...ALL, ...SMALL_BODIES];
  assert.equal(layerOf(list, 'sun'), null);
  assert.equal(layerOf(list, 'earth'), 'planets');
  assert.equal(layerOf(list, 'titan'), 'planets');
  assert.equal(layerOf(list, 'pluto'), 'dwarfs');
  assert.equal(layerOf(list, 'halley'), 'comets');
  const L = { ...defaultLayers(), planets: false, comets: false };
  assert.equal(bodyShown(list, 'sun', L, 'sun'), true);
  assert.equal(bodyShown(list, 'mars', L, 'sun'), false);
  assert.equal(bodyShown(list, 'phobos', L, 'sun'), false);
  assert.equal(bodyShown(list, 'pluto', L, 'sun'), true);   // 왜행성은 켜져 있음
  assert.equal(bodyShown(list, 'halley', L, 'sun'), false);
  assert.equal(bodyShown(list, 'halley', L, 'halley'), true); // 보고 있으면 남김
  // 타이탄을 보면 토성과 다른 토성 위성은 남고, 목성·목성 위성은 숨는다
  assert.equal(bodyShown(list, 'saturn', L, 'titan'), true);
  assert.equal(bodyShown(list, 'mimas', L, 'titan'), true);
  assert.equal(bodyShown(list, 'jupiter', L, 'titan'), false);
  assert.equal(bodyShown(list, 'io', L, 'titan'), false);
  assert.equal(bodyShown(list, 'mars', defaultLayers(), 'sun'), true);
  assert.deepEqual(GROUP_LAYER, ['belt', 'belt', 'belt', 'kuiper']);
  const d = defaultLayers();
  assert.equal(d.groupColors, false); // 색 구분은 처음엔 꺼짐(흰 점)
  assert.equal(d.constellations, false);
});
