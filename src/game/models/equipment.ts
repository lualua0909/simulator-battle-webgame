// Equipment: weapons and shields are their own assets (kind `equipment`), carried by a unit on
// named slots of its character (UnitDef.equipment). One resolved loadout feeds both render paths:
//  - procedural characters: mountEquipment() hangs each item on the matching socket as a rigid
//    part ('weapon' / 'offhand' / 'gear.<slot>'), so the Poser animates it and ragdolls drop it;
//  - skeletal .glb characters: glbEquipment.ts grips the same models on the file's bones.
// Item frame (models/weapons.ts): grip at the origin, +Y along the item, +Z its facing side.
import * as THREE from 'three';
import { EQUIP_SLOTS, HELD_SHIELDS, parseAssetParams, type AssetDef, type EquipSlot, type UnitDef } from '@/shared/schema';
import { part, type Vec3 } from './common';
import { getCustomGlbGroup } from './glbStatic';
import { createOffhandModel, createWeaponModel, type OffhandKind, type WeaponKind } from './weapons';

export type EquipItemKind = Exclude<WeaponKind, 'none'> | Exclude<OffhandKind, 'none'>;

/** One item as carried: its slot, look (procedural `item` or an uploaded static .glb) and size. */
export interface EquipItem {
  slot: EquipSlot;
  item: EquipItemKind;
  colors: { wood: string; metal: string; orb: string; shield: string };
  scale: number;
  glbUrl: string | null;
}

/** Socket (procedural `userData.socket`, skinned `SkinnedInstance.sockets`) each slot mounts on. */
export const SLOT_SOCKET: Record<EquipSlot, string> = { handR: 'hand.R', handL: 'hand.L', back: 'back', hipL: 'hip.L', hipR: 'hip.R' };

export function isHandSlot(slot: EquipSlot): slot is 'handR' | 'handL' {
  return slot === 'handR' || slot === 'handL';
}

export function isShield(item: EquipItemKind): boolean {
  return (HELD_SHIELDS as readonly string[]).includes(item);
}

/** An equipment asset carried on `slot`. */
export function itemOf(asset: AssetDef, slot: EquipSlot): EquipItem {
  const p = parseAssetParams('equipment', asset.params);
  return { slot, item: p.item, colors: { wood: p.woodColor, metal: p.metalColor, orb: p.orbColor, shield: p.shieldColor }, scale: asset.scale, glbUrl: asset.glb?.url ?? null };
}

/**
 * The built-in weapon of a procedural humanoid asset (`params.weapon`/`offhand`), from before
 * equipment became its own asset. Uploaded .glb characters never get it: their files may carry
 * their own weapon mesh.
 */
export function legacyEquipment(asset: AssetDef | undefined): EquipItem[] {
  if (!asset || asset.kind !== 'humanoid' || asset.glb) return [];
  const p = parseAssetParams('humanoid', asset.params);
  const colors = { wood: p.woodColor, metal: p.metalColor, orb: p.orbColor, shield: p.shieldColor };
  const items: EquipItem[] = [];
  if (p.weapon !== 'none') items.push({ slot: p.weapon === 'bow' ? 'handL' : 'handR', item: p.weapon, colors, scale: 1, glbUrl: null });
  if (p.offhand !== 'none' && p.weapon !== 'bow') items.push({ slot: 'handL', item: p.offhand, colors, scale: 1, glbUrl: null });
  return items;
}

/**
 * A unit's resolved loadout, split by who carries it: the model itself when it is a humanoid,
 * else its rider. Explicit `unit.equipment` slots win; all empty = the legacy built-in weapon.
 */
export function unitEquipment(unit: Pick<UnitDef, 'modelId' | 'riderModelId'> & { equipment?: UnitDef['equipment'] }, assets: ReadonlyMap<string, AssetDef>): { model: EquipItem[]; rider: EquipItem[] } {
  const base = assets.get(unit.modelId);
  const rider = unit.riderModelId ? assets.get(unit.riderModelId) : undefined;
  const holder = base?.kind === 'humanoid' ? 'model' : rider?.kind === 'humanoid' ? 'rider' : null;
  const slots = unit.equipment;
  let items: EquipItem[];
  if (slots && EQUIP_SLOTS.some((s) => slots[s])) {
    items = EQUIP_SLOTS.flatMap((slot) => {
      const a = slots[slot] ? assets.get(slots[slot]!) : undefined;
      return a?.kind === 'equipment' ? [itemOf(a, slot)] : [];
    });
  } else {
    items = legacyEquipment(holder === 'rider' ? rider : base);
  }
  return { model: holder === 'model' ? items : [], rider: holder === 'rider' ? items : [] };
}

