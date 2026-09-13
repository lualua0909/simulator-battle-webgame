// img2threejs sculpt spec (CMS profile): the reconstruction data the studio produces.
// Claude authors a spec; the trusted generator in src/game/sculpt turns it into a procedural
// Three.js model and an exportable TypeScript factory, so model-written code never runs.
//
// Frame: forward +Z, up +Y, the model's own left = +X, metres, feet on y = 0.
import { z } from 'zod';

export const SCULPT_RIGS = ['humanoid', 'quadruped', 'dragon', 'bird', 'catapult', 'static'] as const;
export type SculptRig = (typeof SCULPT_RIGS)[number];

/** How a humanoid uses its held weapon (drives the attack animation). */
export const WEAPON_STYLES = ['none', 'swing', 'thrust', 'bow', 'staff'] as const;
export type WeaponStyle = (typeof WEAPON_STYLES)[number];

export const SCULPT_LIMITS = { nodes: 400, materials: 32 } as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'màu dạng #rrggbb');
const vec2 = z.array(z.number()).length(2);
const vec3 = z.array(z.number()).length(3);
const size = z.number().min(0).max(60);
const segments = (min: number, max: number, fallback: number) => z.number().int().min(min).max(max).default(fallback);
const nodeName = z.string().regex(/^[A-Za-z][A-Za-z0-9._-]{0,47}$/, 'tên node: chữ cái đầu, chữ/số . _ -');

export const sculptShapeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('box'), size: vec3 }),
  z.object({ type: z.literal('sphere'), radius: size, detail: segments(0, 2, 1) }),
  z.object({ type: z.literal('ellipsoid'), radii: vec3, detail: segments(0, 2, 1) }),
  z.object({ type: z.literal('dome'), radius: size, widthSegments: segments(3, 16, 8), heightSegments: segments(1, 8, 3) }),
  z.object({ type: z.literal('capsule'), from: vec3, to: vec3, radius: size, radialSegments: segments(3, 16, 7) }),
  z.object({ type: z.literal('cylinder'), radiusTop: size, radiusBottom: size, height: size, radialSegments: segments(3, 24, 8), openEnded: z.boolean().default(false) }),
  z.object({ type: z.literal('cone'), radius: size, height: size, radialSegments: segments(3, 24, 8) }),
  z.object({ type: z.literal('beam'), from: vec3, to: vec3, radiusFrom: size, radiusTo: size, radialSegments: segments(3, 16, 6) }),
  z.object({ type: z.literal('torus'), radius: size, tube: size, radialSegments: segments(2, 12, 4), tubularSegments: segments(3, 32, 10), arc: z.number().min(0.01).max(Math.PI * 2).default(Math.PI * 2) }),
  z.object({ type: z.literal('lathe'), profile: z.array(vec2).min(2).max(32), segments: segments(3, 24, 10) }),
  z.object({ type: z.literal('extrude'), outline: z.array(vec2).min(3).max(64), depth: size, bevel: z.number().min(0).max(0.2).default(0) }),
  z.object({ type: z.literal('sweep'), points: z.array(vec3).min(2).max(32), radii: z.array(size).min(1).max(32), radialSegments: segments(3, 12, 6) }),
  z.object({ type: z.literal('triangles'), vertices: z.array(vec3).min(3).max(360) }),
]);

export const sculptMaterialSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, 'id vật liệu: chữ thường, số, gạch ngang'),
  color: hex,
  roughness: z.number().min(0).max(1).default(0.85),
  metalness: z.number().min(0).max(1).default(0),
  emissive: z.number().min(0).max(3).default(0),
  doubleSide: z.boolean().default(false),
  /** Per-face colour variation towards color2 (baked vertex colours), 0 = off. */
  color2: hex.nullable().default(null),
  variation: z.number().min(0).max(1).default(0),
});

export const SCULPT_NODE_TYPES = ['part', 'group', 'mesh', 'socket'] as const;

export const sculptNodeSchema = z.object({
  name: nodeName,
  /** null = attached to the model root. May name a mirror-generated node (e.g. "forearmR"). */
  parent: nodeName.nullable().default(null),
  type: z.enum(SCULPT_NODE_TYPES),
  position: vec3.default([0, 0, 0]),
  /** Euler XYZ, radians. */
  rotation: vec3.default([0, 0, 0]),
  /** Meshes only. */
  scale: vec3.default([1, 1, 1]),
  shape: sculptShapeSchema.nullable().default(null),
  material: z.string().nullable().default(null),
  /** Also emit the reflected copy (x → -x) of this left-side subtree; names ending in L become R. */
  mirror: z.boolean().default(false),
  /** Left out of the reflected copy of an ancestor (a bow or shield held in one hand). */
  oneSided: z.boolean().default(false),
  /** Surface detail that explodes and picks with its parent part. */
  detail: z.boolean().default(false),
  /** Seeded vertex displacement (metres) for organic, faceted surfaces. */
  jitter: z.number().min(0).max(0.2).default(0),
});

