// Low-poly siege structures: wall blocks, watchtower, bow/gun/tesla towers, barracks and keep.
// Frame: forward +Z faces the enemy, y = 0 on the ground. Towers keep their weapon on a
// `turret` pivot (rig 'tower') that the animator yaws toward the target.
import * as THREE from 'three';
import type { StructureParams } from '@/shared/schema';
import { WALL_CELL } from '../sim/terrain';
import { ball, beam, box, cone, cyl, detail, faceColors, jitter, mesh, metal, modelRoot, part, Rng, shade, socket, type Vec3 } from './common';

const TAU = Math.PI * 2;

export function createStructureModel(p: StructureParams, seed = 1): THREE.Group {
  switch (p.type) {
    case 'wall':
      return wallModel(p, seed);
    case 'watchtower':
      return watchtowerModel(p);
    case 'bow-tower':
      return bowTowerModel(p, seed);
    case 'gun-tower':
      return gunTowerModel(p, seed);
    case 'tesla':
      return teslaModel(p, seed);
    case 'barracks':
      return barracksModel(p, seed);
    case 'keep':
      return keepModel(p, seed);
  }
}

// ---------------------------------------------------------------- wall pieces

/** Stone cube of one tier, brick-patched by face colours. */
export function wallBlockGeometry(p: StructureParams, height: number, seed: number): THREE.BufferGeometry {
  const s = WALL_CELL;
  const g = jitter(new THREE.BoxGeometry(s, height, s, 3, 2, 3), 0.05, seed).translate(0, height / 2, 0);
  return faceColors(g, p.stone, p.stone2, seed * 13 + 1);
}

/** Merlons and walkway lip on top of the highest block (origin = block top). */
export function wallCrownGeometry(p: StructureParams, seed: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const h = WALL_CELL / 2;
  const dark = shade(p.stone2, 0.9);
  for (const [x, z] of [
    [-h + 0.25, -h + 0.25],
    [h - 0.25, -h + 0.25],
    [-h + 0.25, h - 0.25],
    [h - 0.25, h - 0.25],
  ] as const) {
    parts.push(faceColors(new THREE.BoxGeometry(0.5, 0.5, 0.5).translate(x, 0.25, z), p.stone, dark, seed + x * 7 + z * 3));
  }
  parts.push(faceColors(new THREE.BoxGeometry(WALL_CELL, 0.08, WALL_CELL).translate(0, 0.04, 0), shade(p.stone, 1.08), p.stone, seed + 5));
  return mergeColored(parts);
}

/** Collapsed stones lying where a wall cell stood. */
export function wallRubbleGeometry(p: StructureParams, seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed * 31 + 7);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const r = 0.25 + rng.next() * 0.3;
    const g = jitter(new THREE.IcosahedronGeometry(r, 0), r * 0.4, seed + i).scale(1, 0.6, 1);
    g.rotateY(rng.next() * TAU).translate((rng.next() - 0.5) * 1.8, r * 0.35, (rng.next() - 0.5) * 1.8);
    parts.push(faceColors(g, p.stone, p.stone2, seed * 3 + i));
  }
  const heap = jitter(new THREE.IcosahedronGeometry(0.9, 1), 0.35, seed + 99).scale(1.1, 0.35, 1.1);
  parts.push(faceColors(heap, shade(p.stone2, 0.85), p.stone2, seed + 11));
  return mergeColored(parts);
}

