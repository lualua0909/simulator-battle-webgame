// Low-poly treasure chest of the reward boxes (chest rig). The `base` part holds the body,
// frame, feet and lock; the `lid` part pivots on the back hinge so it can swing open; socket
// `glow` sits inside the box, where the light of an opening chest comes from.
//
// Six looks rebuilt by eye from the reference sheet the user supplied (wooden, silver, golden,
// giant, magical, super magical): a stylised, reference-free reconstruction following the
// img2threejs conventions in common.ts — not a measured one, and the hidden back is inferred.
import * as THREE from 'three';
import type { ChestVariant } from '@/shared/schema';
import { box, cone, detail, metal, mesh, modelRoot, part, Rng, shade, socket } from './common';

export interface ChestParams {
  /** wood: plank rows; enamel: glossy panels lighter at the top; crystal: glowing facets. */
  finish: 'wood' | 'enamel' | 'crystal';
  body: string;
  body2: string;
  /** Frame, corner posts and lid bands. */
  trim: string;
  /** Rivets and feet. */
  trimDark: string;
  plate: string;
  lock: 'keyhole' | 'double-keyhole' | 'gem';
  /** Keyhole or gem colour. */
  lockColor: string;
  ornament: 'none' | 'spikes' | 'crest' | 'studs';
  accent: string;
  /** Width multiplier: the giant chest is wider. */
  width: number;
}

export const CHEST_PRESETS: Record<ChestVariant, ChestParams> = {
  wooden: { finish: 'wood', body: '#d99a55', body2: '#b5733a', trim: '#a3adb8', trimDark: '#5f6a76', plate: '#b9c1ca', lock: 'keyhole', lockColor: '#1f232b', ornament: 'none', accent: '#a3adb8', width: 1 },
  silver: { finish: 'enamel', body: '#9ad8f7', body2: '#3f93d2', trim: '#dfe5ec', trimDark: '#7c8898', plate: '#e8edf2', lock: 'keyhole', lockColor: '#22303e', ornament: 'spikes', accent: '#eef2f6', width: 1 },
  golden: { finish: 'enamel', body: '#7cc8f2', body2: '#2c7fcc', trim: '#f7c43f', trimDark: '#b27510', plate: '#ffd65e', lock: 'keyhole', lockColor: '#3b2507', ornament: 'crest', accent: '#ffd65e', width: 1 },
  giant: { finish: 'wood', body: '#d8944f', body2: '#ad6a31', trim: '#aeb7c0', trimDark: '#646f7b', plate: '#c5ccd4', lock: 'double-keyhole', lockColor: '#1f232b', ornament: 'none', accent: '#aeb7c0', width: 1.35 },
  magical: { finish: 'crystal', body: '#f79be4', body2: '#c64fb3', trim: '#6d4c96', trimDark: '#3d2959', plate: '#9270c2', lock: 'gem', lockColor: '#ff6fd6', ornament: 'none', accent: '#b58ee6', width: 1 },
  'super-magical': { finish: 'crystal', body: '#8c93ff', body2: '#4a4bd6', trim: '#56417f', trimDark: '#2e2250', plate: '#ab94e6', lock: 'gem', lockColor: '#7a3fd8', ornament: 'studs', accent: '#cfdac6', width: 1.05 },
};

const DEPTH = 1;
const BASE_H = 0.62;
const FOOT_H = 0.06;
const WALL = 0.07;
/** How far the frame stands proud of the body. */
const OUT = 0.035;
/** Half-cylinder lid squashed to this share of its radius. */
const LID_RISE = 0.95;
const LID_R = DEPTH / 2;
const LID_SEGMENTS = 12;

const surfaceMaterials = new Map<string, THREE.MeshStandardMaterial>();

function surfaceMaterial(p: ChestParams): THREE.MeshStandardMaterial {
  const key = `${p.finish}|${p.body}`;
  let m = surfaceMaterials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: p.finish === 'wood' ? 0.82 : p.finish === 'enamel' ? 0.32 : 0.22, metalness: p.finish === 'enamel' ? 0.12 : 0 });
    if (p.finish === 'crystal') {
      m.emissive.set(p.body);
      m.emissiveIntensity = 0.22;
    }
    surfaceMaterials.set(key, m);
  }
  return m;
}

/** Per-triangle colours from each triangle's centroid (flat, low-poly look). */
function paint(geometry: THREE.BufferGeometry, colorAt: (centroid: THREE.Vector3) => THREE.Color): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(pos, i + k));
    const col = colorAt(c.divideScalar(3));
    for (let k = 0; k < 3; k++) colors.set([col.r, col.g, col.b], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** Box without its top face; `inward` flips it into a lining seen from inside. */
function openBox(w: number, h: number, d: number, rows: number, inward = false): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d, 1, rows, 1);
  const index = g.index!.array;
  const keep: number[] = [];
  // BoxGeometry groups: +x, -x, +y, -y, +z, -z.
  for (const group of g.groups) {
    if (group.materialIndex === 2) continue;
    for (let i = group.start; i < group.start + group.count; i++) keep.push(index[i]);
  }
  if (inward) for (let i = 0; i < keep.length; i += 3) [keep[i + 1], keep[i + 2]] = [keep[i + 2], keep[i + 1]];
  g.setIndex(keep);
  g.clearGroups();
  return g;
}

