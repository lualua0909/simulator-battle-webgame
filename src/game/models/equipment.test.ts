// Equipment as standalone assets: loadout resolution, procedural sockets, skeletal grips and swaps.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as THREE from 'three';
import { createUnitModel } from '@/game/models';
import { bakeModel } from '@/game/models/bake';
import { itemOf, legacyEquipment, swungWeapon, unitEquipment, type EquipItem } from '@/game/models/equipment';
import { mountOnBones, pickBodyBone, pickHandBone, solveGrips } from '@/game/models/glbEquipment';
import { equipSkinned, type SkinnedInstance, type SkinState } from '@/game/models/glbSkinned';
import { assetSchema, unitSchema, type AssetDef } from '@/shared/schema';
import { SEED } from '@/shared/seed';

const assets = new Map(SEED.assets.map((a) => [a.id, a]));
const unit = (id: string) => SEED.units.find((u) => u.id === id)!;
const item = (id: string, slot: EquipItem['slot']) => itemOf(assets.get(id)!, slot);

test('seed equipment assets and loadouts validate', () => {
  for (const a of SEED.assets.filter((a) => a.kind === 'equipment')) assert.deepEqual(assetSchema.parse(a), a);
  for (const u of SEED.units) assert.deepEqual(unitSchema.parse(u), u);
  // Old documents without the field read as "no equipment" (legacy look).
  const { equipment: _, ...old } = unit('squire');
  assert.deepEqual(unitSchema.parse(old).equipment, { handR: null, handL: null, back: null, hipL: null, hipR: null });
});

test('unit loadouts: explicit slots win, empty slots fall back to the legacy built-in weapon', () => {
  const squire = unitEquipment(unit('squire'), assets);
  assert.deepEqual(squire.model.map((i) => [i.slot, i.item]), [['handR', 'sword'], ['handL', 'shield-kite']]);
  assert.equal(squire.model[1].colors.shield, '#2f5fb3');
  // The lance rides with the knight, not the horse.
  const cavalry = unitEquipment(unit('cavalry'), assets);
  assert.deepEqual(cavalry.model, []);
  assert.deepEqual(cavalry.rider.map((i) => i.item), ['lance']);
  // A legacy character asset (weapon baked into its params) keeps its look while the unit has no equipment.
  const legacy: AssetDef = { ...assets.get('m-squire')!, id: 'm-old', params: { weapon: 'bow', offhand: 'buckler' } };
  const old = { ...unit('squire'), modelId: 'm-old', equipment: { handR: null, handL: null, back: null, hipL: null, hipR: null } };
  assert.deepEqual(unitEquipment(old, new Map([...assets, ['m-old', legacy]])).model.map((i) => [i.slot, i.item]), [['handL', 'bow']]);
  // Uploaded skeletal characters never get the legacy weapon (their file may carry its own).
  assert.deepEqual(legacyEquipment({ ...legacy, glb: assets.get('m-clubber')!.glb }), []);
  // Non-equipment ids in a slot are ignored.
  assert.deepEqual(unitEquipment({ ...unit('squire'), equipment: { ...unit('squire').equipment, back: 'm-warhorse' } }, assets).model.length, 2);
  assert.ok(swungWeapon(unitEquipment(unit('clubber'), assets).model));
  assert.ok(!swungWeapon(unitEquipment(unit('stoner'), assets).model));
  assert.ok(!swungWeapon([item('e-kite-shield', 'handL')]));
});