/** Dark crack lines on the four faces of a block (drawn when the top block is damaged). */
export function wallCrackGeometry(height: number, seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed * 17 + 3);
  const tris: number[] = [];
  const h = WALL_CELL / 2 + 0.012;
  for (let face = 0; face < 4; face++) {
    for (let c = 0; c < 2; c++) {
      let u = (rng.next() - 0.5) * 1.4;
      let v = height * (0.25 + rng.next() * 0.6);
      for (let k = 0; k < 4; k++) {
        const nu = u + (rng.next() - 0.5) * 0.7;
        const nv = v + (rng.next() - 0.6) * height * 0.35;
        const w = 0.05;
        const quad: Array<[number, number]> = [
          [u - w, v],
          [u + w, v],
          [nu + w * 0.6, nv],
          [nu - w * 0.6, nv],
        ];
        const P = (q: [number, number]): Vec3 => {
          const [a, b] = q;
          switch (face) {
            case 0:
              return [a, b, h];
            case 1:
              return [-a, b, -h];
            case 2:
              return [h, b, -a];
            default:
              return [-h, b, a];
          }
        };
        const [q0, q1, q2, q3] = quad.map(P);
        tris.push(...q0, ...q1, ...q2, ...q0, ...q2, ...q3);
        u = nu;
        v = Math.max(0.05, Math.min(height - 0.05, nv));
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
  g.computeVertexNormals();
  return g;
}

function mergeColored(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  const flat = list.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of flat) n += g.getAttribute('position').count;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const g of flat) {
    pos.set(g.getAttribute('position').array as Float32Array, o);
    col.set(g.getAttribute('color').array as Float32Array, o);
    o += g.getAttribute('position').count * 3;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}

function wallModel(p: StructureParams, seed: number): THREE.Group {
  const root = modelRoot('wall', 'static');
  const h = 1.6;
  root.add(mesh('block', wallBlockGeometry(p, h, seed), p.stone));
  root.add(detail(mesh('crown', wallCrownGeometry(p, seed), p.stone, [0, h, 0])));
  return root;
}

// ---------------------------------------------------------------- shared bits

function stone(name: string, geo: THREE.BufferGeometry, p: StructureParams, seed: number, pos: Vec3 = [0, 0, 0], rot: Vec3 = [0, 0, 0]): THREE.Mesh {
  return mesh(name, faceColors(jitter(geo, 0.04, seed), p.stone, p.stone2, seed * 7 + 3), p.stone, pos, rot);
}

/** Ring of merlons on top of a round tower. */
function merlonRing(name: string, p: StructureParams, r: number, y: number, count: number, seed: number): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU;
    out.push(detail(stone(`${name}-${i}`, box(0.45, 0.5, 0.35), p, seed + i, [Math.sin(a) * r, y + 0.25, Math.cos(a) * r], [0, a, 0])));
  }
  return out;
}

function flag(name: string, p: StructureParams, pos: Vec3, height: number): THREE.Group {
  const pole = part(name, pos);
  pole.add(mesh(`${name}-pole`, cyl(0.04, 0.05, height, 5), shade(p.wood, 0.8), [0, height / 2, 0]));
  pole.add(detail(mesh(`${name}-cloth`, box(0.04, 0.55, 0.9), p.roof, [0, height - 0.35, 0.47])));
  pole.add(detail(mesh(`${name}-knob`, ball(0.08, 0), p.accent, [0, height + 0.05, 0])));
  return pole;
}

// ---------------------------------------------------------------- watchtower

function watchtowerModel(p: StructureParams): THREE.Group {
  const root = modelRoot('watchtower', 'static');
  const top = 6;
  const dark = shade(p.wood, 0.72);
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      root.add(mesh(`leg-${sx}${sz}`, beam([0.95 * sx, 0, 0.95 * sz], [0.75 * sx, top - 0.2, 0.75 * sz], 0.12, 0.1, 5), p.wood));
      root.add(detail(stone(`foot-${sx}${sz}`, box(0.45, 0.35, 0.45), p, 4 + sx * 2 + sz, [0.95 * sx, 0.17, 0.95 * sz])));
    }
  }
  for (const y of [1.6, 3.6]) {
    for (const [a, b] of [
      [[0.9, y, 0.9], [-0.85, y + 1.5, 0.85]],
      [[-0.9, y, -0.9], [0.85, y + 1.5, -0.85]],
      [[0.9, y, -0.9], [0.85, y + 1.5, 0.85]],
      [[-0.9, y, 0.9], [-0.85, y + 1.5, -0.85]],
    ] as Array<[Vec3, Vec3]>) {
      root.add(detail(mesh(`brace-${y}-${a[0]}${a[2]}`, beam(a, b, 0.05, 0.05, 4), dark)));
    }
  }
  root.add(mesh('deck', box(2.1, 0.22, 2.1), p.wood, [0, top - 0.11, 0]));
  for (const i of [-1, 0, 1]) root.add(detail(mesh(`plank-${i}`, box(0.62, 0.03, 2.05), shade(p.wood, 1.1), [i * 0.68, top + 0.01, 0])));
  for (const [x, z, w, d] of [
    [0, 1, 2.1, 0.08],
    [0, -1, 2.1, 0.08],
    [1, 0, 0.08, 2.1],
    [-1, 0, 0.08, 2.1],
  ] as const) {
    root.add(detail(mesh(`rail-${x}${z}`, box(w, 0.08, d), dark, [x, top + 0.55, z])));
  }
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      root.add(mesh(`post-${sx}${sz}`, box(0.12, 2.5, 0.12), dark, [sx, top + 1.25, sz]));
    }
  }
  root.add(mesh('roof', cone(1.75, 1.3, 4), p.roof, [0, top + 3.1, 0], [0, Math.PI / 4, 0]));
  for (let k = 0; k < 7; k++) root.add(detail(mesh(`ladder-${k}`, box(0.7, 0.06, 0.06), dark, [0, 0.5 + k * 0.8, 1.02])));
  root.add(flag('flag', p, [0, top + 3.7, 0], 1.3));
  return root;
}

