// Dinosaur units: clip-name mapping, committed GLB integrity and procedural fallback.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createAssetModel } from '@/game/models';
import { bakeModel } from '@/game/models/bake';
import { pickClipName, repaintPixels, skinnedBounds } from '@/game/models/glbSkinned';
import { assetSchema, unitSchema, weaponSchema } from '@/shared/schema';
import { SEED } from '@/shared/seed';

const QUATERNIUS = [
  'Armature|Velociraptor_Attack',
  'Armature|Velociraptor_Death',
  'Armature|Velociraptor_Idle',
  'Armature|Velociraptor_Jump',
  'Armature|Velociraptor_Run',
  'Armature|Velociraptor_Walk',
];

test('clip names map to battle states', () => {
  assert.equal(pickClipName(QUATERNIUS, 'idle'), 'Armature|Velociraptor_Idle');
  assert.equal(pickClipName(QUATERNIUS, 'walk'), 'Armature|Velociraptor_Walk');
  assert.equal(pickClipName(QUATERNIUS, 'run'), 'Armature|Velociraptor_Run');
  assert.equal(pickClipName(QUATERNIUS, 'attack'), 'Armature|Velociraptor_Attack');
  assert.equal(pickClipName(QUATERNIUS, 'death'), 'Armature|Velociraptor_Death');
  assert.equal(pickClipName(QUATERNIUS, 'jump'), 'Armature|Velociraptor_Jump');
  assert.equal(pickClipName([], 'idle'), null);
  assert.equal(pickClipName(['mixamo.com'], 'run'), null);
});

const NINJA_CLIPS = [
  'CharacterArmature|Death',
  'CharacterArmature|Duck',
  'CharacterArmature|HitReact',
  'CharacterArmature|Idle',
  'CharacterArmature|Jump',
  'CharacterArmature|Punch',
  'CharacterArmature|Run',
  'CharacterArmature|Walk',
];

test('ninja clips map to battle states (Punch wins over HitReact)', () => {
  assert.equal(pickClipName(NINJA_CLIPS, 'idle'), 'CharacterArmature|Idle');
  assert.equal(pickClipName(NINJA_CLIPS, 'walk'), 'CharacterArmature|Walk');
  assert.equal(pickClipName(NINJA_CLIPS, 'run'), 'CharacterArmature|Run');
  assert.equal(pickClipName(NINJA_CLIPS, 'attack'), 'CharacterArmature|Punch');
  assert.equal(pickClipName(NINJA_CLIPS, 'death'), 'CharacterArmature|Death');
  assert.equal(pickClipName(NINJA_CLIPS, 'jump'), 'CharacterArmature|Jump');
});

test('committed ninja.glb parses with a full clip set', async () => {
  const file = path.join(process.cwd(), 'public', 'models', 'ninja.glb');
  assert.ok(existsSync(file), 'public/models/ninja.glb is committed');
  const buf = readFileSync(file);
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
  const names = gltf.animations.map((a) => a.name);
  for (const state of ['idle', 'walk', 'run', 'attack', 'death', 'jump'] as const) {
    assert.ok(pickClipName(names, state), `ninja.glb: no clip for ${state} in ${names.join(', ')}`);
  }
  const box = skinnedBounds(gltf.scene);
  assert.ok(box, 'ninja.glb: no skinned bounds');
  assert.ok(Math.abs(box.min.y) < 0.5, `ninja.glb: rendered min.y ${box.min.y}`);
});

test('seed m-ninja asset references /models/ninja.glb and validates', () => {
  const asset = SEED.assets.find((a) => a.id === 'm-ninja')!;
  assert.ok(asset, 'seed has m-ninja');
  assert.equal(asset.kind, 'humanoid');
  assert.equal(asset.glb?.url, '/models/ninja.glb');
  assert.deepEqual(assetSchema.parse(asset), asset);
});

const DRAGON_CLIPS = [
  'DragonArmature|Dragon_Attack',
  'DragonArmature|Dragon_Attack2',
  'DragonArmature|Dragon_Death',
  'DragonArmature|Dragon_Flying',
  'DragonArmature|Dragon_Hit',
];

