import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { assetSchema } from '@/shared/schema';
import { sculptNodeSchema, sculptSpecSchema, type SculptSpec } from '@/shared/sculpt';
import { createAssetModel } from '../models';
import { bakeModel } from '../models/bake';
import { Poser } from '../render/animate';
import { buildSculptModel } from './build';
import { factoryName, generateFactorySource } from './codegen';
import { EXAMPLE_HUMANOID_SPEC } from './example';
import { runSculptGates } from './gates';
import { referenceRig } from './rigs';

const example = (): SculptSpec => sculptSpecSchema.parse(EXAMPLE_HUMANOID_SPEC);

test('example humanoid spec passes every gate', () => {
  const report = runSculptGates(example(), 'humanoid', referenceRig('humanoid'));
  assert.deepEqual(
    report.gates.filter((g) => g.level !== 'pass').map((g) => `${g.id}: ${g.details.join(' | ')}`),
    [],
  );
  assert.equal(report.verdict, 'pass');
});

test('mirrored pairs are reflections with restored winding, not rotations', () => {
  const root = buildSculptModel(example());
  root.updateMatrixWorld(true);
  for (const name of ['thighR', 'shinR', 'armR', 'forearmR', 'hand.R', 'eyeR']) assert.ok(root.getObjectByName(name), `${name} missing`);
  assert.equal(root.getObjectByName('forearmR')!.getObjectByName('offhand'), undefined, 'one-sided shield must stay on the left');
  assert.equal(root.getObjectByName('weapon')!.parent!.name, 'forearmR');

  const left = root.getObjectByName('upperArmL') as THREE.Mesh;
  const right = root.getObjectByName('upperArmR') as THREE.Mesh;
  const lp = left.geometry.getAttribute('position');
  const rp = right.geometry.getAttribute('position');
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let i = 0; i < lp.count; i++) {
    a.fromBufferAttribute(lp, i).applyMatrix4(left.matrixWorld);
    b.fromBufferAttribute(rp, i).applyMatrix4(right.matrixWorld);
    assert.ok(Math.abs(a.x + b.x) < 1e-5 && Math.abs(a.y - b.y) < 1e-5 && Math.abs(a.z - b.z) < 1e-5, `vertex ${i} is not reflected`);
  }
  const faceNormal = (mesh: THREE.Mesh) => {
    const idx = mesh.geometry.index!;
    const p = mesh.geometry.getAttribute('position');
    const [v0, v1, v2] = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(p, idx.getX(k)).applyMatrix4(mesh.matrixWorld));
    return v1.sub(v0).cross(v2.sub(v0)).normalize();
  };
  const nl = faceNormal(left);
  const nr = faceNormal(right);
  assert.ok(Math.abs(nl.x + nr.x) < 1e-5 && Math.abs(nl.y - nr.y) < 1e-5 && Math.abs(nl.z - nr.z) < 1e-5, 'reflected faces must still point outwards');
});

function describe(root: THREE.Object3D) {
  const out: unknown[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const g = mesh.isMesh ? mesh.geometry : null;
    out.push({
      name: o.name,
      type: o.type,
      userData: o.userData,
      matrix: o.matrix.elements.map((v) => Math.round(v * 1e6) / 1e6),
      children: o.children.map((c) => c.name),
      position: g ? Array.from(g.getAttribute('position').array) : null,
      color: g?.getAttribute('color') ? Array.from(g.getAttribute('color').array) : null,
      index: g?.index ? Array.from(g.index.array) : null,
      material: mesh.isMesh ? { ...(mesh.material as THREE.MeshStandardMaterial).toJSON(), uuid: null } : null,
    });
  });
  return out;
}

test('exported TypeScript factory rebuilds exactly the previewed model', async () => {
  const spec = example();
  const kit = fs.readFileSync(path.resolve('src/game/sculpt/kit.ts'), 'utf8');
  const source = generateFactorySource(spec, kit, { studioId: 'test', version: 1 });
  const dir = path.resolve('node_modules/.cache/sculpt-test');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${factoryName(spec)}-${process.pid}.ts`);
  fs.writeFileSync(file, source);
  try {
    const mod = (await import(pathToFileURL(file).href)) as Record<string, () => THREE.Group>;
    const exported = mod[factoryName(spec)]();
    exported.updateMatrixWorld(true);
    const built = buildSculptModel(spec);
    built.updateMatrixWorld(true);
    assert.deepEqual(describe(exported), describe(built));
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('a sculpted asset animates, and asset validation enforces its rig', () => {
  const asset = assetSchema.parse({ id: 'knight-x', name: 'Knight X', kind: 'humanoid', params: {}, sculpt: { studioId: 's1', version: 1, spec: EXAMPLE_HUMANOID_SPEC } });
  const template = bakeModel(createAssetModel(asset));
  const poses = template.parts.map(() => new THREE.Matrix4());
  const rest = template.parts.map((p) => p.rest.clone());
  new Poser(template, 'swing').compute({ time: 1, speed: 3, phase: 1, attack: 1.2, airborne: false, stunned: false, leanX: 0, leanZ: 0, seed: 0.2, refSpeed: 3 }, poses);
  assert.ok(poses.every((m) => m.elements.every(Number.isFinite)));
  const fore = template.parts.findIndex((p) => p.local === 'forearmR');
  assert.ok(!poses[fore].equals(rest[fore]), 'swinging arm should move the forearm');

  assert.equal(assetSchema.safeParse({ ...asset, kind: 'horse', params: {} }).success, false);
  const broken = { ...asset, sculpt: { ...asset.sculpt!, spec: { ...asset.sculpt!.spec, nodes: [...asset.sculpt!.spec.nodes, { ...asset.sculpt!.spec.nodes[0] }] } } };
  assert.equal(assetSchema.safeParse(broken).success, false, 'duplicate node names must be rejected');
});

test('gates block a missing joint and a sunken model, and flag floating parts', () => {
  const noShin = example();
  noShin.nodes = noShin.nodes.filter((n) => n.name !== 'shinL' && n.parent !== 'shinL');
  const rig = runSculptGates(noShin, 'humanoid', null).gates.find((g) => g.id === 'rig')!;
  assert.equal(rig.level, 'fail');
  assert.match(rig.details.join(), /shinL/);

  const sunk = example();
  sunk.nodes[0] = { ...sunk.nodes[0], position: [0, 0.2, 0] };
  assert.equal(runSculptGates(sunk, 'humanoid', null).gates.find((g) => g.id === 'ground')!.level, 'fail');

  const floating = example();
  floating.nodes.push(sculptNodeSchema.parse({ name: 'halo', parent: 'head', type: 'mesh', position: [0, 1.2, 0], shape: { type: 'torus', radius: 0.2, tube: 0.02 }, material: 'steel' }));
  const attach = runSculptGates(floating, 'humanoid', null).gates.find((g) => g.id === 'attachment')!;
  assert.equal(attach.level, 'warn');
  assert.match(attach.details.join(), /halo/);

  const wrongRig = example();
  assert.equal(runSculptGates(wrongRig, 'horse', null).verdict, 'fail');
});