test('procedural characters bake equipment as animated parts on their sockets', () => {
  const squire = bakeModel(createUnitModel(unit('squire'), assets));
  const seg = squire.segments[0];
  assert.equal(seg.meta.weapon, 'sword');
  assert.equal(seg.meta.weaponHand, 'R');
  const weapon = squire.parts[seg.parts.weapon];
  const shield = squire.parts[seg.parts.offhand];
  assert.equal(squire.parts[weapon.parent].local, 'forearmR');
  assert.equal(squire.parts[shield.parent].local, 'forearmL');
  assert.ok(weapon.detachable && shield.detachable && weapon.geometry && shield.geometry);
  // Bows are held left; the rider carries the cavalry lance.
  const archer = bakeModel(createUnitModel(unit('archer'), assets));
  assert.equal(archer.segments[0].meta.weaponHand, 'L');
  assert.equal(archer.parts[archer.parts[archer.segments[0].parts.weapon].parent].local, 'forearmL');
  const cavalry = bakeModel(createUnitModel(unit('cavalry'), assets));
  const rider = cavalry.segments.find((s) => s.prefix === 'rider.')!;
  assert.equal(rider.meta.weapon, 'lance');
  assert.ok(cavalry.parts.some((p) => p.name === 'rider.weapon'));
  // Worn slots: a sword on the back sits behind the torso, one on the left hip on the left of the pelvis.
  const worn = bakeModel(createUnitModel({ ...unit('squire'), equipment: { handR: null, handL: null, back: 'e-sword', hipL: 'e-sword', hipR: null } }, assets));
  const back = worn.parts[worn.segments[0].parts['gear.back']];
  const hip = worn.parts[worn.segments[0].parts['gear.hipL']];
  assert.equal(worn.parts[back.parent].local, 'torso');
  assert.equal(worn.parts[hip.parent].local, 'hips');
  assert.ok(new THREE.Vector3().setFromMatrixPosition(back.rest).z < 0);
  assert.ok(new THREE.Vector3().setFromMatrixPosition(hip.rest).x > 0);
  assert.equal(worn.segments[0].meta.weapon, 'none');
  assert.equal(worn.segments[0].parts.weapon, undefined);
});

test('hand and body bones are found across rig naming schemes', () => {
  const linh = ['Root', 'Hips', 'Spine', 'Chest', 'LeftUpperArm', 'LeftLowerArm', 'LeftHand', 'RightUpperArm', 'RightLowerArm', 'RightHand'];
  assert.equal(pickHandBone(linh, 'R'), 'RightHand');
  assert.equal(pickHandBone(linh, 'L'), 'LeftHand');
  assert.equal(pickBodyBone(linh, 'back'), 'Chest');
  assert.equal(pickBodyBone(linh, 'hip'), 'Hips');
  // Quaternius: a dedicated weapon bone beats the fist; its _end leaf never matches.
  const quat = ['Fist1.R', 'Weapon.R', 'Weapon.R_end', 'Fist1.L', 'Weapon.L', 'Hips', 'Abdomen', 'Torso'];
  assert.equal(pickHandBone(quat, 'R'), 'Weapon.R');
  assert.equal(pickHandBone(quat, 'L'), 'Weapon.L');
  assert.equal(pickBodyBone(quat, 'back'), 'Torso');
  // No hand bones (ninja.glb): the forearm carries the grip.
  assert.equal(pickHandBone(['UpperArm.R', 'LowerArm.R', 'LowerArm.L'], 'R'), 'LowerArm.R');
  assert.equal(pickHandBone(['mixamorig:RightHandThumb1', 'mixamorig:RightHand'], 'R'), 'mixamorig:RightHand');
  assert.equal(pickHandBone(['hand_l', 'hand_r'], 'R'), 'hand_r');
  // Angel wings carry "Hand" in their names: never a weapon grip.
  assert.equal(pickHandBone(['WingHandR', 'RightHand'], 'R'), 'RightHand');
  assert.equal(pickHandBone(['WingHandR', 'Head'], 'R'), null);
});

/** The file's bone hierarchy in its rest pose (the mesh is Draco-compressed; grips only need bones). */
function restSkeleton(file: string): THREE.Group {
  const buf = readFileSync(path.join(process.cwd(), 'public/models', file));
  type Node = { name?: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] };
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as { nodes: Node[]; skins: { joints: number[] }[] };
  const joints = new Set(json.skins.flatMap((s) => s.joints));
  const objs = json.nodes.map((n, i) => {
    const o = joints.has(i) ? new THREE.Bone() : new THREE.Object3D();
    o.name = n.name ?? '';
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  const root = new THREE.Group();
  json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => objs[i].add(objs[c])));
  for (const o of objs) if (!o.parent) root.add(o);
  return root;
}

const worldOf = (o: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);