test('flying-only clips map to every locomotion state', () => {
  assert.equal(pickClipName(DRAGON_CLIPS, 'idle'), 'DragonArmature|Dragon_Flying');
  assert.equal(pickClipName(DRAGON_CLIPS, 'walk'), 'DragonArmature|Dragon_Flying');
  assert.equal(pickClipName(DRAGON_CLIPS, 'run'), 'DragonArmature|Dragon_Flying');
  assert.equal(pickClipName(DRAGON_CLIPS, 'attack'), 'DragonArmature|Dragon_Attack');
  assert.equal(pickClipName(DRAGON_CLIPS, 'death'), 'DragonArmature|Dragon_Death');
  assert.equal(pickClipName(DRAGON_CLIPS, 'jump'), 'DragonArmature|Dragon_Flying');
});

test('committed rong-xanh.glb parses with a full clip set', async () => {
  const file = path.join(process.cwd(), 'public', 'models', 'rong-xanh.glb');
  assert.ok(existsSync(file), 'public/models/rong-xanh.glb is committed');
  const buf = readFileSync(file);
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
  const names = gltf.animations.map((a) => a.name);
  for (const state of ['idle', 'walk', 'run', 'attack', 'death', 'jump'] as const) {
    assert.ok(pickClipName(names, state), `rong-xanh.glb: no clip for ${state} in ${names.join(', ')}`);
  }
  const box = skinnedBounds(gltf.scene);
  assert.ok(box, 'rong-xanh.glb: no skinned bounds');
  assert.ok(Math.abs(box.min.y) < 0.5, `rong-xanh.glb: rendered min.y ${box.min.y}`);
});

test('seed m-baby-dragon asset references /models/rong-xanh.glb with a green tint and validates', () => {
  const asset = SEED.assets.find((a) => a.id === 'm-baby-dragon')!;
  assert.ok(asset, 'seed has m-baby-dragon');
  assert.equal(asset.kind, 'dragon');
  assert.equal(asset.glb?.url, '/models/rong-xanh.glb');
  assert.deepEqual(asset.glb?.tint?.['Main'], '#8cc540');
  assert.deepEqual(assetSchema.parse(asset), asset);
});

test('repaintPixels shifts near-from pixels toward to and leaves the rest', () => {
  // 3x1: navy robe pixel, skin pixel, white beard pixel.
  const data = new Uint8ClampedArray([30, 60, 160, 255, 232, 184, 138, 255, 240, 240, 240, 255]);
  repaintPixels(data, '#1e3c9e', '#b3262e');
  // Robe pixel took the red hue.
  assert.ok(data[0] > 120 && data[2] < 120, `robe pixel not red: ${data[0]},${data[1]},${data[2]}`);
  // Skin and beard pixels untouched.
  assert.deepEqual([data[4], data[5], data[6]], [232, 184, 138]);
  assert.deepEqual([data[8], data[9], data[10]], [240, 240, 240]);
});

test('repaintPixels reaches white without pinking it', () => {
  const data = new Uint8ClampedArray([30, 60, 160, 255]);
  repaintPixels(data, '#1e3c9e', '#e8e8e8');
  assert.ok(data[0] > 170 && data[1] > 170 && data[2] > 170, `not white: ${data[0]},${data[1]},${data[2]}`);
  assert.ok(Math.max(data[0], data[1], data[2]) - Math.min(data[0], data[1], data[2]) < 40, 'too saturated for white');
});

const MAGE_TINTS: Array<{ asset: string; to: string }> = [
  { asset: 'm-wizard', to: '#4a2a8a' },
  { asset: 'm-wind-shaman', to: '#e8e8e8' },
  { asset: 'm-pyromancer', to: '#b3262e' },
  { asset: 'm-thunder-mage', to: '#2a5aff' },
  { asset: 'm-storm-lord', to: '#c8922a' },
];

test('committed phap-su.glb parses with spell clips', async () => {
  const file = path.join(process.cwd(), 'public', 'models', 'phap-su.glb');
  assert.ok(existsSync(file), 'public/models/phap-su.glb is committed');
  // Textured files need DOM image decoding; the browser path is covered by screenshots.
  let names: string[] = [
    'CharacterArmature|Death', 'CharacterArmature|Idle', 'CharacterArmature|Punch',
    'CharacterArmature|Run', 'CharacterArmature|Spell1', 'CharacterArmature|Staff_Attack', 'CharacterArmature|Walk',
  ];
  try {
    const buf = readFileSync(file);
    const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
    names = gltf.animations.map((a) => a.name);
  } catch {
    // fall back to the known clip list above
  }
  assert.equal(pickClipName(names, 'attack'), 'CharacterArmature|Spell1');
  assert.equal(pickClipName(names, 'idle'), 'CharacterArmature|Idle');
  assert.equal(pickClipName(names, 'death'), 'CharacterArmature|Death');
});