/** Cache key of a loadout (includes whether uploaded item files have loaded yet). */
export function equipmentKey(items: readonly EquipItem[]): string {
  return items.length ? JSON.stringify(items.map((i) => [i, equipmentReady(i)])) : '';
}

/** The weapon the attack animation follows: held in the right hand, else the left. */
export function mainWeapon(items: readonly EquipItem[]): EquipItem | null {
  const held = (slot: EquipSlot) => items.find((i) => i.slot === slot && !isShield(i.item));
  return held('handR') ?? held('handL') ?? null;
}

const SWUNG: ReadonlySet<string> = new Set(['club', 'bigclub', 'sword', 'katana', 'axe', 'hammer', 'spear', 'lance', 'pitchfork']);

/** Loadouts whose main weapon is swung in melee: skeletal holders play the file's slash clip, not its punch. */
export function swungWeapon(items: readonly EquipItem[]): boolean {
  const main = mainWeapon(items);
  return !!main && SWUNG.has(main.item);
}

/** False while an uploaded item file is still loading (its procedural look stands in). */
export function equipmentReady(item: EquipItem): boolean {
  return !item.glbUrl || getCustomGlbGroup(item.glbUrl) !== undefined;
}

/** The item's model in the item frame, sized by its asset scale (no rig: it joins its holder's). */
export function createEquipmentModel(item: EquipItem): THREE.Group | null {
  let g: THREE.Group | null = null;
  const uploaded = item.glbUrl ? getCustomGlbGroup(item.glbUrl) : undefined;
  if (uploaded) {
    // Baked upright on y = 0 (glbStatic ground()): the file's bottom end is the grip.
    g = new THREE.Group();
    g.name = `equipment-${item.item}`;
    for (const c of [...uploaded.children]) g.add(c);
  } else if (isShield(item.item)) {
    g = createOffhandModel(item.item as OffhandKind, item.colors);
  } else {
    g = createWeaponModel(item.item as WeaponKind, item.colors);
  }
  if (g) g.scale.setScalar(item.scale);
  return g;
}

/** Slung across the back: item leans ~30° toward the left shoulder. */
const BACK_TILT = 0.5;
/** Sheathed at the belt: grip forward, blade down and back. */
const HIP_TILT = 0.35;

/**
 * Rest-pose basis (character space, facing +Z, left = +X) of a body slot: item +Y along the
 * item, +Z out of the body. Shared by the procedural sockets and the skeletal grips.
 */
export function slotBasis(slot: 'back' | 'hipL' | 'hipR'): { y: THREE.Vector3; z: THREE.Vector3 } {
  if (slot === 'back') return { y: new THREE.Vector3(Math.sin(BACK_TILT), Math.cos(BACK_TILT), 0), z: new THREE.Vector3(0, 0, -1) };
  return { y: new THREE.Vector3(0, -Math.cos(HIP_TILT), -Math.sin(HIP_TILT)), z: new THREE.Vector3(slot === 'hipL' ? 1 : -1, 0, 0) };
}

export function slotQuaternion(slot: 'back' | 'hipL' | 'hipR', out = new THREE.Quaternion()): THREE.Quaternion {
  const { y, z } = slotBasis(slot);
  const x = new THREE.Vector3().crossVectors(y, z);
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

export function slotEuler(slot: 'back' | 'hipL' | 'hipR'): Vec3 {
  const e = new THREE.Euler().setFromQuaternion(slotQuaternion(slot));
  return [e.x, e.y, e.z];
}

/**
 * Hangs `items` on the sockets of a procedural character (before baking). Each item becomes a
 * rigid part under its socket: the held weapon `weapon`, a shield or second hand item `offhand`
 * (both fall away on death), anything worn `gear.<slot>`. The character root's userData
 * (`weapon`, `weaponHand`) tells the Poser which attack style and arm to use.
 */
export function mountEquipment(root: THREE.Object3D, items: readonly EquipItem[]): void {
  const sockets = new Map<string, THREE.Object3D>();
  root.traverse((o) => {
    if (o.userData.socket && !sockets.has(o.userData.socket)) sockets.set(o.userData.socket as string, o);
  });
  const main = mainWeapon(items);
  root.userData.weapon = main?.item ?? 'none';
  root.userData.weaponHand = main?.slot === 'handL' ? 'L' : 'R';
  root.userData.offhand = items.find((i) => isHandSlot(i.slot) && isShield(i.item))?.item ?? 'none';
  for (const item of items) {
    const socket = sockets.get(SLOT_SOCKET[item.slot]);
    const model = socket ? createEquipmentModel(item) : null;
    if (!socket || !model) continue;
    const pivot = part(item === main ? 'weapon' : isHandSlot(item.slot) ? 'offhand' : `gear.${item.slot}`, [0, 0, 0]);
    pivot.add(model);
    socket.add(pivot);
  }
}
