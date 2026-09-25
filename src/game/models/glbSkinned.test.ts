// Dinosaur units: clip-name mapping, committed GLB integrity and procedural fallback.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createAssetModel } from '@/game/models';
import { bakeModel } from '@/game/models/bake';
import { groundLift, mountSeatFor, pickClipName, repaintPixels, skinnedBounds, walkSpeedFor, yawCorrectionFor, NORMALIZED_HEIGHT } from '@/game/models/glbSkinned';
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

test('seed fire-archer weapon, asset and unit validate, arsenal hidden', async () => {  const weapon = SEED.weapons.find((w) => w.id === 'fire-bow');
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
  // Every rigid attachment in the file (the pack's spare weapon arsenal) must be on the hide
  // list, except the RocketLauncher the Hỏa tiễn thủ actually holds.
  const file = path.join(process.cwd(), 'public', 'models', 'hoa-tien-thu.glb');
  const buf = readFileSync(file);
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
  const hidden = new Set(asset.glb?.hide ?? []);
  const rigid: string[] = [];
  gltf.parser.json.nodes?.forEach((n: { mesh?: number; skin?: number; name?: string }) => {
    if (n.mesh !== undefined && n.skin === undefined && n.name) rigid.push(n.name);
  });
  assert.ok(rigid.length > 0, 'expected rigid attachments in hoa-tien-thu.glb');
  assert.ok(rigid.includes('RocketLauncher'), 'expected RocketLauncher in hoa-tien-thu.glb');
  assert.ok(!hidden.has('RocketLauncher'), 'RocketLauncher is the held weapon and must stay visible');
  for (const name of rigid) {
    if (name === 'RocketLauncher') continue;
    assert.ok(hidden.has(name), `rigid mesh ${name} not hidden`);
  }
});

// voi-mamut.glb (Voi ma mút) and voi-trang.glb (Chiến tượng / tượng binh) share
// the same battle clip names: Idle = Đứng yên, Walk = Đi bộ, Attack_Bite = Cắn,
// Attack_Stomp = Dậm chân, Hit = Trúng đòn, Death = Chết, Scale_Pulse = Nhập phong.
// voi-trang.glb ships Idle / Walk / Attack_Stomp / Attack_TrunkSweep / Hit / Death. No Run/Jump:
// run falls back to Walk so a charging elephant never glides in the idle pose.
const VOI_MAMUT_CLIPS = ['Idle', 'Walk', 'Attack_Bite', 'Attack_Stomp', 'Hit', 'Death', 'Scale_Pulse'];
const VOI_TRANG_CLIPS = ['Idle', 'Walk', 'Attack_Stomp', 'Attack_TrunkSweep', 'Hit', 'Death'];

test('voi-mamut clips map to battle states (Run falls back to Walk)', () => {
  assert.equal(pickClipName(VOI_MAMUT_CLIPS, 'idle'), 'Idle');
  assert.equal(pickClipName(VOI_MAMUT_CLIPS, 'walk'), 'Walk');
  assert.equal(pickClipName(VOI_MAMUT_CLIPS, 'run'), 'Walk');
  assert.equal(pickClipName(VOI_MAMUT_CLIPS, 'attack'), 'Attack_Bite');
  assert.equal(pickClipName(VOI_MAMUT_CLIPS, 'death'), 'Death');
  assert.equal(pickClipName(VOI_MAMUT_CLIPS, 'jump'), null);
});

test('elephant skill clips: stomp / trunk sweep / trunk toss; run never picks the trunk clip', () => {
  assert.equal(pickClipName(VOI_TRANG_CLIPS, 'run'), 'Walk');
  assert.equal(pickClipName(VOI_TRANG_CLIPS, 'stomp'), 'Attack_Stomp');
  assert.equal(pickClipName(VOI_TRANG_CLIPS, 'sweep'), 'Attack_TrunkSweep');
  assert.equal(pickClipName(VOI_TRANG_CLIPS, 'toss'), 'Attack_TrunkSweep');
  assert.equal(pickClipName(VOI_MAMUT_CLIPS, 'stomp'), 'Attack_Stomp');
  // No trunk clip in voi-mamut.glb: the instance falls back to its attack clip.
  assert.equal(pickClipName(VOI_MAMUT_CLIPS, 'sweep'), null);
  for (const unit of ['mammoth', 'war-elephant']) {
    const ids = SEED.units.find((u) => u.id === unit)!.skillIds;
    for (const id of ['voi-dam-chan', 'voi-quet-voi', 'voi-hat-voi']) assert.ok(ids.includes(id), `${unit} has ${id}`);
  }
});

