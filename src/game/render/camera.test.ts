// RTS camera geometry: the view centres on the part of the screen the UI leaves uncovered, frames a deployment zone
// inside it, and the map bounds leave that framing alone.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { SEED } from '@/shared/seed';
import { Terrain, type Side } from '../sim/terrain';
import { RtsCamera, type ViewInsets } from './camera';

// The controller only registers input listeners on these.
const noEvents = { addEventListener() {}, removeEventListener() {} };
(globalThis as { window?: unknown }).window ??= noEvents;

function setup(width: number, height: number, insets: ViewInsets, sides?: Side[]) {
  const dom = { ...noEvents, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width, height }) } as unknown as HTMLElement;
  const rts = new RtsCamera(new THREE.PerspectiveCamera(50, 1, 0.3, 1400), dom);
  const map = SEED.maps.find((m) => m.id === 'deo-song')!;
  const terrain = new Terrain(map, SEED.assets, null, sides);
  rts.setTerrain(terrain);
  rts.resize(width, height);
  rts.setInsets(insets);
  return { rts, terrain };
}

/** Screen pixel of a world point through the live camera. */
function pixel(rts: RtsCamera, p: THREE.Vector3, width: number, height: number): { x: number; y: number } {
  const v = p.clone().project(rts.camera);
  return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height };
}

function zoneCorners(terrain: Terrain, side: Side): THREE.Vector3[] {
  const z = terrain.zoneOf(side);
  const out: THREE.Vector3[] = [];
  for (const x of [z.x0, z.x1]) for (const zz of [z.z0, z.z1]) out.push(new THREE.Vector3(x, terrain.height(x, zz), zz));
  return out;
}

test('the aim point shows at the centre of the uncovered area', () => {
  const { rts } = setup(1440, 860, { top: 164, right: 0, bottom: 373, left: 0 });
  rts.jumpTo({ target: new THREE.Vector3(-20, 0, 10), yaw: 2, pitch: 0.9, distance: 60 });
  const at = pixel(rts, rts.target, 1440, 860);
  assert.ok(Math.abs(at.x - 720) < 0.5, `x ${at.x}`);
  assert.ok(Math.abs(at.y - (164 + (860 - 373)) / 2) < 0.5, `y ${at.y}`);
});

test('a fitted deployment zone sits inside the uncovered area and the map bounds keep it there', () => {
  const cases: Array<{ width: number; height: number; insets: ViewInsets; sides?: Side[]; yaw: number; max: number }> = [
    // Desktop, two sides: the long strip along the map's edge.
    { width: 1440, height: 860, insets: { top: 164, right: 0, bottom: 373, left: 0 }, yaw: Math.PI, max: 160 },
    // Laptop, four sides: a corner square seen diagonally — both sides of that view reach past the map.
    { width: 1280, height: 680, insets: { top: 164, right: 0, bottom: 298, left: 0 }, sides: ['blue', 'red', 'green', 'yellow'], yaw: Math.PI / 4, max: 160 },
  ];
  for (const c of cases) {
    const { rts, terrain } = setup(c.width, c.height, c.insets, c.sides);
    const corners = zoneCorners(terrain, 'blue');
    const view = rts.fit(corners, c.yaw, 0.9, c.max);
    rts.jumpTo(view);
    assert.ok(rts.target.distanceTo(view.target) < 0.01, 'the bounds moved the fitted view');
    const px = corners.map((p) => pixel(rts, p, c.width, c.height));
    for (const p of px) {
      assert.ok(p.x >= c.insets.left - 1 && p.x <= c.width - c.insets.right + 1, `corner x ${p.x}`);
      assert.ok(p.y >= c.insets.top - 1 && p.y <= c.height - c.insets.bottom + 1, `corner y ${p.y}`);
    }
    // As close as it fits: the zone fills the room across or down.
    const w = Math.max(...px.map((p) => p.x)) - Math.min(...px.map((p) => p.x));
    const h = Math.max(...px.map((p) => p.y)) - Math.min(...px.map((p) => p.y));
    const room = { w: c.width - c.insets.left - c.insets.right, h: c.height - c.insets.top - c.insets.bottom };
    assert.ok(w > room.w * 0.85 || h > room.h * 0.85, `zone ${w.toFixed(0)}×${h.toFixed(0)} in room ${room.w}×${room.h}`);
  }
});

test('zoomed all the way out the map stays centred across the uncovered area', () => {
  const { rts, terrain } = setup(1440, 860, { top: 164, right: 0, bottom: 373, left: 0 });
  rts.setView(Math.PI, 0.9, 1000);
  rts.focus(terrain.half, terrain.half);
  for (let i = 0; i < 200; i++) rts.update(1 / 30);
  // Looking along +x, the view's width lies along z.
  assert.ok(Math.abs(rts.target.z) < 2, `z ${rts.target.z}`);
});