function surface(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, pos: [number, number, number]): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  m.position.set(...pos);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Colour function of a finish; `t` is 0 at the bottom of the painted piece and 1 at its top. */
function finishColor(p: ChestParams, seed: number): (t: number, band: number) => THREE.Color {
  const rng = new Rng(seed);
  const a = new THREE.Color(p.body);
  const b = new THREE.Color(p.body2);
  const out = new THREE.Color();
  return (t, band) => {
    if (p.finish === 'wood') return out.copy(a).lerp(b, band % 2 === 0 ? 0.1 + rng.next() * 0.12 : 0.45 + rng.next() * 0.12);
    if (p.finish === 'enamel') return out.copy(b).lerp(a, Math.min(1, 0.15 + t * 0.95));
    return out.copy(b).lerp(a, Math.min(1, t * 0.7 + rng.next() * 0.45));
  };
}

/** Rectangular frame around the body between `inner` (inside the wall face) and `outer` (proud of it). */
function ring(parent: THREE.Object3D, name: string, w: number, y: number, h: number, inner: number, outer: number, color: string): void {
  const depth = inner + outer;
  const shift = (outer - inner) / 2;
  for (const s of [1, -1]) {
    parent.add(metal(`${name}-${s > 0 ? 'front' : 'back'}`, box(w + 2 * outer, h, depth), color, [0, y, s * (DEPTH / 2 + shift)]));
    parent.add(metal(`${name}-${s > 0 ? 'left' : 'right'}`, box(depth, h, DEPTH - 2 * inner), color, [s * (w / 2 + shift), y, 0]));
  }
}

/** Half ellipse (lid profile) from angle 0 to π, radius r, in the shape's XY plane. */
function arc(r: number, reverse = false): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= LID_SEGMENTS; i++) {
    const a = (Math.PI * i) / LID_SEGMENTS;
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r * LID_RISE));
  }
  return reverse ? pts.reverse() : pts;
}

function keyholeShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.022, 0);
  s.lineTo(-0.045, -0.1);
  s.lineTo(0.045, -0.1);
  s.lineTo(0.022, 0);
  s.absarc(0, 0.02, 0.045, -Math.PI * 0.2, Math.PI * 1.2, false);
  s.closePath();
  return s;
}

function plateShape(lock: ChestParams['lock']): THREE.Shape {
  const s = new THREE.Shape();
  if (lock === 'gem') {
    // Shield: flat top with clipped corners, pointed bottom.
    s.moveTo(-0.15, 0.17);
    s.lineTo(0.15, 0.17);
    s.lineTo(0.19, 0.12);
    s.lineTo(0.17, -0.06);
    s.lineTo(0, -0.21);
    s.lineTo(-0.17, -0.06);
    s.lineTo(-0.19, 0.12);
  } else {
    const w = lock === 'double-keyhole' ? 0.27 : 0.18;
    const h = 0.19;
    const c = 0.07;
    s.moveTo(-w + c, h);
    s.lineTo(w - c, h);
    s.lineTo(w, h - c);
    s.lineTo(w, -h + c);
    s.lineTo(w - c, -h);
    s.lineTo(-w + c, -h);
    s.lineTo(-w, -h + c);
    s.lineTo(-w, h - c);
  }
  s.closePath();
  return s;
}

const extrude = (shape: THREE.Shape, depth: number, bevel: number) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 10 });