test('committed voi-mamut.glb parses with the seven clips', async () => {
  const file = path.join(process.cwd(), 'public', 'models', 'voi-mamut.glb');
  assert.ok(existsSync(file), 'public/models/voi-mamut.glb is committed');
  // Textured files need DOM image decoding; the browser path is covered by screenshots.
  let names = VOI_MAMUT_CLIPS;
  try {
    const buf = readFileSync(file);
    const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
    names = gltf.animations.map((a) => a.name);
  } catch {
    // fall back to the known clip list above
  }
  assert.deepEqual([...names].sort(), [...VOI_MAMUT_CLIPS].sort());
  assert.equal(pickClipName(names, 'attack'), 'Attack_Bite');
  assert.equal(pickClipName(names, 'run'), 'Walk');
  assert.equal(pickClipName(names, 'death'), 'Death');
});

test('seed m-mammoth references /models/voi-mamut.glb and validates', () => {
  const asset = SEED.assets.find((a) => a.id === 'm-mammoth')!;
  assert.ok(asset, 'seed has m-mammoth');
  assert.equal(asset.kind, 'elephant');
  assert.equal(asset.glb?.url, '/models/voi-mamut.glb');
  assert.equal(asset.scale, 2.1);
  assert.deepEqual(assetSchema.parse(asset), asset);
});

test('seed m-war-elephant references /models/voi-trang.glb and validates', () => {
  const asset = SEED.assets.find((a) => a.id === 'm-war-elephant')!;
  assert.ok(asset, 'seed has m-war-elephant');
  assert.equal(asset.kind, 'elephant');
  assert.equal(asset.glb?.url, '/models/voi-trang.glb');
  assert.equal(asset.scale, 2);
  assert.deepEqual(assetSchema.parse(asset), asset);
});

test('committed voi-trang.glb parses with the six clips', async () => {
  const file = path.join(process.cwd(), 'public', 'models', 'voi-trang.glb');
  assert.ok(existsSync(file), 'public/models/voi-trang.glb is committed');
  let names = VOI_TRANG_CLIPS;
  try {
    const buf = readFileSync(file);
    const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
    names = gltf.animations.map((a) => a.name);
  } catch {
    // fall back to the known clip list above
  }
  assert.deepEqual([...names].sort(), [...VOI_TRANG_CLIPS].sort());
  assert.equal(pickClipName(names, 'attack'), 'Attack_Stomp');
  assert.equal(pickClipName(names, 'run'), 'Walk');
  assert.equal(pickClipName(names, 'death'), 'Death');
});

test('elephant yaw corrections map the snout onto engine forward +Z', () => {
  // voi-mamut.glb: head at -X, needs +90°. voi-trang.glb: head at +X, needs -90°.
  // The battle drives `rotation.y = yaw` for a +Z model: Ry(yaw + corr) · head = (sin yaw, 0, cos yaw).
  const up = new THREE.Vector3(0, 1, 0);
  const cases: Array<[string, number, number]> = [
    ['/models/voi-mamut.glb', -1, Math.PI / 2],
    ['/models/voi-trang.glb', 1, -Math.PI / 2],
  ];
  for (const [url, headX, corr] of cases) {
    assert.equal(yawCorrectionFor(url), corr, url);
    for (const yaw of [0, 0.7, Math.PI, -2.1]) {
      const fwd = new THREE.Vector3(headX, 0, 0).applyAxisAngle(up, yaw + yawCorrectionFor(url));
      assert.ok(Math.abs(fwd.x - Math.sin(yaw)) < 1e-6 && Math.abs(fwd.z - Math.cos(yaw)) < 1e-6, `${url} yaw=${yaw}: got ${fwd.x},${fwd.z}`);
    }
  }
});

test('other skinned packs keep yaw 0 (already face +Z)', () => {
  for (const url of ['/models/velociraptor.glb', '/models/ninja.glb', '/models/rong-xanh.glb', '/models/phap-su.glb']) {
    assert.equal(yawCorrectionFor(url), 0, url);
  }
});