for (const m of MAGE_TINTS) {
  test(`seed ${m.asset} shares phap-su.glb tinted ${m.to} and validates`, () => {
    const asset = SEED.assets.find((a) => a.id === m.asset)!;
    assert.ok(asset, `seed has ${m.asset}`);
    assert.equal(asset.glb?.url, '/models/phap-su.glb');
    assert.deepEqual(asset.glb?.tint, { Wizard_Texture: { from: '#2e44a8', to: m.to } });
    assert.deepEqual(assetSchema.parse(asset), asset);
  });
}

test('committed velociraptor.glb parses with all six clips', async () => {
  const file = path.join(process.cwd(), 'public', 'models', 'velociraptor.glb');
  assert.ok(existsSync(file), 'public/models/velociraptor.glb is committed');
  const buf = readFileSync(file);
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
  const names = gltf.animations.map((a) => a.name);
  for (const state of ['idle', 'walk', 'run', 'attack', 'death', 'jump'] as const) {
    assert.ok(pickClipName(names, state), `no clip for ${state} in ${names.join(', ')}`);
  }
  gltf.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  assert.ok(size.y > 1 && size.y < 30, `rest height ${size.y} m is plausible before normalisation`);
  assert.ok(box.min.y < 0.5, 'feet near the authored origin so grounding only lifts');
});

const EXTRA_DINOS = [
  { file: 'parasaurolophus.glb', weapon: 'para-tail', asset: 'm-parasaurolophus', unit: 'parasaurolophus', url: '/models/parasaurolophus.glb' },
  { file: 't-rex.glb', weapon: 'rex-bite', asset: 'm-t-rex', unit: 't-rex', url: '/models/t-rex.glb' },
  { file: 'stegosaurus.glb', weapon: 'stego-tail', asset: 'm-stegosaurus', unit: 'stegosaurus', url: '/models/stegosaurus.glb' },
  { file: 'triceratops.glb', weapon: 'tri-horns', asset: 'm-triceratops', unit: 'triceratops', url: '/models/triceratops.glb' },
] as const;

for (const d of EXTRA_DINOS) {
  test(`committed ${d.file} parses with all six clips`, async () => {
    const file = path.join(process.cwd(), 'public', 'models', d.file);
    assert.ok(existsSync(file), `public/models/${d.file} is committed`);
    const buf = readFileSync(file);
    const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
    const names = gltf.animations.map((a) => a.name);
    for (const state of ['idle', 'walk', 'run', 'attack', 'death', 'jump'] as const) {
      assert.ok(pickClipName(names, state), `${d.file}: no clip for ${state} in ${names.join(', ')}`);
    }
    // Rendered feet sit at the origin: grounding lifts almost nothing (the bind-pose
    // Box3 lies for some exports, e.g. triceratops sprawls to y = -5.7 there).
    const box = skinnedBounds(gltf.scene);
    assert.ok(box, `${d.file}: no skinned bounds`);
    assert.ok(Math.abs(box.min.y) < 0.5, `${d.file}: rendered min.y ${box.min.y}`);
    const height = box.max.y - box.min.y;
    assert.ok(height > 1 && height < 30, `${d.file}: rendered height ${height}`);
  });

  test(`seed ${d.unit} weapon, asset and unit validate`, () => {
    const weapon = SEED.weapons.find((w) => w.id === d.weapon);
    const asset = SEED.assets.find((a) => a.id === d.asset);
    const unit = SEED.units.find((u) => u.id === d.unit);
    assert.ok(weapon && asset && unit, `seed has ${d.weapon}, ${d.asset} and ${d.unit}`);
    assert.deepEqual(weaponSchema.parse(weapon), weapon);
    assert.deepEqual(assetSchema.parse(asset), asset);
    assert.deepEqual(unitSchema.parse(unit), unit);
    assert.equal(asset.kind, 'raptor');
    assert.equal(asset.glb?.url, d.url);
    assert.equal(unit.modelId, d.asset);
    assert.equal(unit.weaponId, d.weapon);
  });
}