// ---------------------------------------------------------------- towers

function roundTowerBase(root: THREE.Group, p: StructureParams, seed: number, height: number, r: number): void {
  root.add(stone('plinth', cyl(r + 0.25, r + 0.4, 0.6, 8), p, seed, [0, 0.3, 0]));
  root.add(stone('shaft', cyl(r, r + 0.2, height, 8), p, seed + 1, [0, height / 2 + 0.5, 0]));
  root.add(stone('ledge', cyl(r + 0.25, r, 0.35, 8), p, seed + 2, [0, height + 0.6, 0]));
  root.add(...merlonRing('merlon', p, r + 0.05, height + 0.78, 8, seed + 10));
  root.add(detail(mesh('slit-front', box(0.14, 0.7, 0.1), '#1e1a16', [0, height * 0.55, r + 0.12])));
  root.add(detail(mesh('door', box(0.8, 1.3, 0.12), shade(p.wood, 0.8), [0, 1.15, r + 0.2])));
}

function bowTowerModel(p: StructureParams, seed: number): THREE.Group {
  const root = modelRoot('bow-tower', 'tower');
  roundTowerBase(root, p, seed, 5, 1.2);
  const turret = part('turret', [0, 5.85, 0]);
  const dark = shade(p.wood, 0.7);
  turret.add(mesh('pivot', cyl(0.25, 0.35, 0.5, 6), dark, [0, 0.25, 0]));
  turret.add(mesh('stock', box(0.28, 0.22, 1.9), p.wood, [0, 0.6, 0.25]));
  turret.add(mesh('bow-arms', beam([-1.05, 0.62, 0.95], [1.05, 0.62, 0.95], 0.06, 0.06, 5), dark));
  for (const s of [1, -1]) turret.add(detail(mesh(`bow-tip-${s}`, beam([1.05 * s, 0.62, 0.95], [1.1 * s, 0.62, 0.7], 0.05, 0.03, 4), dark)));
  turret.add(detail(mesh('string', beam([-1.08, 0.62, 0.72], [1.08, 0.62, 0.72], 0.012, 0.012, 3), '#e8dcc0')));
  turret.add(detail(metal('bolt', beam([0, 0.75, -0.4], [0, 0.75, 1.3], 0.03, 0.03, 4), '#c9ced6')));
  turret.add(detail(mesh('shield', box(1.2, 0.7, 0.08), p.roof, [0, 0.75, -0.55])));
  turret.add(socket('muzzle', [0, 0.75, 1.3]));
  root.add(turret);
  root.add(flag('flag', p, [0.9, 5.9, -0.6], 1.6));
  return root;
}

