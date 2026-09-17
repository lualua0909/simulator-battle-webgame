// Low-poly siege structures: wall blocks, watchtower, bow/gun/tesla towers, barracks and keep.
// Frame: forward +Z faces the enemy, y = 0 on the ground. Towers keep their weapon on a
// `turret` pivot (rig 'tower') that the animator yaws toward the target.
import * as THREE from 'three';
import type { StructureParams } from '@/shared/schema';
import { ball, beam, box, cone, cyl, detail, faceColors, jitter, mesh, metal, modelRoot, part, Rng, shade, socket, type Vec3 } from './common';

const TAU = Math.PI * 2;

/** `createAssetModel` swaps in an admin-uploaded glb before reaching here; this is always the procedural fallback. */
export function createStructureModel(p: StructureParams, seed = 1): THREE.Group {
  switch (p.type) {
    case 'wall':
    case 'brick-wall':
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

/** Kích thước khối tường chữ nhật (m): luôn khớp ô lưới 2×2 m để các bức tường xếp cạnh nhau không chồng lấn. */
export function wallFootprint(_p: StructureParams): { L: number; D: number } {
  return { L: 2, D: 2 };
}

/**
 * Khối tường chữ nhật vẽ bằng Three.js (nhẹ, không dùng glb):
 * - `wall` = tường đá trắng xám, khối đặc + gờ coping
 * - `brick-wall` = tường gạch vàng nâu, viền đen (đỉnh/đáy/cột góc/mạch vữa)
 * Hình duy nhất 1 BoxGeometry + vài trim gộp chung, render instanced nên rất nhẹ.
 */
export function wallBlockGeometry(p: StructureParams, height: number, seed: number): THREE.BufferGeometry {
  const { L, D } = wallFootprint(p);
  const H = Math.min(4, Math.max(0.5, height || 2));
  if (p.type === 'brick-wall') return brickWallBlock(p, L, H, D, seed);
  return stoneWallBlock(p, L, H, D, seed);
}

/** Tường đá: khối trắng xám + tấm coping trên đỉnh. */
function stoneWallBlock(p: StructureParams, L: number, H: number, D: number, seed: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(faceColors(new THREE.BoxGeometry(L, H, D).translate(0, H / 2, 0), p.stone, p.stone2, seed * 13 + 1));
  parts.push(faceColors(new THREE.BoxGeometry(L + 0.24, 0.16, D + 0.24).translate(0, H + 0.08, 0), shade(p.stone, 1.06), p.stone2, seed * 13 + 2));
  return mergeColored(parts);
}

/** Tường gạch: thân vàng nâu + viền đen (đỉnh, đáy, 4 cột góc, 2 mạch ngang). */
function brickWallBlock(p: StructureParams, L: number, H: number, D: number, seed: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trim = p.accent || '#1e1a16';
  const trimDark = shade(trim, 0.85);
  parts.push(faceColors(new THREE.BoxGeometry(L, H, D).translate(0, H / 2, 0), p.stone, p.stone2, seed * 13 + 1));
  // Viền đen đỉnh + đáy
  parts.push(faceColors(new THREE.BoxGeometry(L + 0.18, 0.14, D + 0.18).translate(0, H + 0.07, 0), trim, trimDark, seed + 101));
  parts.push(faceColors(new THREE.BoxGeometry(L + 0.12, 0.16, D + 0.12).translate(0, 0.08, 0), trimDark, trim, seed + 102));
  // 4 cột góc viền đen
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      parts.push(faceColors(new THREE.BoxGeometry(0.14, H, 0.14).translate((sx * L) / 2, H / 2, (sz * D) / 2), trim, trimDark, seed + sx * 7 + sz * 3));
    }
  }
  // 2 mạch vữa ngang viền đen (gợi khối gạch xếp lớp)
  for (const fy of [0.33, 0.66]) {
    parts.push(faceColors(new THREE.BoxGeometry(L + 0.03, 0.05, D + 0.03).translate(0, H * fy, 0), trimDark, trim, seed + Math.round(fy * 100)));
  }
  return mergeColored(parts);
}

/** Merlons and walkway lip on top of the highest block (origin = block top). */
export function wallCrownGeometry(p: StructureParams, seed: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const { L, D } = wallFootprint(p);
  const dark = shade(p.stone2, 0.9);
  const n = Math.max(2, Math.round(L));
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : -L / 2 + 0.5 + (i * (L - 1)) / (n - 1);
    for (const z of [-D / 2 + 0.25, D / 2 - 0.25]) {
      parts.push(faceColors(new THREE.BoxGeometry(0.5, 0.5, 0.4).translate(x, 0.25, z), p.stone, dark, seed + x * 7 + z * 3));
    }
  }
  parts.push(faceColors(new THREE.BoxGeometry(L, 0.08, D).translate(0, 0.04, 0), shade(p.stone, 1.08), p.stone, seed + 5));
  return mergeColored(parts);
}

