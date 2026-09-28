// Equipment on skeletal (.glb) characters. A skinned file ships one fixed mesh, so items
// (models/equipment.ts) are mounted on grips parented to the file's bones and follow its clips.
//
// Grips are solved once per file from its rest pose (T-pose: arms along ±X, palms down, facing
// +Z) and stored bone-local, so they hold for any bone naming or roll and items can be swapped
// on a live, animating clone. Hand grip = the procedural humanoid's hand socket (HAND_ROT in
// humanoid.ts): item +Y through the fist (thumb side, forward at rest), +Z down the arm. Shields
// face out of the back of the hand, top toward the elbow. Back and hips use slotBasis().
import * as THREE from 'three';
import { createEquipmentModel, equipmentKey, equipmentReady, isHandSlot, isShield, SLOT_SOCKET, slotQuaternion, type EquipItem } from './equipment';
import { HUMANOID_HEIGHT } from './humanoid';

/** A grip in its bone's local space. */
export interface Grip {
  bone: string;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: number;
}

/** Grips of one file by slot; hands also carry a `<slot>:shield` variant. */
export type GripSet = Map<string, Grip>;

const sided = (n: string, side: 'L' | 'R') => n.includes(side === 'R' ? 'right' : 'left') || new RegExp(`(^|[._\\s-])${side.toLowerCase()}($|[._\\s-]|\\d)`).test(n);
const lower = (names: readonly string[]) => names.map((n) => n.toLowerCase().replace(/^mixamorig\d*:?/, ''));
const NOT_GRIP = /wing|thumb|index|middle|ring|pinky|finger|end$/;

/**
 * Best hand bone for `side` among `names`, or null. A dedicated weapon bone (Quaternius
 * "Weapon.R") wins over the hand, the hand over the forearm (rigs without hand bones); wing,
 * finger and thumb bones never match. Pure — unit-tested.
 */
export function pickHandBone(names: readonly string[], side: 'L' | 'R'): string | null {
  const low = lower(names);
  for (const re of [/weapon/, /hand|fist|wrist/, /lowerarm|forearm/]) {
    const i = low.findIndex((n) => re.test(n) && sided(n, side) && !NOT_GRIP.test(n));
    if (i >= 0) return names[i];
  }
  return null;
}

/** Bone a body slot hangs from: the upper torso for the back, the pelvis for the hips. Pure — unit-tested. */
export function pickBodyBone(names: readonly string[], slot: 'back' | 'hip'): string | null {
  const low = lower(names);
  const order = slot === 'back' ? [/upper_?chest/, /chest/, /torso/, /spine\.?0*[23]/, /spine/, /abdomen/] : [/hips|pelvis/];
  for (const re of order) {
    const i = low.findIndex((n) => re.test(n) && !sided(n, 'L') && !sided(n, 'R') && !/wing|tail|end$/.test(n));
    if (i >= 0) return names[i];
  }
  return null;
}

const m4 = new THREE.Matrix4();
const qBone = new THREE.Quaternion();
const qInv = new THREE.Quaternion();
const qWant = new THREE.Quaternion();
const pBone = new THREE.Vector3();
const pUp = new THREE.Vector3();
const sBone = new THREE.Vector3();
const ax = new THREE.Vector3();
const ay = new THREE.Vector3();
const az = new THREE.Vector3();
const basis = new THREE.Matrix4();

/** Body slot offsets from their bone at rest, in root space of a NORMALIZED_HEIGHT (2 m) clone. */
const BODY_OFFSET: Record<'back' | 'hipL' | 'hipR', THREE.Vector3> = {
  back: new THREE.Vector3(0, 0, -0.14),
  hipL: new THREE.Vector3(0.17, -0.02, 0.03),
  hipR: new THREE.Vector3(-0.17, -0.02, 0.03),
};

