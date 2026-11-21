// 사이드바 분류와 시간 빠르기(src/nav.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { BODIES } from '../src/ephemeris.js';
import { MOONS } from '../src/moons.js';
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