function gunTowerModel(p: StructureParams, seed: number): THREE.Group {
  const root = modelRoot('gun-tower', 'tower');
  root.add(stone('base', box(2.8, 0.7, 2.8), p, seed, [0, 0.35, 0]));
  root.add(stone('body', box(2.4, 4, 2.4), p, seed + 1, [0, 2.7, 0]));
  root.add(stone('cornice', box(2.8, 0.3, 2.8), p, seed + 2, [0, 4.85, 0]));
  for (let i = 0; i < 12; i++) {
    const side = Math.floor(i / 3);
    const t = ((i % 3) - 1) * 0.9;
    const pos: Vec3 = side === 0 ? [t, 5.25, 1.25] : side === 1 ? [t, 5.25, -1.25] : side === 2 ? [1.25, 5.25, t] : [-1.25, 5.25, t];
    root.add(detail(stone(`merlon-${i}`, box(0.4, 0.5, 0.4), p, seed + 20 + i, pos)));
  }
  root.add(detail(mesh('door', box(0.9, 1.4, 0.1), shade(p.wood, 0.8), [0, 1.4, 1.22])));
  for (const s of [1, -1]) root.add(detail(mesh(`band-${s}`, box(2.45, 0.12, 2.45), shade(p.stone2, 0.8), [0, 2.1 + s * 1.2, 0])));
  const turret = part('turret', [0, 5, 0]);
  turret.add(mesh('carriage', box(0.9, 0.5, 1.1), p.wood, [0, 0.35, 0]));
  for (const s of [1, -1]) turret.add(detail(mesh(`wheel-${s}`, cyl(0.32, 0.32, 0.12, 8), shade(p.wood, 0.7), [0.5 * s, 0.3, 0.1], [0, 0, Math.PI / 2])));
  turret.add(metal('barrel', cyl(0.14, 0.22, 1.9, 8), p.roof, [0, 0.8, 0.55], [Math.PI / 2 - 0.08, 0, 0]));
  turret.add(detail(metal('muzzle-ring', cyl(0.19, 0.19, 0.12, 8), p.accent, [0, 0.87, 1.45], [Math.PI / 2 - 0.08, 0, 0])));
  turret.add(detail(metal('breech', ball(0.24, 0), p.roof, [0, 0.74, -0.4])));
  turret.add(socket('muzzle', [0, 0.88, 1.55]));
  root.add(turret);
  return root;
}

function teslaModel(p: StructureParams, seed: number): THREE.Group {
  const root = modelRoot('tesla', 'tower');
  root.add(stone('plinth', cyl(1.05, 1.25, 0.8, 6), p, seed, [0, 0.4, 0]));
  root.add(stone('step', cyl(0.8, 0.95, 0.5, 6), p, seed + 1, [0, 1.05, 0]));
  root.add(metal('column', cyl(0.22, 0.32, 3.6, 7), '#5a5048', [0, 3.1, 0]));
  for (let i = 0; i < 4; i++) {
    const y = 2 + i * 0.8;
    const r = 0.75 - i * 0.12;
    root.add(detail(metal(`coil-${i}`, new THREE.TorusGeometry(r, 0.09, 5, 10).rotateX(Math.PI / 2), '#c8783a', [0, y, 0])));
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    root.add(detail(metal(`strut-${i}`, beam([Math.sin(a) * 0.9, 1.2, Math.cos(a) * 0.9], [Math.sin(a) * 0.25, 4.2, Math.cos(a) * 0.25], 0.05, 0.04, 4), '#4a4038')));
  }
  const turret = part('turret', [0, 5.2, 0]);
  turret.add(mesh('orb', ball(0.55, 1), p.accent, [0, 0.3, 0], [0, 0, 0], { emissive: 1.4 }));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    turret.add(detail(metal(`prong-${i}`, beam([Math.sin(a) * 0.35, -0.1, Math.cos(a) * 0.35], [Math.sin(a) * 0.75, 0.55, Math.cos(a) * 0.75], 0.05, 0.02, 4), '#c8783a')));
  }
  turret.add(socket('staff.tip', [0, 0.3, 0]));
  root.add(turret);
  return root;
}

// ---------------------------------------------------------------- buildings

function gable(name: string, color: string, w: number, d: number, h: number, pos: Vec3): THREE.Mesh {
  const hw = w / 2;
  const hd = d / 2;
  const shape = new THREE.Shape([new THREE.Vector2(-hw, 0), new THREE.Vector2(hw, 0), new THREE.Vector2(0, h)]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false }).translate(0, 0, -hd);
  return mesh(name, g, color, pos);
}

