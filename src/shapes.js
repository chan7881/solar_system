// 모양 모형(textures/<이름>_shape.bin, tools/make_shapes.py가 만든다)을 몸체 좌표로 읽는다 — three.js 없는 순수 함수.
// 파일: uint32 n, uint32 m, float32 x,y,z × n(천체 고정 좌표 km: x = 경도 0°, y = 동경 90°, z = 북극), uint32 i,j,k × m
// 몸체 좌표(구와 같은 약속 — src/main.js orient): +X = 경도 0°, +Y = 북극, −Z = 동경 90° → (x, y, z) ↦ (x, z, −y)
//   이 바꿈은 회전(행렬식 +1)이라 면의 감는 방향(바깥에서 반시계)이 그대로다.

export const SHAPED = new Set(['phobos', 'deimos', 'hyperion', 'halley', 'churyumov', 'encke', 'swifttuttle', 'halebopp']);
// 가운데에서 겉면의 가장 먼 점까지(km) — 카메라 근접 한계·이름표 가림·화면 크기는 평균 반지름이 아니라 이것으로 잰다.
// 파일을 받기 전에도 맞도록 상수로 둔다(tests/shapes.test.mjs가 파일의 최대 반지름과 대조). 2026-11-21 실측 13.928 · 8.671,
// 히페리온 2026-11-22 실측 184.536,
// 혜성(tools/make_comets.py) 2026-11-22 실측 핼리 8.423 · 67P 2.649 · 엔케 3.078 · 스위프트-터틀 15.808 · 헤일-밥 36.486
export const SHAPE_REACH = { phobos: 13.93, deimos: 8.68, hyperion: 184.54, halley: 8.43, churyumov: 2.65, encke: 3.08, swifttuttle: 15.81, halebopp: 36.49 };

export function parseShape(buffer) {
  const dv = new DataView(buffer);
  const n = dv.getUint32(0, true), m = dv.getUint32(4, true);
  if (buffer.byteLength !== 8 + n * 12 + m * 12) throw new Error(`모양 파일 크기가 안 맞음: ${buffer.byteLength}`);
  const positions = new Float32Array(n * 3), index = new (n < 65536 ? Uint16Array : Uint32Array)(m * 3);
  for (let i = 0; i < n; i++) {
    const o = 8 + i * 12, x = dv.getFloat32(o, true), y = dv.getFloat32(o + 4, true), z = dv.getFloat32(o + 8, true);
    positions[i * 3] = x; positions[i * 3 + 1] = z; positions[i * 3 + 2] = -y;
  }
  for (let k = 0; k < m * 3; k++) index[k] = dv.getUint32(8 + n * 12 + k * 4, true);
  return { positions, index };
}

// 닫힌 면의 부피(km³) — 바깥 감기면 양수
export function shapeVolume({ positions: p, index }) {
  let v = 0;
  for (let k = 0; k < index.length; k += 3) {
    const a = index[k] * 3, b = index[k + 1] * 3, c = index[k + 2] * 3;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}
