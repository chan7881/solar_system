// 천체 사이 밝기 — src/albedo.js. 정답이 정해진 것: 같은 거리의 두 천체는 화면 평균 밝기 비가 기하 반사율 비와 같다(방향 포함),
// 초점 천체는 혼자 볼 때 DISPLAY_MEAN(밝은 곳이 1을 넘으면 그만큼 낮춤), 배율을 곱해도 지도의 밝은 곳이 1을 넘지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PV, IAPETUS_PV, IAPETUS_BRIGHT_PV, DISPLAY_MEAN, EARTH_DISPLAY, surfaceGain, colorStats, albedoRef, albedoRatio } from '../src/albedo.js';
import { MAP_STATS } from '../src/map_stats.js';
import { lightScale, LIGHT_MIN, LIGHT_MAX } from '../src/exposure.js';
import { BODIES, AU_KM } from '../src/ephemeris.js';
import { MOONS } from '../src/moons.js';
import { SMALL_BODIES } from '../src/smallbodies.js';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≠ ${b} (±${eps})`);
const all = [...BODIES, ...MOONS, ...SMALL_BODIES].filter(b => b.key !== 'sun');
const statsOf = b => MAP_STATS[b.key] ?? colorStats(b.color ?? 0x4a4643);
const info = b => { const s = statsOf(b), g = surfaceGain(b.key, s); return { s, ...g, ref: albedoRef(PV[b.key], g.display) }; };
// 같은 거리(1/r² 효과 없음)에서 초점 F를 볼 때 i의 화면 평균 밝기 = 지도 평균 × 배율 × 반사율 비(밝기 폭 안이면)
const shown = (i, F) => (i.key === 'earth' ? EARTH_DISPLAY : statsOf(i).mean * info(i).gain) * lightScale(AU_KM, AU_KM, albedoRatio(info(i).ref, info(F).ref));
const byKey = Object.fromEntries(all.map(b => [b.key, b]));

test('지도 통계는 main.js의 지도 목록(TEXTURED)과 같은 천체다', () => {
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const list = src.match(/const TEXTURED = new Set\(\[([^\]]+)\]\)/)[1].match(/'(\w+)'/g).map(x => x.slice(1, -1));
  assert.deepEqual([...list].sort(), Object.keys(MAP_STATS).sort());
});

test('모든 천체(태양 빼고)에 반사율이 있고 0과 1.5 사이다', () => {
  for (const b of all) assert.ok(PV[b.key] > 0 && PV[b.key] < 1.5, b.key);
  assert.equal(all.length, 8 + 22 + 5 + 5);
});

test('초점 천체는 혼자 볼 때 DISPLAY_MEAN — 밝은 곳이 1을 넘을 천체만 그보다 낮다', () => {
  for (const b of all) {
    if (b.key === 'earth') continue;
    const { s, gain, display } = info(b);
    close(s.mean * gain, display, 1e-12, b.key);
    assert.ok(display <= DISPLAY_MEAN + 1e-12, b.key);
    assert.ok(s.peak * gain <= 1 + 1e-9, `${b.key} 밝은 곳 ${s.peak * gain}`);
    if (display < DISPLAY_MEAN - 1e-9) close(s.peak * gain, 1, 1e-9, `${b.key} 낮춘 만큼만`);
  }
  assert.equal(surfaceGain('earth', MAP_STATS.earth).gain, 1); // 지구는 구름·대기 빛이 따로라 예전 그대로
});

test('같은 거리의 두 천체는 화면 밝기 비 = 기하 반사율 비 (밝기 폭 안일 때)', () => {
  let n = 0;
  for (const i of all) for (const F of all) {
    const k = PV[i.key] / PV[F.key], arg = albedoRatio(info(i).ref, info(F).ref); // arg: 화면 배율(초점과 혼자 볼 때 밝기 차를 되돌린 값)
    if (arg < LIGHT_MIN * 1.01 || arg > LIGHT_MAX * 0.99) continue;
    close(shown(i, F) / shown(F, F), k, 1e-9, `${i.key}/${F.key}`); n++;
  }
  assert.ok(n > 1000, `${n}쌍`);
});

test('방향: 처음 문제였던 쌍 — 세레스는 티타니아보다, 달은 엔셀라두스보다 어둡다', () => {
  const { ceres, titania, moon, enceladus, callisto, europa } = byKey;
  close(shown(ceres, titania) / shown(titania, titania), 0.099 / 0.27, 1e-9);
  assert.ok(shown(ceres, titania) < shown(titania, titania));
  assert.ok(shown(moon, enceladus) < shown(enceladus, enceladus));
  assert.ok(shown(callisto, europa) < shown(europa, europa) / 3); // 0.19 대 0.68
});

test('밝기 폭 밖은 잘린다 — 엔셀라두스(1.0)를 혜성 핵(0.04) 초점에서 보면 LIGHT_MAX배', () => {
  const { enceladus, halley } = byKey;
  close(shown(enceladus, halley) / info(enceladus).display, LIGHT_MAX, 1e-12);
  close(shown(halley, enceladus) / info(halley).display, LIGHT_MIN, 1e-12);
});

test('이아페투스: 밝은 쪽 평균이 반사율 0.5에 맞게 전체 평균을 정한다(어두운 쪽 1/10 지도)', () => {
  const s = MAP_STATS.iapetus;
  close(IAPETUS_PV * s.bright / s.mean, IAPETUS_BRIGHT_PV, 1e-12);
  assert.equal(PV.iapetus, IAPETUS_PV); // 표의 두 반구 값이 아니라 전체 평균으로 바꾼 값을 쓴다
  assert.ok(IAPETUS_PV > 0.2 && IAPETUS_PV < 0.4, `${IAPETUS_PV}`);
});

test('반사율 비와 거리 효과가 곱해진다', () => {
  close(lightScale(AU_KM, 2 * AU_KM, 2), 0.5, 1e-12);
  close(lightScale(AU_KM, AU_KM, 1.7), 1.7, 1e-12);
  close(lightScale(AU_KM, 0.5 * AU_KM, 2), LIGHT_MAX, 1e-12);
});