function barracksModel(p: StructureParams, seed: number): THREE.Group {
  const root = modelRoot('barracks', 'static');
  const dark = shade(p.wood, 0.7);
  root.add(stone('foundation', box(4.6, 0.6, 3.8), p, seed, [0, 0.3, 0]));
  root.add(mesh('walls', faceColors(box(4.2, 2.2, 3.4), p.wood, shade(p.wood, 0.85), seed + 2), p.wood, [0, 1.7, 0]));
  for (const x of [-2.05, 2.05]) for (const z of [-1.65, 1.65]) root.add(detail(mesh(`beam-${x}${z}`, box(0.22, 2.3, 0.22), dark, [x, 1.75, z])));
  root.add(detail(mesh('lintel', box(4.35, 0.2, 0.22), dark, [0, 2.85, 1.65])));
  root.add(gable('roof', p.roof, 5, 4.2, 1.7, [0, 2.8, 0]));
  root.add(detail(mesh('ridge', box(0.18, 0.18, 4.3), shade(p.roof, 0.7), [0, 4.5, 0])));
  root.add(mesh('door', box(1.2, 1.7, 0.12), dark, [0, 1.45, 1.74]));
  root.add(detail(mesh('door-arch', box(1.45, 0.2, 0.16), p.accent, [0, 2.35, 1.76])));
  for (const s of [1, -1]) {
    root.add(detail(mesh(`window-${s}`, box(0.6, 0.55, 0.1), '#2a2016', [1.35 * s, 1.95, 1.72])));
    root.add(detail(mesh(`shield-${s}`, cyl(0.32, 0.32, 0.08, 8), p.roof, [1.35 * s, 1.1, 1.76], [Math.PI / 2, 0, 0])));
  }
  root.add(detail(mesh('crates', box(0.7, 0.6, 0.7), shade(p.wood, 1.1), [2.6, 0.9, 0.8])));
  root.add(detail(mesh('spears', beam([-2.6, 0.6, 1.1], [-2.5, 2.6, 1.3], 0.04, 0.03, 4), shade(p.wood, 1.2))));
  root.add(flag('flag', p, [2.4, 0.6, -1.95], 4.6));
  return root;
}

function keepModel(p: StructureParams, seed: number): THREE.Group {
  const root = modelRoot('keep', 'static');
  const dark = shade(p.wood, 0.7);
  root.add(stone('base', box(6.2, 0.8, 6.2), p, seed, [0, 0.4, 0]));
  root.add(stone('hall', box(5, 5.6, 5), p, seed + 1, [0, 3.6, 0]));
  root.add(stone('cornice', box(5.5, 0.35, 5.5), p, seed + 2, [0, 6.5, 0]));
  for (let i = 0; i < 16; i++) {
    const side = Math.floor(i / 4);
    const t = ((i % 4) - 1.5) * 1.2;
    const pos: Vec3 = side === 0 ? [t, 6.95, 2.55] : side === 1 ? [t, 6.95, -2.55] : side === 2 ? [2.55, 6.95, t] : [-2.55, 6.95, t];
    root.add(detail(stone(`merlon-${i}`, box(0.55, 0.6, 0.45), p, seed + 30 + i, pos)));
  }
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const x = 2.75 * sx;
      const z = 2.75 * sz;
      root.add(stone(`turret-${sx}${sz}`, cyl(0.85, 0.95, 7.6, 7), p, seed + 5 + sx + sz * 2, [x, 3.8, z]));
      root.add(mesh(`turret-roof-${sx}${sz}`, cone(1.15, 1.9, 7), p.roof, [x, 8.55, z]));
      root.add(detail(mesh(`turret-slit-${sx}${sz}`, box(0.12, 0.6, 0.1), '#1e1a16', [x, 5.2, z + 0.88 * sz])));
    }
  }
  root.add(mesh('roof', cone(2.6, 2.4, 4), p.roof, [0, 8, 0], [0, Math.PI / 4, 0]));
  root.add(mesh('gate', box(1.6, 2.4, 0.15), dark, [0, 1.9, 2.52]));
  root.add(detail(stone('gate-arch', box(2.1, 0.45, 0.3), p, seed + 9, [0, 3.2, 2.55])));
  for (let i = -1; i <= 1; i++) root.add(detail(metal(`portcullis-${i}`, box(0.06, 2.3, 0.05), '#3a3632', [i * 0.45, 1.9, 2.62])));
  for (const s of [1, -1]) {
    root.add(detail(mesh(`window-${s}`, box(0.5, 0.9, 0.1), '#1e1a16', [1.3 * s, 4.6, 2.52])));
    root.add(detail(mesh(`banner-${s}`, box(0.7, 1.6, 0.06), p.roof, [1.3 * s, 2.6, 2.56])));
    root.add(detail(mesh(`banner-emblem-${s}`, ball(0.16, 0), p.accent, [1.3 * s, 2.8, 2.6])));
  }
  root.add(flag('flag', p, [0, 9.1, 0], 1.8));
  root.add(socket('muzzle', [0, 7.2, 2.6]));
  return root;
}