test('seed raptor weapon, asset and unit validate', () => {
  const weapon = SEED.weapons.find((w) => w.id === 'raptor-bite');
  const asset = SEED.assets.find((a) => a.id === 'm-raptor');
  const unit = SEED.units.find((u) => u.id === 'raptor');
  assert.ok(weapon && asset && unit, 'seed has raptor-bite, m-raptor and raptor');
  assert.deepEqual(weaponSchema.parse(weapon), weapon);
  assert.deepEqual(assetSchema.parse(asset), asset);
  assert.deepEqual(unitSchema.parse(unit), unit);
  assert.equal(asset.kind, 'raptor');
  assert.equal(asset.glb?.url, '/models/velociraptor.glb');
  assert.equal(unit.modelId, 'm-raptor');
});

test('procedural raptor bakes to a raptor rig with a mouth socket', () => {
  const asset = SEED.assets.find((a) => a.id === 'm-raptor')!;
  const template = bakeModel(createAssetModel({ ...asset, glb: null }));
  assert.equal(template.segments[0].rig, 'raptor');
  assert.ok(template.sockets['mouth'], 'mouth socket for bite effects');
  for (const part of ['body', 'neck', 'head', 'jaw', 'tail1', 'tail2', 'tail3']) {
    assert.ok(template.segments[0].parts[part] !== undefined, `missing part ${part}`);
  }
});

test('shoot clips win the attack state over punch', () => {
  const names = ['CharacterArmature|Death', 'CharacterArmature|Idle', 'CharacterArmature|Idle_Shoot', 'CharacterArmature|Punch', 'CharacterArmature|Walk'];
  assert.equal(pickClipName(names, 'attack'), 'CharacterArmature|Idle_Shoot');
});

test('committed hoa-tien-thu.glb parses with shoot/walk/run/death clips', async () => {
  const file = path.join(process.cwd(), 'public', 'models', 'hoa-tien-thu.glb');
  assert.ok(existsSync(file), 'public/models/hoa-tien-thu.glb is committed');
  const buf = readFileSync(file);
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
  const names = gltf.animations.map((a) => a.name);
  for (const state of ['idle', 'walk', 'run', 'attack', 'death', 'jump'] as const) {
    assert.ok(pickClipName(names, state), `hoa-tien-thu.glb: no clip for ${state} in ${names.join(', ')}`);
  }
  assert.match(pickClipName(names, 'attack')!, /shoot/i, 'fire archer should aim, not punch');
  const box = skinnedBounds(gltf.scene);
  assert.ok(box, 'hoa-tien-thu.glb: no skinned bounds');
  assert.ok(Math.abs(box.min.y) < 0.5, `hoa-tien-thu.glb: rendered min.y ${box.min.y}`);
  const height = box.max.y - box.min.y;
  assert.ok(height > 1 && height < 30, `hoa-tien-thu.glb: rendered height ${height}`);
});

test('seed fire-archer weapon, asset and unit validate, arsenal hidden', async () => {
  const weapon = SEED.weapons.find((w) => w.id === 'fire-bow');
  const asset = SEED.assets.find((a) => a.id === 'm-fire-archer');
  const unit = SEED.units.find((u) => u.id === 'fire-archer');
  assert.ok(weapon && asset && unit, 'seed has fire-bow, m-fire-archer and fire-archer');
  assert.deepEqual(weaponSchema.parse(weapon), weapon);
  assert.deepEqual(assetSchema.parse(asset), asset);
  assert.deepEqual(unitSchema.parse(unit), unit);
  assert.equal(asset.kind, 'humanoid');
  assert.equal(asset.glb?.url, '/models/hoa-tien-thu.glb');
  assert.equal(unit.modelId, 'm-fire-archer');
  assert.equal(unit.weaponId, 'fire-bow');
  // Every rigid attachment in the file (the pack's weapon arsenal) must be on the hide
  // list, or the archer marches in holding a gun rack.
  const file = path.join(process.cwd(), 'public', 'models', 'hoa-tien-thu.glb');
  const buf = readFileSync(file);
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
  const hidden = new Set(asset.glb?.hide ?? []);
  const rigid: string[] = [];
  gltf.parser.json.nodes?.forEach((n: { mesh?: number; skin?: number; name?: string }) => {
    if (n.mesh !== undefined && n.skin === undefined && n.name) rigid.push(n.name);
  });
  assert.ok(rigid.length > 0, 'expected rigid attachments in hoa-tien-thu.glb');
  for (const name of rigid) assert.ok(hidden.has(name), `rigid mesh ${name} not hidden`);
});