export function createChestModel(p: ChestParams): THREE.Group {
  const root = modelRoot('chest', 'chest');
  const W = 1.3 * p.width;
  const material = surfaceMaterial(p);
  const lining = shade(p.body2, p.finish === 'wood' ? 0.32 : 0.28);

  // ---------------------------------------------------------------- base
  const base = part('base', [0, 0, 0]);
  root.add(base);
  const bodyH = BASE_H - FOOT_H;
  const bodyColor = finishColor(p, 3);
  const rows = p.finish === 'wood' ? 3 : 2;
  base.add(surface('base-body', paint(openBox(W, bodyH, DEPTH, rows), (c) => bodyColor((c.y + bodyH / 2) / bodyH, Math.floor(((c.y + bodyH / 2) / bodyH) * rows))), material, [0, FOOT_H + bodyH / 2, 0]));
  base.add(mesh('base-lining', openBox(W - 2 * WALL, bodyH - WALL, DEPTH - 2 * WALL, 1, true), lining, [0, FOOT_H + WALL + (bodyH - WALL) / 2, 0]));
  ring(base, 'base-rim-top', W, BASE_H - 0.045, 0.09, WALL, OUT, p.trim);
  ring(base, 'base-rim-bottom', W, FOOT_H + 0.06, 0.12, 0.01, OUT, p.trim);
  const post = 0.17;
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const key = `${sx > 0 ? 'L' : 'R'}${sz > 0 ? 'F' : 'B'}`;
      const x = sx * (W / 2 + OUT - post / 2);
      const z = sz * (DEPTH / 2 + OUT - post / 2);
      base.add(metal(`post-${key}`, box(post, bodyH, post), p.trim, [x, FOOT_H + bodyH / 2, z]));
      base.add(detail(mesh(`foot-${key}`, box(0.2, FOOT_H + 0.02, 0.2), p.trimDark, [sx * (W / 2 + OUT - 0.1), (FOOT_H + 0.02) / 2, sz * (DEPTH / 2 + OUT - 0.1)])));
      for (const y of [0.24, 0.44]) base.add(detail(mesh(`rivet-${key}-${y}`, box(0.05, 0.05, 0.03), p.trimDark, [x, y, z + sz * (post / 2 + 0.01)])));
    }
  }
  // Lock plate on the front, straddling the seam under the lid.
  const plateZ = DEPTH / 2 + OUT;
  const plateY = BASE_H - 0.06;
  const plate = metal('lock-plate', extrude(plateShape(p.lock), 0.05, 0.018), p.plate, [0, plateY, plateZ]);
  base.add(plate);
  if (p.lock === 'gem') {
    const gem = mesh('lock-gem', new THREE.IcosahedronGeometry(1, 0).scale(0.1, 0.13, 0.05), p.lockColor, [0, -0.01, 0.085], [0, 0, 0], { roughness: 0.2, emissive: 0.55 });
    plate.add(detail(gem));
    if (p.ornament === 'studs') plate.add(detail(mesh('lock-keyhole', extrude(keyholeShape(), 0.012, 0).scale(0.6, 0.6, 1), '#2a174f', [0, 0.01, 0.13])));
  } else {
    for (const x of p.lock === 'double-keyhole' ? [-0.1, 0.1] : [0]) plate.add(detail(mesh(`lock-keyhole${x ? (x > 0 ? '-L' : '-R') : ''}`, extrude(keyholeShape(), 0.012, 0), p.lockColor, [x, 0.02, 0.07])));
  }
  base.add(socket('glow', [0, BASE_H * 0.55, 0]));

  // ---------------------------------------------------------------- lid (hinged at the back top edge)
  const lid = part('lid', [0, BASE_H, -DEPTH / 2]);
  root.add(lid);
  const lidColor = finishColor(p, 5);
  const shell = new THREE.CylinderGeometry(LID_R, LID_R, W, LID_SEGMENTS, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, LID_RISE, 1);
  const lidTop = LID_R * LID_RISE;
  lid.add(
    surface(
      'lid-shell',
      paint(shell, (c) => {
        const angle = Math.atan2(c.y / LID_RISE, c.z);
        return lidColor(c.y / lidTop, Math.floor((angle / Math.PI) * 4.999));
      }).translate(0, 0, DEPTH / 2),
      material,
      [0, 0, 0],
    ),
  );
  lid.add(mesh('lid-lining', box(W - 0.02, 0.02, DEPTH - 0.02), lining, [0, 0.012, DEPTH / 2]));
  const band = new THREE.Shape([...arc(LID_R + OUT), ...arc(LID_R - 0.1, true)]);
  const bandDepth = 0.19;
  for (const s of [1, -1]) {
    const frame = metal(`lid-band-${s > 0 ? 'L' : 'R'}`, extrude(band, bandDepth, 0.012).rotateY(Math.PI / 2), p.trim, [s > 0 ? W / 2 + OUT - bandDepth : -(W / 2 + OUT), 0, DEPTH / 2]);
    lid.add(frame);
    if (p.ornament === 'spikes') frame.add(detail(metal(`lid-spike-${s > 0 ? 'L' : 'R'}`, cone(0.055, 0.15, 5), p.accent, [bandDepth / 2, lidTop + OUT + 0.08, 0])));
    if (p.ornament === 'studs') {
      for (const a of [0.2, 0.5, 0.8]) {
        const angle = Math.PI * a;
        const r = LID_R + OUT + 0.012;
        frame.add(detail(mesh(`lid-stud-${s > 0 ? 'L' : 'R'}-${a}`, box(0.07, 0.07, 0.07), p.accent, [bandDepth / 2, Math.sin(angle) * r * LID_RISE, -Math.cos(angle) * r], [angle, 0, 0])));
      }
    }
  }
  for (const s of [1, -1]) lid.add(metal(`lid-bar-${s > 0 ? 'front' : 'back'}`, box(W + 2 * OUT, 0.12, 0.08), p.trim, [0, 0.06, s > 0 ? DEPTH + OUT - 0.04 : -OUT + 0.04]));
  if (p.ornament === 'crest') {
    lid.add(metal('lid-crest', box(W - 0.3, 0.05, 0.18), p.trim, [0, lidTop + 0.015, DEPTH / 2]));
    lid.add(detail(metal('lid-crest-peak', cone(0.1, 0.16, 4), p.accent, [0, lidTop + 0.1, DEPTH / 2], [0, Math.PI / 4, 0])));
  }
  return root;
}