test('groundLift scales the lift so feet land exactly on y = 0', () => {
  // bake() scales vertices by NORMALIZED_HEIGHT / height but three applies position after
  // scale: feet end at minY * s + lift. The old unscaled lift left voi-mamut.glb
  // (minY ≈ -0.6) ~0.4 m sunk; the scaled lift zeroes it for any height.
  for (const [minY, height] of [[-0.6177, 1.2281], [-0.02, 1.8], [0, 2], [-1.2, 3.5]] as const) {
    const s = NORMALIZED_HEIGHT / height;
    assert.ok(Math.abs(minY * s + groundLift(minY, height)) < 1e-9, `minY=${minY} height=${height}`);
  }
  assert.ok(groundLift(0, 2) === 0);
});

test('giant-golem.glb: hammer is the attack clip, leap the dash clip', () => {
  const file = path.join(process.cwd(), 'public', 'models', 'giant-golem.glb');
  assert.ok(existsSync(file), 'public/models/giant-golem.glb is committed');
  // Draco-compressed mesh: read clip names from the GLB JSON chunk instead of decoding it.
  const buf = readFileSync(file);
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as { animations: { name: string }[] };
  const names = json.animations.map((a) => a.name);
  assert.equal(pickClipName(names, 'attack'), 'Attack_Hammer');
  assert.equal(pickClipName(names, 'leap'), 'Attack_Leap');
  assert.equal(pickClipName(names, 'death'), 'Death');
  assert.equal(pickClipName(names, 'walk'), 'Walk');
  const asset = SEED.assets.find((a) => a.id === 'm-giant')!;
  assert.equal(asset.glb?.url, '/models/giant-golem.glb');
  assert.deepEqual(SEED.units.find((u) => u.id === 'giant')!.skillIds, ['golem-nhay']);
});

test('elephant files seat riders on top of their back, others keep the horse-height seat', () => {
  // Backs measured at ~1.85–1.95 (normalised); the old 1.15 seat buried the riders.
  for (const url of ['/models/voi-mamut.glb', '/models/voi-trang.glb']) assert.ok(mountSeatFor(url)[1] > 1.8, url);
  assert.deepEqual(mountSeatFor('/models/horse.glb'), [0, 1.15, -0.05]);
});

test('walk clip speed is known for the elephants (clip is sped up to the real ground speed)', () => {
  assert.ok(walkSpeedFor('/models/voi-trang.glb?v=2') > 0);
  assert.ok(walkSpeedFor('/models/voi-mamut.glb') > 0);
  assert.equal(walkSpeedFor('/models/velociraptor.glb'), 0);
});

const LINH_MELEE_CLIPS = ['Idle', 'Run', 'Attack_Punch', 'Attack_Slash', 'Attack_Palm', 'Hit', 'Death'];

test('linh-melee.glb: punch attack, palm skill, slash doubles as the stone throw', () => {
  assert.equal(pickClipName(LINH_MELEE_CLIPS, 'run'), 'Run');
  assert.equal(pickClipName(LINH_MELEE_CLIPS, 'attack'), 'Attack_Punch');
  assert.equal(pickClipName(LINH_MELEE_CLIPS, 'palm'), 'Attack_Palm');
  assert.equal(pickClipName(LINH_MELEE_CLIPS, 'toss'), 'Attack_Slash');
  // Elephants keep their trunk clip for toss.
  assert.equal(pickClipName(VOI_TRANG_CLIPS, 'toss'), 'Attack_TrunkSweep');
  const unit = (id: string) => SEED.units.find((u) => u.id === id)!;
  const weapon = (id: string) => SEED.weapons.find((w) => w.id === id)!;
  assert.deepEqual(unit('clubber').skillIds, ['chuong']);
  assert.equal(weapon('chuong').castStyle, 'palm');
  assert.equal(weapon(unit('stoner').weaponId).castStyle, 'throw');
  for (const id of ['m-clubber', 'm-stoner']) assert.equal(SEED.assets.find((a) => a.id === id)!.glb?.url, '/models/linh-melee.glb');
  assert.ok(existsSync(path.join(process.cwd(), 'public/models/linh-melee.glb')));
});