/** Solves every slot's grip on a fresh clone (`root` still in the file's rest pose, unscaled). */
export function solveGrips(root: THREE.Object3D): GripSet {
  const grips: GripSet = new Map();
  const bones: THREE.Bone[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
  });
  const names = bones.map((b) => b.name);
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  // Items are sized for a HUMANOID_HEIGHT figure; the clone's rest height is 2 m in root space.
  const k = 2 / HUMANOID_HEIGHT;
  const add = (key: string, bone: THREE.Bone, offset: THREE.Vector3) => {
    const scale = sBone.x || 1;
    qInv.copy(qBone).invert();
    grips.set(key, {
      bone: bone.name,
      position: offset.clone().applyQuaternion(qInv).divideScalar(scale),
      quaternion: qInv.clone().multiply(qWant),
      scale: k / scale,
    });
  };
  const restOf = (bone: THREE.Object3D) => m4.multiplyMatrices(toRoot, bone.matrixWorld).decompose(pBone, qBone, sBone);

  for (const side of ['R', 'L'] as const) {
    const name = pickHandBone(names, side);
    const bone = name ? bones.find((b) => b.name === name)! : undefined;
    if (!bone) continue;
    restOf(bone);
    // Arm direction (elbow → wrist) in root space; a weapon bone sits on the hand, so walk up to
    // a parent that is not at the same spot.
    let up: THREE.Object3D | null = bone.parent;
    pUp.copy(pBone);
    while (up && up !== root && pUp.distanceToSquared(pBone) < 1e-6) {
      pUp.setFromMatrixPosition(m4.multiplyMatrices(toRoot, up.matrixWorld));
      up = up.parent;
    }
    const arm = pBone.clone().sub(pUp);
    const len = arm.length();
    if (len < 1e-4) arm.set(side === 'R' ? -1 : 1, 0, 0);
    arm.normalize();
    // Hand bones pivot at the wrist: move into the fist. Weapon bones already sit in the grip; a
    // forearm bone pivots at the elbow, one forearm (≈ its upper arm) short of the wrist.
    const low = bone.name.toLowerCase();
    const reach = /weapon/.test(low) ? 0 : (/lowerarm|forearm/.test(low) ? len : 0) + 0.06 * k;
    const offset = arm.clone().multiplyScalar(reach);
    // Weapon: +Y through the fist (forward at rest), +Z down the arm.
    ay.set(0, 0, 1);
    az.copy(arm).addScaledVector(ay, -arm.dot(ay)).normalize();
    qWant.setFromRotationMatrix(basis.makeBasis(ax.crossVectors(ay, az).normalize(), ay, az));
    add(`hand${side}`, bone, offset);
    // Shield: face (+Z) out of the back of the hand, top (+Y) toward the elbow.
    az.set(0, 1, 0);
    ay.copy(arm).negate().addScaledVector(az, arm.dot(az)).normalize();
    qWant.setFromRotationMatrix(basis.makeBasis(ax.crossVectors(ay, az).normalize(), ay, az));
    add(`hand${side}:shield`, bone, offset);
  }

  for (const slot of ['back', 'hipL', 'hipR'] as const) {
    const name = pickBodyBone(names, slot === 'back' ? 'back' : 'hip');
    const bone = name ? bones.find((b) => b.name === name)! : undefined;
    if (!bone) continue;
    restOf(bone);
    slotQuaternion(slot, qWant);
    add(slot, bone, BODY_OFFSET[slot]);
  }
  return grips;
}

function gripKey(item: EquipItem): string {
  return isHandSlot(item.slot) && isShield(item.item) ? `${item.slot}:shield` : item.slot;
}

const templates = new Map<string, THREE.Group>();

/** One built model per item look; clones share its geometry and materials. */
function itemModel(item: EquipItem): THREE.Group | null {
  const key = equipmentKey([{ ...item, slot: 'handR' }]);
  let t = templates.get(key);
  if (t === undefined) {
    const built = createEquipmentModel(item);
    if (!built) return null;
    built.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
      }
    });
    // An uploaded item still loading stands in with its procedural look; build it again later.
    if (!equipmentReady(item)) return built;
    templates.set(key, (t = built));
  }
  return t.clone();
}

/**
 * Mounts `items` on the bones of a clone (any pose) using its file's `grips`. Returns the grips
 * it added (remove them to unequip) and the sockets they expose by name: `hand.R`, `hand.L`,
 * `back`, `hip.L`, `hip.R` plus the items' own (`staff.tip`, `muzzle`).
 */
export function mountOnBones(root: THREE.Object3D, grips: GripSet, items: readonly EquipItem[]): { mounts: THREE.Object3D[]; sockets: Map<string, THREE.Object3D> } {
  const mounts: THREE.Object3D[] = [];
  const sockets = new Map<string, THREE.Object3D>();
  const bones = new Map<string, THREE.Object3D>();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone && !bones.has(o.name)) bones.set(o.name, o);
  });
  for (const item of items) {
    const g = grips.get(gripKey(item));
    const bone = g ? bones.get(g.bone) : undefined;
    if (!g || !bone) continue;
    const grip = new THREE.Object3D();
    const socket = SLOT_SOCKET[item.slot];
    grip.name = `socket:${socket}`;
    grip.userData.socket = socket;
    grip.position.copy(g.position);
    grip.quaternion.copy(g.quaternion);
    grip.scale.setScalar(g.scale);
    bone.add(grip);
    mounts.push(grip);
    sockets.set(socket, grip);
    const model = itemModel(item);
    if (!model) continue;
    grip.add(model);
    model.traverse((o) => {
      if (o.userData.socket) sockets.set(o.userData.socket as string, o);
    });
  }
  return { mounts, sockets };
}
