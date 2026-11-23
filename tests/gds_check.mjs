// 해왕성 대흑점 무늬(textures/neptune_gds_2k.png)가 Voyager 2 사진 PIA00046 속 자리에 있는지 재는 함수 — 테스트(neptune_gds.test.mjs)와 변이 검사가 같이 쓴다.
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

// 8비트 RGBA(색 종류 6)·끼워 짜기 없음 PNG만 읽는다
export function readPng(path) {
  const b = readFileSync(path);
  let o = 8, W = 0, H = 0; const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o), type = b.toString('latin1', o + 4, o + 8), d = b.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { W = d.readUInt32BE(0); H = d.readUInt32BE(4); if (d[8] !== 8 || d[9] !== 6 || d[12] !== 0) throw new Error('8비트 RGBA 비끼움 PNG가 아님'); }
    if (type === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), bpp = 4, stride = W * bpp, out = new Uint8Array(H * stride);
  for (let y = 0; y < H; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, up = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      out[y * stride + x] = v & 255;
    }
  }
  return { W, H, rgba: out };
}

// 알파가 반 넘고 빨강이 낮은(R < 80) 칸 = 대흑점. 위도·동경 평균과 범위(도)
export function spot({ W, H, rgba }) {
  let n = 0, sLat = 0, sLon = 0, latMin = 90, latMax = -90, lonMin = 180, lonMax = -180;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (rgba[i + 3] < 128 || rgba[i] >= 80) continue;
    const lat = 90 - (y + 0.5) / H * 180, lon = (x + 0.5) / W * 360 - 180;
    n++; sLat += lat; sLon += lon;
    latMin = Math.min(latMin, lat); latMax = Math.max(latMax, lat); lonMin = Math.min(lonMin, lon); lonMax = Math.max(lonMax, lon);
  }
  return { n, lat: sLat / n, lon: sLon / n, latMin, latMax, lonMin, lonMax };
}

// 사진 속 화소(원판 중심·반지름·기울기·보는 위도는 tools/make_neptune.py가 사진에서 잡은 값)로 투영 — 사진 가운데 동경 = −(Horizons 서경)
export const PHOTO = { cx: 478.5, cy: 494.0, R: 285.75, theta: 2.0, B: -29.4 };
export function project(latDeg, lonDeg, centerElonDeg) {
  const D = Math.PI / 180, th = PHOTO.theta * D, B = PHOTO.B * D;
  const p = [Math.sin(th) * Math.cos(B), Math.cos(th) * Math.cos(B), Math.sin(B)];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const k = dot([0, 0, 1], p), a0 = [0 - p[0] * k, 0 - p[1] * k, 1 - p[2] * k], an = Math.hypot(...a0), a = a0.map(v => v / an);
  const e = [p[1] * a[2] - p[2] * a[1], p[2] * a[0] - p[0] * a[2], p[0] * a[1] - p[1] * a[0]];
  const f = latDeg * D, d = (lonDeg - centerElonDeg) * D;
  const P = [0, 1, 2].map(i => Math.sin(f) * p[i] + Math.cos(f) * (Math.cos(d) * a[i] + Math.sin(d) * e[i]));
  return { x: PHOTO.cx + P[0] * PHOTO.R, y: PHOTO.cy - P[1] * PHOTO.R, mu: P[2] };
}
