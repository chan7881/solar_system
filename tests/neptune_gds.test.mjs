// 해왕성 대흑점 무늬 — 사진 PIA00046 속 자리·크기, 그리고 위치를 틀리게 한 복제본이 걸러지는지(변이 검사)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readPng, spot, project } from './gds_check.mjs';

const png = readPng(new URL('../textures/neptune_gds_2k.png', import.meta.url));
// Horizons(관측자 Voyager 2, 1989-08-20 08:00 UT) 관측 아래점 서경 — 지도는 동경+이므로 부호를 뒤집는다
const row = readFileSync(new URL('./horizons_neptune_gds.txt', import.meta.url), 'utf8').split('\n').find(l => l.includes('1989-Aug-20 08:00'));
const CENTER_ELON = -Number(row.trim().split(/\s+/)[2]);
// 사진에서 직접 잰 대흑점 자리: 빨강 채널이 주변(σ40 흐림)보다 12 넘게 어두운 화소의 무게중심(원판 가장자리 x<245는 뺌) — 임계 10·12·15에서 (312.8~315.4, 461.7~462.9)
const PHOTO_SPOT = { x: 313.6, y: 462.5 };

function check(p) {
  const s = spot(p);
  assert.ok(s.n > 2000, `대흑점 칸 ${s.n}`);
  const q = project(s.lat, s.lon, CENTER_ELON);
  assert.ok(q.mu > 0.3, `사진 가장자리 쪽 μ=${q.mu}`);
  const err = Math.hypot(q.x - PHOTO_SPOT.x, q.y - PHOTO_SPOT.y);
  assert.ok(err < 12, `사진 속 자리와 ${err.toFixed(1)}화소 어긋남(투영 ${q.x.toFixed(1)}, ${q.y.toFixed(1)})`);
  return s;
}

test('대흑점 무늬가 사진 속 대흑점과 12화소(원판 반지름 286의 4%) 안에서 겹친다', () => { check(png); });

test('대흑점 크기: 위도 폭 4500~7500km, 경도 폭 10000~15000km (문헌 6600×13000km)', () => {
  const s = spot(png), D = Math.PI / 180, km = 24764 * D; // 도당 km(적도 반지름)
  const h = (s.latMax - s.latMin) * km, w = (s.lonMax - s.lonMin) * km * Math.cos(s.lat * D);
  assert.ok(h > 4500 && h < 7500, `높이 ${h.toFixed(0)}km`);
  assert.ok(w > 10000 && w < 15000, `너비 ${w.toFixed(0)}km`);
  assert.ok(s.lat < -10 && s.lat > -25, `중심 위도 ${s.lat.toFixed(1)}°(남반구 17~27°S 둘레)`);
});

test('무늬는 창(동경 −150~−88°, 위도 −32~−4°) 밖에서는 알파 0 — 띠 지도가 그대로', () => {
  const { W, H, rgba } = png; let outside = 0, inside = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = rgba[(y * W + x) * 4 + 3], lat = 90 - (y + 0.5) / H * 180, lon = (x + 0.5) / W * 360 - 180;
    if (lon < -150 || lon > -88 || lat < -32 || lat > -4) outside += a; else inside += a > 0;
  }
  assert.equal(outside, 0);
  assert.ok(inside > 20000, `창 안 알파>0 칸 ${inside}`);
});

// 변이 검사 — 일부러 틀린 복제본을 같은 검사에 넣어 실패하는지 본다(통과만 보면 약한 검사를 못 가린다)
const shifted = (dx, dy) => {
  const { W, H, rgba } = png, out = new Uint8Array(rgba.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = (((y + dy + H) % H) * W + ((x + dx + W) % W)) * 4, d = (y * W + x) * 4;
    for (let c = 0; c < 4; c++) out[d + c] = rgba[s + c];
  }
  return { W, H, rgba: out };
};
for (const [name, dx, dy] of [['경도 +5°', -28, 0], ['경도 +10°', -57, 0], ['경도 −10°', 57, 0], ['경도 +30°', -171, 0], ['위도 +5°', 0, -28], ['위도 +10°', 0, -57], ['위도 −10°', 0, 57]]) {
  test(`변이: 무늬를 ${name} 옮긴 복제본은 위치 검사에서 실패한다`, () => {
    assert.throws(() => check(shifted(dx, dy)));
  });
}
test('변이: 동경 부호를 거꾸로 쓰면(서경 그대로) 위치 검사에서 실패한다', () => {
  const s = spot(png), q = project(s.lat, s.lon, -CENTER_ELON);
  assert.ok(q.mu < 0.3 || Math.hypot(q.x - PHOTO_SPOT.x, q.y - PHOTO_SPOT.y) > 50);
});
