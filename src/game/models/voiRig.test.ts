// Cuts of buildVoiRig, checked on synthetic boxes placed in voi.glb's measured zones
// (no DOM/GLB parsing needed): each zone's triangles must land on the expected part,
// and the hierarchy must carry the quadruped pivots plus the rider saddle.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { buildVoiRig } from './voiRig';

function blob(cx: number, cy: number, cz: number, s = 0.3): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(s, s, s);
  g.translate(cx, cy, cz);
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3).fill(0.5);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of flat) n += g.getAttribute('position').count;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const ng of flat) {
    pos.set(ng.getAttribute('position').array as Float32Array, o * 3);
    col.set(ng.getAttribute('color').array as Float32Array, o * 3);
    o += ng.getAttribute('position').count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}

const ZONES: Array<[string, [number, number, number]]> = [
  ['body', [0, 6, -1]],
  ['head', [0, 6.5, 2.0]],
  // Ears are fused to the head (no silhouette hinge): ear blobs must stay head.
  ['head', [2.5, 7, 1.9]],
  ['head', [-2.5, 7, 1.9]],
  ['trunk1', [0, 5.5, 4.1]],
  ['trunk2', [0, 3, 4.9]],
  ['trunk3', [0, 1, 5.0]],
  ['legFL', [1.2, 4, 1.64]],
  ['shinFL', [1.2, 1, 1.64]],
  ['legBR', [-1.5, 4, -3.77]],
  ['shinBR', [-1.5, 1, -3.77]],
  ['tail', [0, 4, -5.4]],
];

test('voi zones classify onto the expected quadruped parts', () => {
  for (const [want, c] of ZONES) {
    const root = buildVoiRig(merge([blob(...c)]), 8.29);
    const parts = new Set<string>();
    root.traverse((o) => {
      if (o.userData.part) parts.add(o.userData.part as string);
    });
    assert.ok(parts.has(want), `${c} should land on ${want}, got ${[...parts]}`);
  }
});

test('voi rig keeps a saddle socket and one mesh per classified part', () => {
  const root = buildVoiRig(merge(ZONES.map(([, c]) => blob(...c))), 8.29);
  const sockets = new Set<string>();
  const meshes = new Map<string, number>();
  root.traverse((o) => {
    if (o.userData.socket) sockets.add(o.userData.socket as string);
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const parent = o.parent;
      const part = (parent?.userData.part as string | undefined) ?? '?';
      meshes.set(part, (meshes.get(part) ?? 0) + 1);
    }
  });
  assert.ok(sockets.has('saddle'), 'rider saddle socket missing');
  for (const [want] of ZONES) assert.equal(meshes.get(want), 1, `part ${want} should own exactly one mesh`);
});