test('linh-melee.glb grips a sword in its right fist, blade forward, shield on the left', () => {
  const root = restSkeleton('linh-melee.glb');
  const { sockets } = mountOnBones(root, solveGrips(root), [item('e-sword', 'handR'), item('e-kite-shield', 'handL')]);
  const gripR = sockets.get('hand.R')!;
  const gripL = sockets.get('hand.L')!;
  assert.equal(gripR.parent?.name, 'RightHand');
  assert.equal(gripL.parent?.name, 'LeftHand');
  root.updateMatrixWorld(true);
  const hand = worldOf(root.getObjectByName('RightHand')!);
  const along = worldOf(root.getObjectByName('sword-tip')!).sub(hand);
  // Rest pose is a T-pose facing +Z: the blade leaves the fist forward, level with the hand.
  assert.ok(along.z > 0.6 * along.length(), `blade not forward: ${along.toArray()}`);
  // The grip moved into the fist: further out along the right arm (-X) than the wrist.
  assert.ok(worldOf(gripR).x < hand.x);
  // Shield face points up out of the back of the palm-down left hand.
  const face = new THREE.Vector3(0, 0, 1).transformDirection(gripL.matrixWorld);
  assert.ok(face.y > 0.9, `shield face ${face.toArray()}`);
});

test('glb back and hip slots hang behind the chest and at the side of the hips', () => {
  const root = restSkeleton('linh-melee.glb');
  const { sockets } = mountOnBones(root, solveGrips(root), [item('e-spear', 'back'), item('e-sword', 'hipR')]);
  root.updateMatrixWorld(true);
  assert.equal(sockets.get('back')!.parent?.name, 'Chest');
  assert.equal(sockets.get('hip.R')!.parent?.name, 'Hips');
  const chest = worldOf(root.getObjectByName('Chest')!);
  const hips = worldOf(root.getObjectByName('Hips')!);
  assert.ok(worldOf(sockets.get('back')!).z < chest.z);
  assert.ok(worldOf(sockets.get('hip.R')!).x < hips.x);
  // Sheathed: the blade points down from the hip.
  const blade = new THREE.Vector3(0, 1, 0).transformDirection(sockets.get('hip.R')!.matrixWorld);
  assert.ok(blade.y < -0.8, `blade ${blade.toArray()}`);
});

test('ninja.glb (no hand bones) grips at the end of the forearm', () => {
  const root = restSkeleton('ninja.glb');
  const { sockets } = mountOnBones(root, solveGrips(root), [item('e-sword', 'handR')]);
  root.updateMatrixWorld(true);
  const grip = sockets.get('hand.R')!;
  assert.equal(grip.parent?.name, 'LowerArm.R');
  const elbow = worldOf(grip.parent!);
  const shoulder = worldOf(grip.parent!.parent!);
  // Past the elbow by about one forearm (≈ the upper arm).
  assert.ok(elbow.x - worldOf(grip).x > 0.8 * (shoulder.x - elbow.x));
});

test('equipSkinned swaps items and the attack clip on a live clone', () => {
  const root = restSkeleton('linh-melee.glb');
  const mixer = new THREE.AnimationMixer(root);
  const clip = (name: string) => mixer.clipAction(new THREE.AnimationClip(name, 1, []));
  const idle = clip('Idle');
  const punch = clip('Punch');
  const slash = clip('Attack_Slash');
  const actions = new Map<SkinState, THREE.AnimationAction>([['idle', idle], ['attack', punch], ['stomp', punch], ['toss', punch]]);
  const inst: SkinnedInstance = { group: root, mixer, actions, current: null, settled: false, sockets: new Map(), grips: solveGrips(root), mounts: [], base: new Map(actions), slash };
  const bones = () => {
    let n = 0;
    root.traverse((o) => void (o.userData.socket && o.parent && (o.parent as THREE.Bone).isBone && n++));
    return n;
  };
  equipSkinned(inst, [item('e-club', 'handR')]);
  assert.equal(inst.actions.get('attack'), slash);
  assert.equal(inst.actions.get('stomp'), slash);
  assert.ok(inst.sockets.has('hand.R'));
  inst.current = 'attack';
  // Swap mid-swing to a thrown stone: old grip leaves, punch returns, the state restarts.
  equipSkinned(inst, [item('e-stone', 'handR'), item('e-kite-shield', 'handL')]);
  assert.equal(inst.actions.get('attack'), punch);
  assert.equal(inst.actions.get('idle'), idle);
  assert.equal(inst.current, null);
  assert.equal(bones(), 2);
  assert.ok(root.getObjectByName('held-stone') && !root.getObjectByName('club-head'));
  equipSkinned(inst, []);
  assert.equal(bones(), 0);
  assert.equal(inst.sockets.size, 0);
});

