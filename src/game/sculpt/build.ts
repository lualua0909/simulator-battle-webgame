// Builds an img2threejs sculpt spec into a procedural Three.js model with the same kit calls,
// in the same order, as the exported TypeScript factory (codegen.ts):
//   1. the authored tree, depth-first in spec order;
//   2. each mirrored subtree's reflected copy, in spec order;
//   3. authored nodes whose parent is a name inside a reflected copy (e.g. a weapon on forearmR).
import * as THREE from 'three';
import { checkSculptSpec, type SculptMaterial, type SculptNode, type SculptSpec } from '@/shared/sculpt';
import { detail, makeMaterial, mirrorObject, oneSided, sculptGroup, sculptMesh, sculptPart, sculptRoot, sculptSocket } from './kit';

export class SculptSpecError extends Error {
  constructor(readonly issues: string[]) {
    super(`Spec không dựng được: ${issues.slice(0, 3).join('; ')}${issues.length > 3 ? ` (+${issues.length - 3})` : ''}`);
  }
}

/** Authored children per parent name ('' = model root), in spec order. */
export function childrenByParent(spec: SculptSpec): Map<string, SculptNode[]> {
  const out = new Map<string, SculptNode[]>();
  for (const n of spec.nodes) {
    const key = n.parent ?? '';
    const list = out.get(key);
    if (list) list.push(n);
    else out.set(key, [n]);
  }
  return out;
}

export function buildSculptModel(spec: SculptSpec): THREE.Group {
  const failures = checkSculptSpec(spec)
    .filter((i) => i.level === 'fail')
    .map((i) => i.message);
  if (failures.length) throw new SculptSpecError(failures);

  const root = sculptRoot(spec.name, spec.rig, spec.weaponStyle);
  const defs = new Map<string, SculptMaterial>(spec.materials.map((m) => [m.id, m]));
  const materials = new Map(spec.materials.map((m) => [m.id, makeMaterial(m)]));
  const children = childrenByParent(spec);
  const authored = new Map<string, THREE.Object3D>();

  const make = (node: SculptNode): THREE.Object3D => {
    let obj: THREE.Object3D;
    switch (node.type) {
      case 'part':
        obj = sculptPart(node.name, node.position, node.rotation);
        break;
      case 'group':
        obj = sculptGroup(node.name, node.position, node.rotation);
        break;
      case 'socket':
        obj = sculptSocket(node.name, node.position, node.rotation);
        break;
      case 'mesh':
        obj = sculptMesh(node.name, node.shape!, defs.get(node.material!)!, materials.get(node.material!)!, node.jitter, node.position, node.rotation, node.scale);
        break;
    }
    if (node.detail) detail(obj);
    if (node.oneSided) oneSided(obj);
    authored.set(node.name, obj);
    for (const child of children.get(node.name) ?? []) obj.add(make(child));
    return obj;
  };

  for (const node of children.get('') ?? []) root.add(make(node));

  for (const node of spec.nodes) {
    if (!node.mirror) continue;
    const source = authored.get(node.name)!;
    const copy = mirrorObject(source);
    source.parent!.add(copy);
    const reflected: THREE.Object3D[] = [];
    copy.traverse((o) => reflected.push(o));
    for (const o of reflected) for (const child of children.get(o.name) ?? []) o.add(make(child));
  }
  return root;
}