export const sculptSpecSchema = z.object({
  name: z.string().trim().min(1).max(48),
  rig: z.enum(SCULPT_RIGS),
  weaponStyle: z.enum(WEAPON_STYLES).default('none'),
  materials: z.array(sculptMaterialSchema).min(1).max(SCULPT_LIMITS.materials),
  nodes: z.array(sculptNodeSchema).min(1).max(SCULPT_LIMITS.nodes),
});

export type SculptShape = z.infer<typeof sculptShapeSchema>;
export type SculptMaterial = z.infer<typeof sculptMaterialSchema>;
export type SculptNode = z.infer<typeof sculptNodeSchema>;
export type SculptSpec = z.infer<typeof sculptSpecSchema>;

/** Name of the reflected counterpart: a trailing "L" becomes "R". */
export function mirroredName(name: string): string {
  return name.endsWith('L') ? `${name.slice(0, -1)}R` : name;
}

export interface SpecIssue {
  level: 'fail' | 'warn';
  message: string;
}

/**
 * Structural checks zod cannot express: unique names, resolvable parents, mirror naming,
 * per-shape array lengths. The generator refuses a spec with any `fail`.
 */
export function checkSculptSpec(spec: SculptSpec): SpecIssue[] {
  const issues: SpecIssue[] = [];
  const fail = (message: string) => issues.push({ level: 'fail', message });

  const materialIds = new Set<string>();
  for (const m of spec.materials) {
    if (materialIds.has(m.id)) fail(`vật liệu "${m.id}" bị trùng id`);
    materialIds.add(m.id);
  }

  const byName = new Map<string, SculptNode>();
  for (const n of spec.nodes) {
    if (byName.has(n.name)) fail(`node "${n.name}" bị trùng tên`);
    byName.set(n.name, n);
  }

  const ancestors = (n: SculptNode): SculptNode[] => {
    const out: SculptNode[] = [];
    const seen = new Set<string>([n.name]);
    let cur = n.parent ? byName.get(n.parent) : undefined;
    while (cur && !seen.has(cur.name)) {
      out.push(cur);
      seen.add(cur.name);
      cur = cur.parent ? byName.get(cur.parent) : undefined;
    }
    if (cur) fail(`node "${n.name}": vòng lặp cha–con`);
    return out;
  };

  // Names the reflected copies will create (their subtree minus one-sided branches).
  const children = new Map<string, SculptNode[]>();
  for (const n of spec.nodes) {
    const key = n.parent ?? '';
    children.set(key, [...(children.get(key) ?? []), n]);
  }
  const mirrored = new Set<string>();
  for (const n of spec.nodes) {
    if (!n.mirror) continue;
    if (ancestors(n).some((a) => a.mirror)) {
      fail(`node "${n.name}": không lồng mirror trong nhánh đã mirror`);
      continue;
    }
    const walk = (node: SculptNode) => {
      if (node.oneSided && node !== n) return;
      if (!node.name.endsWith('L')) fail(`node "${node.name}" nằm trong nhánh mirror của "${n.name}" nên tên phải kết thúc bằng L`);
      const copy = mirroredName(node.name);
      if (byName.has(copy) || mirrored.has(copy)) fail(`tên phản chiếu "${copy}" (từ "${node.name}") trùng node khác`);
      mirrored.add(copy);
      for (const c of children.get(node.name) ?? []) walk(c);
    };
    if (n.oneSided) fail(`node "${n.name}": mirror và oneSided không dùng cùng nhau`);
    walk(n);
  }

  for (const n of spec.nodes) {
    if (n.parent !== null && !byName.has(n.parent) && !mirrored.has(n.parent)) fail(`node "${n.name}": cha "${n.parent}" không tồn tại`);
    if (n.parent === n.name) fail(`node "${n.name}" tự làm cha chính nó`);
    if (n.mirror && n.parent !== null && mirrored.has(n.parent)) fail(`node "${n.name}": không mirror bên dưới node phản chiếu "${n.parent}"`);
    if (n.type === 'mesh') {
      if (!n.shape) fail(`mesh "${n.name}" thiếu shape`);
      if (!n.material) fail(`mesh "${n.name}" thiếu material`);
      else if (!materialIds.has(n.material)) fail(`mesh "${n.name}": vật liệu "${n.material}" không tồn tại`);
    } else {
      if (n.shape) fail(`node "${n.name}" loại ${n.type} không được có shape (chỉ mesh)`);
      if (n.scale.some((v) => v !== 1)) fail(`node "${n.name}" loại ${n.type} phải có scale [1,1,1]; chỉ mesh được scale`);
    }
    if (n.scale.some((v) => v <= 0)) fail(`node "${n.name}": scale phải dương (dùng mirror thay cho scale âm)`);
    const s = n.shape;
    if (s?.type === 'triangles' && s.vertices.length % 3 !== 0) fail(`mesh "${n.name}": số đỉnh triangles phải chia hết cho 3`);
    if (s?.type === 'sweep' && s.radii.length > 2 && s.radii.length !== s.points.length) fail(`mesh "${n.name}": radii của sweep phải có 1, 2 hoặc đúng bằng số điểm`);
    if (s?.type === 'lathe' && s.profile.some((p) => p[0] < 0)) fail(`mesh "${n.name}": bán kính profile lathe không được âm`);
  }
  return issues;
}
