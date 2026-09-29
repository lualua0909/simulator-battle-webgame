import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SEED } from '@/shared/seed';
import { HEX_STEP, HEX_WIDTH, Terrain, hexCenter } from './terrain';

const map = SEED.maps.find((m) => m.shape === 'diorama')!;

test('hexCenter maps points to the nearest tile centre', () => {
  assert.deepEqual(hexCenter(0.3, -0.2).map((v) => v + 0), [0, 0]);
  const [x, z] = hexCenter(HEX_WIDTH * 1.1, 0.1);
  assert.ok(Math.abs(x - HEX_WIDTH) < 1e-9 && Math.abs(z) < 1e-9);
  for (const [px, pz] of [[7.3, -12.1], [-20, 15.5], [3.9, 3.4]]) {
    const [cx, cz] = hexCenter(px, pz);
    assert.deepEqual(hexCenter(cx, cz), [cx, cz]);
  }
});

test('diorama tiles are flat and terraced', () => {
  const t = new Terrain(map, SEED.assets);
  assert.ok(t.diorama);
  for (const [px, pz] of [[5, 5], [-12, 8], [20, -20]]) {
    const [cx, cz] = hexCenter(px, pz);
    const h = t.height(cx, cz);
    assert.equal(t.height(cx + 0.5, cz - 0.4), h);
    assert.ok(Math.abs(h / HEX_STEP - Math.round(h / HEX_STEP)) < 1e-9);
  }
  // Water is whole tiles.
  const wet = t.inWater(t.riverX(0), 0);
  const [cx, cz] = hexCenter(t.riverX(0), 0);
  assert.equal(t.inWater(cx + 0.6, cz + 0.6), wet);
});
