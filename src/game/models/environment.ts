// Low-poly scenery: trees (pine/oak/birch/dead/palm/cactus), rocks, bushes.
// Every variant is seeded, so the same map seed always grows the same forest.
import type * as THREE from 'three';
import type { BushParams, RockParams, TreeParams } from '@/shared/schema';
import { Rng, ball, beam, box, cone, detail, faceColors, jitter, limb, mesh, modelRoot, shade, sweep, type Vec3 } from './common';

export function createTreeModel(p: TreeParams, seed = 1): THREE.Group {
  const root = modelRoot(`tree-${p.type}`, 'static');
  const rng = new Rng(seed * 31 + 7);
  const h = p.height;
  const k = h / 7;
  const foliage = (geo: THREE.BufferGeometry, s: number) => faceColors(jitter(geo, 0.18 * k, seed * 13 + s), p.leaf, p.leaf2, seed * 17 + s);

  switch (p.type) {
    case 'pine': {
      root.add(mesh('trunk', beam([0, 0, 0], [0, h * 0.4, 0], 0.22 * k, 0.12 * k, 6), p.trunk));
      for (let i = 0; i < 4; i++) {
        const r = (1.55 - i * 0.32) * k * (0.9 + rng.next() * 0.2);
        const ch = 1.9 * k - i * 0.15 * k;
        root.add(mesh(`needles-${i}`, foliage(cone(r, ch, 7), i), p.leaf, [0, h * 0.3 + i * h * 0.15 + ch / 2, 0], [0, rng.next() * 3, 0]));
      }
      break;
    }
    case 'oak': {
      root.add(mesh('trunk', beam([0, 0, 0], [0, h * 0.5, 0], 0.32 * k, 0.2 * k, 7), p.trunk));
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + rng.next();
        root.add(detail(mesh(`branch-${i}`, beam([0, h * 0.4, 0], [Math.cos(a) * 1.1 * k, h * 0.62, Math.sin(a) * 1.1 * k], 0.12 * k, 0.07 * k, 5), p.trunk)));
      }
      const n = 4 + rng.int(2);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng.next() * 0.5;
        const d = i === 0 ? 0 : 0.9 * k;
        const r = (i === 0 ? 1.55 : 1.15 + rng.next() * 0.3) * k;
        root.add(mesh(`canopy-${i}`, foliage(ball(r, 1), i), p.leaf, [Math.cos(a) * d, h * (i === 0 ? 0.78 : 0.66 + rng.next() * 0.12), Math.sin(a) * d]));
      }
      break;
    }
    case 'birch': {
      root.add(mesh('trunk', beam([0, 0, 0], [0.1 * k, h * 0.75, 0], 0.16 * k, 0.1 * k, 6), p.trunk));
      for (let i = 0; i < 6; i++) {
        root.add(detail(mesh(`bark-mark-${i}`, box(0.12 * k, 0.05 * k, 0.05 * k), '#2a2622', [0.1 * k * Math.sin(i), h * (0.1 + i * 0.1), 0.13 * k], [0, i, 0])));
      }
      for (let i = 0; i < 3; i++) {
        root.add(mesh(`canopy-${i}`, foliage(ball(1, 1).scale(0.85 * k, 1.35 * k, 0.85 * k), i), p.leaf, [(rng.next() - 0.5) * 0.9 * k, h * (0.62 + i * 0.12), (rng.next() - 0.5) * 0.9 * k]));
      }
      break;
    }
    case 'dead': {
      root.add(mesh('trunk', beam([0, 0, 0], [0, h * 0.75, 0], 0.26 * k, 0.1 * k, 6), p.trunk));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + rng.next();
        const y = h * (0.35 + i * 0.1);
        const end: Vec3 = [Math.cos(a) * 1.3 * k, y + 0.9 * k, Math.sin(a) * 1.3 * k];
        root.add(mesh(`branch-${i}`, beam([0, y, 0], end, 0.1 * k, 0.03 * k, 4), p.trunk));
        root.add(detail(mesh(`twig-${i}`, beam(end, [end[0] * 1.3, end[1] + 0.6 * k, end[2] * 1.1], 0.03 * k, 0.01 * k, 3), p.trunk)));
      }
      break;
    }
    case 'palm': {
      const lean = (rng.next() - 0.5) * 1.2 * k;
      const pts: Vec3[] = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        pts.push([lean * t * t, h * t, 0]);
      }
      root.add(mesh('trunk', sweep(pts, [0.26 * k, 0.16 * k], 6), p.trunk));
      const top = pts[pts.length - 1];
      // Flatten each frond's cross-section around its own root, then move it to the crown.
      const frond = (from: Vec3, to: Vec3, r0: number, r1: number, s: number) =>
        faceColors(sweep([[0, 0, 0], [to[0] - from[0], to[1] - from[1], to[2] - from[2]]], [r0, r1], 3).scale(1, 0.35, 1).translate(from[0], from[1], from[2]), p.leaf, p.leaf2, seed + s);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + rng.next() * 0.3;
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        const mid: Vec3 = [top[0] + dx * 1.2 * k, top[1] + 0.5 * k, top[2] + dz * 1.2 * k];
        const tip: Vec3 = [top[0] + dx * 2.4 * k, top[1] - 1.1 * k, top[2] + dz * 2.4 * k];
        root.add(mesh(`frond-${i}a`, frond(top, mid, 0.26 * k, 0.2 * k, i), p.leaf));
        root.add(mesh(`frond-${i}b`, frond(mid, tip, 0.2 * k, 0.02 * k, i + 9), p.leaf));
      }
      for (let i = 0; i < 3; i++) root.add(detail(mesh(`coconut-${i}`, ball(0.14 * k, 0), '#6a4a2a', [top[0] + Math.cos(i * 2) * 0.2 * k, top[1] - 0.2 * k, top[2] + Math.sin(i * 2) * 0.2 * k])));
      break;
    }
    case 'cactus': {
      const col = (geo: THREE.BufferGeometry, s: number) => faceColors(geo, p.leaf, p.leaf2, seed + s, 0.6);
      const colR = 0.13 * h;
      const armR = 0.085 * h;
      const out = colR + 0.22 * h;
      root.add(mesh('column', col(limb(colR, h * 0.75, 7).translate(0, h * 0.75 + colR, 0), 1), p.leaf));
      for (const s of [1, -1]) {
        const y = h * (0.32 + rng.next() * 0.18);
        root.add(mesh(`arm-out-${s}`, col(beam([0, y, 0], [out * s, y, 0], armR, armR, 6), 2 + s), p.leaf));
        root.add(mesh(`arm-up-${s}`, col(limb(armR, 0.25 * h, 6).translate(out * s, y + 0.25 * h, 0), 4 + s), p.leaf));
      }
      break;
    }
  }
  return root;
}

