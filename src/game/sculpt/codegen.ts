// Emits a standalone TypeScript factory from a sculpt spec: the kit source verbatim, then
// explicit construction code making the same kit calls, in the same order, as build.ts —
// so the downloaded file rebuilds exactly the model the studio previewed.
import { mirroredName, type SculptNode, type SculptSpec } from '@/shared/sculpt';
import { childrenByParent } from './build';

export function factoryName(spec: SculptSpec): string {
  const words = spec.name
    .replace(/[đĐ]/g, (c) => (c === 'đ' ? 'd' : 'D'))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1));
  const core = words.join('').replace(/^[0-9]+/, '');
  return `create${core || 'Sculpt'}Model`;
}

export interface FactoryMeta {
  studioId: string;
  version: number;
}

export function generateFactorySource(spec: SculptSpec, kitSource: string, meta: FactoryMeta): string {
  const children = childrenByParent(spec);
  const used = new Set<string>();
  const vars = new Map<string, string>();
  const ident = (name: string) => {
    const base = `n_${name.replace(/[^A-Za-z0-9_]/g, '_')}`;
    let id = base;
    for (let i = 2; used.has(id); i++) id = `${base}_${i}`;
    used.add(id);
    vars.set(name, id);
    return id;
  };
  const lit = (v: unknown) => JSON.stringify(v);
  const body: string[] = [];

  const emit = (node: SculptNode, parentVar: string) => {
    const v = ident(node.name);
    const at = `${lit(node.position)}, ${lit(node.rotation)}`;
    let expr: string;
    switch (node.type) {
      case 'part':
        expr = `sculptPart(${lit(node.name)}, ${at})`;
        break;
      case 'group':
        expr = `sculptGroup(${lit(node.name)}, ${at})`;
        break;
      case 'socket':
        expr = `sculptSocket(${lit(node.name)}, ${at})`;
        break;
      case 'mesh':
        expr = `sculptMesh(${lit(node.name)}, ${lit(node.shape)}, defs[${lit(node.material)}], mats[${lit(node.material)}], ${node.jitter}, ${at}, ${lit(node.scale)})`;
        break;
    }
    if (node.detail) expr = `detail(${expr})`;
    if (node.oneSided) expr = `oneSided(${expr})`;
    body.push(`  const ${v} = ${expr};`, `  ${parentVar}.add(${v});`);
    for (const child of children.get(node.name) ?? []) emit(child, v);
  };

  for (const node of children.get('') ?? []) emit(node, 'root');

  for (const node of spec.nodes) {
    if (!node.mirror) continue;
    const copyName = mirroredName(node.name);
    const copy = ident(copyName);
    body.push('', `  // ${copyName}: reflection of ${node.name} (x → -x)`, `  const ${copy} = mirrorObject(${vars.get(node.name)});`, `  ${node.parent === null ? 'root' : vars.get(node.parent)}.add(${copy});`);
    const order: string[] = [];
    const walk = (n: SculptNode) => {
      order.push(mirroredName(n.name));
      for (const c of children.get(n.name) ?? []) if (!c.oneSided) walk(c);
    };
    walk(node);
    for (const name of order) {
      const attached = children.get(name);
      if (!attached) continue;
      const target = name === copyName ? copy : ident(name);
      if (name !== copyName) body.push(`  const ${target} = findNode(${copy}, ${lit(name)});`);
      for (const child of attached) emit(child, target);
    }
  }

  const fn = factoryName(spec);
  const defs = spec.materials.map((m) => `    ${lit(m.id)}: ${lit(m)},`).join('\n');
  const mats = spec.materials.map((m) => `    ${lit(m.id)}: makeMaterial(defs[${lit(m.id)}]),`).join('\n');
  // The name is free text: keep it on the comment line.
  const title = spec.name.replace(/[\r\n\u2028\u2029]+/g, ' ');
  return `// ${title} — procedural Three.js model exported from the img2threejs studio (CMS).
// Studio job ${meta.studioId}, version ${meta.version}; rig "${spec.rig}". Generated from a sculpt spec.
//
//   import { ${fn} } from './${fn}';
//   scene.add(${fn}());
//
// Frame: forward +Z, up +Y, the model's own left = +X, metres, feet on y = 0. Pivot groups carry
// userData.part (animation joints) and sockets carry userData.socket.

${kitSource.trim()}

export function ${fn}(): THREE.Group {
  const root = sculptRoot(${lit(spec.name)}, ${lit(spec.rig)}, ${lit(spec.weaponStyle)});
  const defs: Record<string, SculptKitMaterial> = {
${defs}
  };
  const mats: Record<string, THREE.MeshStandardMaterial> = {
${mats}
  };

${body.join('\n')}
  return root;
}
`;
}
