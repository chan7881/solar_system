// 레이어 창에 LAYERS의 모든 키가 들어 있는지 — 목록에서 빠지면 켜고 끌 길이 없다(고리 강조가 빠졌던 적 있음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LAYERS } from '../src/nav.js';

const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const start = src.indexOf("const lyList = document.getElementById('ly-list')");
const end = src.indexOf('function setLayers(');
const block = src.slice(start, end);

test('레이어 창 목록에 모든 레이어가 있다', () => {
  for (const l of LAYERS) assert.ok(block.includes(`'${l.key}'`), `${l.key}(${l.name}) 누락`);
});