export function createRockModel(p: RockParams, seed = 1): THREE.Group {
  const root = modelRoot('rock', 'static');
  const geo = jitter(ball(1, 1), 0.2 + p.roughness * 0.7, seed * 101 + 3).scale(1.05, p.flatness, 0.95);
  root.add(mesh('rock', faceColors(geo, p.color, p.color2, seed * 7), p.color, [0, p.flatness * 0.55, 0], [0, seed, 0]));
  if (seed % 2 === 1) {
    const pebble = jitter(ball(0.35, 0), 0.15, seed + 1).scale(1, p.flatness, 1);
    root.add(detail(mesh('pebble', faceColors(pebble, p.color2, p.color, seed + 2), p.color, [0.9, 0.15, 0.4])));
  }
  return root;
}

export function createBushModel(p: BushParams, seed = 1): THREE.Group {
  const root = modelRoot('bush', 'static');
  const rng = new Rng(seed * 53 + 1);
  const n = 3 + rng.int(3);
  for (let i = 0; i < n; i++) {
    const r = 0.42 + rng.next() * 0.25;
    const a = (i / n) * Math.PI * 2;
    const d = i === 0 ? 0 : 0.35;
    const geo = faceColors(jitter(ball(r, 1), 0.12, seed * 19 + i), p.leaf, p.leaf2, seed * 23 + i);
    root.add(mesh(`clump-${i}`, geo, p.leaf, [Math.cos(a) * d, r * 0.8, Math.sin(a) * d]));
    if (p.berries) {
      for (let j = 0; j < 3; j++) {
        const b = a + j * 2.1;
        root.add(detail(mesh(`berry-${i}-${j}`, ball(0.06, 0), p.berryColor, [Math.cos(a) * d + Math.cos(b) * r * 0.9, r * 0.8 + (rng.next() - 0.3) * r, Math.sin(a) * d + Math.sin(b) * r * 0.9])));
      }
    }
  }
  root.add(detail(mesh('bush-shadow-root', box(0.2, 0.1, 0.2), shade(p.leaf, 0.5), [0, 0.05, 0])));
  return root;
}