/** Collapsed stones lying where a wall cell stood. */
export function wallRubbleGeometry(p: StructureParams, seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed * 31 + 7);
  const { L, D } = wallFootprint(p);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const r = 0.25 + rng.next() * 0.3;
    const g = jitter(new THREE.IcosahedronGeometry(r, 0), r * 0.4, seed + i).scale(1, 0.6, 1);
    g.rotateY(rng.next() * TAU).translate((rng.next() - 0.5) * L * 0.9, r * 0.35, (rng.next() - 0.5) * D * 0.9);
    parts.push(faceColors(g, p.stone, p.stone2, seed * 3 + i));
  }
  const heap = jitter(new THREE.IcosahedronGeometry(0.9, 1), 0.35, seed + 99).scale(L / 2.5, 0.35, D / 2.5);
  parts.push(faceColors(heap, shade(p.stone2, 0.85), p.stone2, seed + 11));
  return mergeColored(parts);
}

/** Dark crack lines on the four faces of a block (drawn when the top block is damaged). */
export function wallCrackGeometry(p: StructureParams, height: number, seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed * 17 + 3);
  const tris: number[] = [];
  const { L, D } = wallFootprint(p);
  const hx = L / 2 + 0.012;
  const hz = D / 2 + 0.012;
  for (let face = 0; face < 4; face++) {
    const off = face < 2 ? hz : hx;
    const span = face < 2 ? L : D;
    for (let c = 0; c < 2; c++) {
      let u = (rng.next() - 0.5) * (span - 0.6);
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
              return [a, b, off];
            case 1:
              return [-a, b, -off];
            case 2:
              return [off, b, -a];
            default:
              return [-off, b, a];
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
  const root = modelRoot(p.type === 'brick-wall' ? 'brick-wall' : 'wall', 'static');
  const h = Math.min(4, Math.max(0.5, Number(p.wallHeight) || 2));
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

/** Open post-and-beam shed with a gable roof (Quaternius "Barracks" reference). */
function barracksModel(p: StructureParams, seed: number): THREE.Group {
  const root = modelRoot('barracks', 'static');
  const dark = shade(p.wood, 0.7);
  const silver = '#c9d2da';

  const cx = 1.3;
  const cz = 1.05;
  const eave = 1.55;
  const apex = 2.4;
  const corners: Vec3[] = [
    [cx, 0, cz],
    [-cx, 0, cz],
    [cx, 0, -cz],
    [-cx, 0, -cz],
  ];
  corners.forEach(([x, , z], i) => {
    root.add(stone(`plinth-${i}`, box(0.34, 0.3, 0.34), p, seed + i, [x, 0.15, z]));
    root.add(mesh(`post-band-${i}`, box(0.24, 0.45, 0.24), p.accent, [x, 0.525, z]));
    root.add(mesh(`post-${i}`, box(0.22, eave - 0.75, 0.22), p.wood, [x, 0.75 + (eave - 0.75) / 2, z]));
  });

  for (const z of [cz, -cz]) root.add(mesh(`plate-x-${z}`, box(2 * cx - 0.16, 0.14, 0.14), dark, [0, eave, z]));
  for (const x of [cx, -cx]) root.add(mesh(`plate-z-${x}`, box(0.14, 0.14, 2 * cz - 0.16), dark, [x, eave, 0]));
  for (const z of [cz, -cz]) for (const x of [-cx * 0.5, 0, cx * 0.5]) root.add(detail(mesh(`stud-x-${x}-${z}`, box(0.09, eave - 0.3, 0.09), p.wood, [x, 0.3 + (eave - 0.3) / 2, z])));
  for (const x of [cx, -cx]) for (const z of [-cz * 0.35, cz * 0.35]) root.add(detail(mesh(`stud-z-${x}-${z}`, box(0.09, eave - 0.3, 0.09), p.wood, [x, 0.3 + (eave - 0.3) / 2, z])));

  const rw = cx + 0.35;
  const rise = apex - eave;
  const angle = Math.atan2(rise, rw);
  const slopeLen = Math.hypot(rw, rise);
  const roofLen = 2 * cz + 0.6;
  for (const s of [1, -1]) {
    root.add(
      mesh(
        `roof-${s}`,
        faceColors(new THREE.BoxGeometry(slopeLen, 0.12, roofLen, 6, 1, 1), p.roof, shade(p.roof, 0.82), seed * 5 + s + 20),
        p.roof,
        [(s * rw) / 2, (apex + eave) / 2, 0],
        [0, 0, -s * angle],
      ),
    );
  }
  root.add(mesh('ridge', box(0.16, 0.16, roofLen), dark, [0, apex, 0]));

  for (const z of [cz, -cz]) {
    root.add(detail(mesh(`king-post-${z}`, box(0.1, apex - eave, 0.1), dark, [0, (eave + apex) / 2, z])));
    for (const x of [cx, -cx]) root.add(detail(mesh(`rafter-brace-${x}-${z}`, beam([x, eave, z], [0, apex, z], 0.05, 0.05, 4), dark)));
  }

  const swordZ = cz + 0.04;
  root.add(detail(mesh('sword-a', box(0.09, 0.9, 0.04), silver, [0, eave - 0.35, swordZ], [0, 0, 0.7])));
  root.add(detail(mesh('sword-b', box(0.09, 0.9, 0.04), silver, [0, eave - 0.35, swordZ], [0, 0, -0.7])));
  root.add(detail(mesh('sword-hilt', ball(0.08, 0), p.accent, [0, eave - 0.35, swordZ])));

  root.add(mesh('crate', box(0.5, 0.45, 0.5), shade(p.wood, 1.15), [0.35, 0.225, -cz + 0.35]));
  return root;
}

function keepModel(p: StructureParams, seed: number): THREE.Group {
  const root = modelRoot('keep', 'static');
  const capStone = shade(p.stone, 0.85);
  const doorBlue = '#1f3f7a';
  const doorPanel = '#3a6bc0';

  root.add(stone('base', box(6.2, 0.8, 6.2), p, seed, [0, 0.4, 0]));
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    root.add(detail(mesh(`snow-${i}`, ball(0.22, 0), '#e8ecf0', [Math.cos(a) * 3.05, 0.12, Math.sin(a) * 3.05])));
  }
  root.add(stone('hall', box(5, 5.2, 5), p, seed + 1, [0, 3.4, 0]));
  root.add(stone('cornice', box(5.4, 0.3, 5.4), p, seed + 2, [0, 6.15, 0]));
  for (let i = 0; i < 16; i++) {
    const side = Math.floor(i / 4);
    const t = ((i % 4) - 1.5) * 1.2;
    const pos: Vec3 = side === 0 ? [t, 6.75, 2.6] : side === 1 ? [t, 6.75, -2.6] : side === 2 ? [2.6, 6.75, t] : [-2.6, 6.75, t];
    root.add(detail(stone(`merlon-${i}`, box(0.55, 0.6, 0.45), p, seed + 30 + i, pos)));
  }
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const x = 2.5 * sx;
      const z = 2.5 * sz;
      root.add(stone(`turret-${sx}${sz}`, cyl(0.8, 0.85, 6, 8), p, seed + 5 + sx + sz * 2, [x, 3.8, z]));
      root.add(mesh(`turret-cap-${sx}${sz}`, cone(1.05, 0.9, 7), capStone, [x, 7.25, z]));
    }
  }

  root.add(mesh('roof-wood', box(4.6, 0.3, 4.6), p.wood, [0, 6.45, 0]));
  const seams = new THREE.Group();
  seams.position.set(0, 6.61, 0);
  seams.rotation.y = Math.PI / 4;
  for (const [d, len] of [
    [-1.6, 1.9],
    [-0.8, 4.1],
    [0, 6.3],
    [0.8, 4.1],
    [1.6, 1.9],
  ] as const) {
    seams.add(detail(mesh(`seam-${d}`, box(0.07, 0.05, len), shade(p.wood, 0.65), [d, 0, 0])));
  }
  root.add(seams);

  for (const s of [-1, 1]) {
    root.add(mesh(`door-${s}`, box(0.85, 1.6, 0.14), doorBlue, [0.5 * s, 1.6, 3.17]));
    root.add(detail(mesh(`door-panel-${s}`, box(0.6, 1.3, 0.05), doorPanel, [0.5 * s, 1.55, 3.22])));
  }
  root.add(detail(stone('door-arch', box(2.3, 0.35, 0.35), p, seed + 9, [0, 2.55, 3.15])));
  root.add(socket('muzzle', [0, 6.8, 3]));
  return root;
}
