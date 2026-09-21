// Instanced unit rendering: one InstancedMesh per (unit type, part). Alive units are
// posed procedurally with spring "wobble"; dead units hand over to Rapier ragdolls and
// finally freeze into corpses.
import * as THREE from 'three';
import type { AssetDef, ConfigBundle, Settings, WeaponDef } from '@/shared/schema';
import { SKINNED_GLB_KINDS } from '@/shared/schema';
import { createAssetModel, getUnitTemplate } from '../models';
import { cloneSkinned, releaseSkinned, setSkinState, stepSkin, type SkinnedInstance, type SkinState, type SkinTint } from '../models/glbSkinned';
import type { ModelTemplate } from '../models/bake';
import type { Side } from '../sim/terrain';
import { SIM_DT, type BattleSim, type SimEvent, type SimUnit } from '../sim/world';
import { attackStyleFor, Poser, type AttackStyle } from './animate';
import { commitInstances } from './instancing';
import type { Ragdoll, RagdollWorld } from './ragdoll';

const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
const smoothMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
const STRIKE_TIME = 0.45;
/** Where a rider's hips should land on a skinned mount's back, in the mount's normalised (NORMALIZED_HEIGHT=2) local space; follows the mount's root only (no per-bone gallop bounce). */
const MOUNT_SEAT = new THREE.Vector3(0, 1.15, -0.05);

/**
 * Bends a static rider's legs into a riding stance (thighs splayed out, knees bent) so it
 * straddles a skinned mount instead of standing on its back in the idle rest pose (matches
 * the seg.mounted leg pose the procedural Poser uses for baked mounts; see animate.ts), and
 * drops the rider so its hips — not its feet — land on `MOUNT_SEAT`.
 */
function seatRider(rider: THREE.Object3D): void {
  const parts = new Map<string, THREE.Object3D>();
  rider.traverse((o) => {
    if (o.userData.part) parts.set(o.userData.part as string, o);
  });
  parts.get('thighL')?.rotation.set(-1.35, 0, 0.45);
  parts.get('thighR')?.rotation.set(-1.35, 0, -0.45);
  parts.get('shinL')?.rotation.set(1.25, 0, 0);
  parts.get('shinR')?.rotation.set(1.25, 0, 0);
  const hipY = parts.get('hips')?.position.y ?? 0;
  rider.position.copy(MOUNT_SEAT);
  rider.position.y -= hipY * rider.scale.y;
}
const EMIT_SOCKETS = ['mouth', 'muzzle', 'staff.tip', 'hand.R', 'rider.muzzle', 'rider.staff.tip', 'rider.hand.R'];
const RAGDOLL_SECONDS = 6;
/** Camera distances (m) past which a unit re-poses its limbs only every 2nd / 3rd frame (its body still moves every frame). */
const LOD_NEAR = 45;
const LOD_FAR = 90;
/** Horizontal shadow length per metre of height (sun direction in engine.ts): off-screen units whose shadow can reach the view still draw. */
const SHADOW_REACH = 0.7;

interface TypeVis {
  template: ModelTemplate;
  poser: Poser;
  style: AttackStyle;
  /** Motion per ability id (basic attack and skills). */
  styles: Map<string, AttackStyle>;
  meshes: (THREE.InstancedMesh | null)[];
  capacity: number;
  used: number;
  refSpeed: number;
  stride: number;
}

interface UnitVis {
  type: TypeVis;
  seed: number;
  phase: number;
  speed: number;
  svx: number;
  svz: number;
  leanX: number;
  leanZ: number;
  vLeanX: number;
  vLeanZ: number;
  yaw: number;
  tumble: number;
  world: THREE.Matrix4[];
  ragdoll: Ragdoll | null;
  corpse: boolean;
  sink: number;
  gone: boolean;
  /** Turret yaw relative to the body (towers). */
  aim: number;
  /** Seconds since a building started collapsing (-1 = standing). */
  collapse: number;
  /** Pose when the collapse started. */
  rest: THREE.Matrix4[] | null;
  /** Skeletal GLB unit (SKINNED_GLB_KINDS): rendered as a live clone, not instanced parts. */
  usesSkin: boolean;
  skin: SkinnedInstance | null;
  skinUrl: string | null;
  skinScale: number;
  skinTint: SkinTint;
  skinHide: string[];
  /** Fallen distance of a dead flyer gliding to the ground (corpses must not hover). */
  fall: number;
  /** Seconds the attack clip keeps showing after a swing starts (covers the strike). */
  atkT: number;
  radius: number;
  height: number;
  /** Root transform `world` was last posed with (a LOD frame moves the posed limbs by the root's change). */
  root: THREE.Matrix4;
  /** Time since the limbs were last posed (LOD frames skip posing). */
  lodDt: number;
  /** Off-screen since its last pose: `world` is out of date until re-posed. */
  stale: boolean;
}

const COLLAPSE_TIME = 2.4;

type HitEvent = Extract<SimEvent, { type: 'hit' }>;
type DeathEvent = Extract<SimEvent, { type: 'death' }>;

export class UnitRenderer {
  readonly group = new THREE.Group();
  vis: UnitVis[] = [];
  private types = new Map<string, TypeVis>();
  private pose: THREE.Matrix4[] = [];
  private corpses: UnitVis[] = [];
  /** One rider model per asset, cloned for each skinned mount (clones share its geometry instead of building new GPU buffers per unit). */
  private readonly riders = new Map<string, THREE.Group>();
  private ragdolls: RagdollWorld | null = null;
  private readonly assets: Map<string, AssetDef>;
  private readonly weapons: Map<string, WeaponDef>;
  private readonly rootM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly tmpP = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly frustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private readonly delta = new THREE.Matrix4();
  private frame = 0;
  /** Last updated sim and interpolation, for posing a culled unit on demand (sockets, deaths). */
  private sim: BattleSim | null = null;
  private alpha = 1;
  time = 0;

  constructor(bundle: ConfigBundle) {
    this.group.name = 'units';
    this.assets = new Map(bundle.assets.map((a) => [a.id, a]));
    this.weapons = new Map(bundle.weapons.map((w) => [w.id, w]));
  }

  setRagdolls(world: RagdollWorld | null): void {
    this.ragdolls = world;
  }

  /** Fresh visuals for a new sim. Instanced meshes are kept and reused (deployment rebuilds on every placement). */
  build(sim: BattleSim): void {
    this.detachSkins();
    this.vis = [];
    this.corpses = [];
    this.ensure(sim);
  }

  /** Public URL of the skeletal override when `modelId` is a skinned kind with an upload, else null. */
  private skinUrlFor(modelId: string): { url: string; scale: number; tint: SkinTint; hide: string[] } | null {
    const a = this.assets.get(modelId);
    if (!a?.glb || !(SKINNED_GLB_KINDS as readonly string[]).includes(a.kind)) return null;
    return { url: a.glb.url, scale: a.scale, tint: a.glb.tint ?? {}, hide: a.glb.hide ?? [] };
  }

  /** Visuals for units added since the last call (all of them after build, barracks spawns later). */
  ensure(sim: BattleSim): void {
    const start = this.vis.length;
    if (sim.units.length === start) return;
    const need = new Map<string, number>();
    for (let i = start; i < sim.units.length; i++) {
      const u = sim.units[i];
      if (u.wall?.kind === 'wall') continue;
      need.set(u.def.id, (need.get(u.def.id) ?? 0) + 1);
    }
    for (const [id, n] of need) {
      const type = this.types.get(id);
      const existing = type ? this.vis.filter((v) => v.type === type).length : 0;
      if (type && existing + n <= type.capacity) continue;
      const def = sim.units.find((u) => u.def.id === id)!.def;
      // Types that can still grow (barracks spawns) get headroom.
      this.makeType(id, def, type ? (existing + n) * 2 : n, type);
    }
    for (let i = start; i < sim.units.length; i++) {
      const u = sim.units[i];
      const wall = u.wall?.kind === 'wall';
      const type = this.types.get(u.def.id);
      const skin = this.skinUrlFor(u.def.modelId);
      const usesSkin = !!skin && !wall;
      const v: UnitVis = {
        type: type!,
        seed: ((u.id * 2654435761) >>> 0) / 4294967296,
        phase: Math.random() * Math.PI * 2,
        speed: 0,
        svx: 0,
        svz: 0,
        leanX: 0,
        leanZ: 0,
        vLeanX: 0,
        vLeanZ: 0,
        yaw: Math.atan2(u.fx, u.fz),
        tumble: 0,
        world: usesSkin || !type ? [] : type.template.parts.map(() => new THREE.Matrix4()),
        ragdoll: null,
        corpse: false,
        sink: 0,
        // Wall stacks are drawn by WallRenderer.
        gone: wall,
        aim: 0,
        collapse: -1,
        rest: null,
        usesSkin,
        skin: null,
        skinUrl: skin?.url ?? null,
        skinScale: skin?.scale ?? 1,
        skinTint: skin?.tint ?? {},
        skinHide: skin?.hide ?? [],
        fall: 0,
        atkT: 0,
        radius: u.def.radius,
        height: u.def.height,
        root: new THREE.Matrix4(),
        lodDt: 0,
        stale: false,
      };
      this.vis.push(v);
      if (!wall && !usesSkin) this.poseAlive(u, v, sim, 1, 0);
    }
  }

  private makeType(id: string, def: SimUnit['def'], capacity: number, old: TypeVis | undefined): void {
    const template = old?.template ?? getUnitTemplate(def, this.assets);
    const style = old?.style ?? attackStyleFor(template, this.weapons.get(def.weaponId));
    if (old) for (const m of old.meshes) if (m) this.group.remove(m);
    // Skinned units never touch the instanced path: keep null slots so update() writes nothing.
    const skinned = !!this.skinUrlFor(def.modelId);
    const meshes = template.parts.map((p, k) => {
      if (!p.geometry || skinned) return null;
      const m = new THREE.InstancedMesh(p.geometry, template.smooth ? smoothMaterial : material, capacity);
      const prev = old?.meshes[k];
      if (prev) {
        (m.instanceMatrix.array as Float32Array).set(prev.instanceMatrix.array as Float32Array);
        prev.dispose();
      }
      m.count = 0;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    });
    if (template.parts.length > this.pose.length) this.pose = Array.from({ length: template.parts.length }, () => new THREE.Matrix4());
    if (old) {
      old.meshes = meshes;
      old.capacity = capacity;
      return;
    }
    this.types.set(id, { template, poser: new Poser(template, style), style, styles: new Map(), meshes, capacity, used: 0, refSpeed: Math.max(1, def.speed), stride: Math.max(0.5, template.bounds.max.y * 0.32) });
  }

  /** `camera`: skips units outside its view (and their shadow's reach) and re-poses far ones less often; omitted = pose and draw everything. */
  update(sim: BattleSim, alpha: number, dt: number, hidden: Side | null, camera?: THREE.Camera): void {
    this.time += dt;
    this.sim = sim;
    this.alpha = alpha;
    this.frame++;
    this.ensure(sim);
    const view = camera ? this.frustum.setFromProjectionMatrix(this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)) : null;
    const eye = camera?.position;
    for (const t of this.types.values()) t.used = 0;
    for (let i = 0; i < sim.units.length; i++) {
      const u = sim.units[i];
      const v = this.vis[i];
      if (!v) continue;
      if (v.gone) {
        // Sunk corpses leave the instanced draw (count excludes them); skinned clones must detach.
        if (v.skin) {
          this.group.remove(v.skin.group);
          releaseSkinned(v.skin);
          v.skin = null;
        }
        continue;
      }
      if (hidden && u.side === hidden) {
        if (v.skin) v.skin.group.visible = false;
        continue;
      }
      if (v.usesSkin) {
        this.updateSkinned(u, v, alpha, dt, view);
        continue;
      }
      if (u.alive) {
        const x = u.px + (u.x - u.px) * alpha;
        const y = u.py + (u.y - u.py) * alpha;
        const z = u.pz + (u.z - u.pz) * alpha;
        if (view && !this.standingInView(view, u, x, y, z)) {
          v.stale = true;
          v.lodDt = 0;
          continue;
        }
        const every = eye ? lodEvery(eye.distanceToSquared(this.tmpP.set(x, y, z))) : 1;
        v.lodDt += dt;
        if (v.stale || every === 1 || (this.frame + i) % every === 0) {
          this.poseAlive(u, v, sim, alpha, v.lodDt);
          v.lodDt = 0;
        } else this.moveRoot(v, x, y, z);
      } else if (v.collapse >= 0) {
        if (view && !this.standingInView(view, u, u.x, u.y, u.z)) continue;
        this.collapseStep(u, v, dt);
      } else if (v.ragdoll && this.ragdolls) this.ragdolls.read(v.ragdoll, v.world);
      else if (view && v.world.length > 0) {
        // Frozen corpse: its root part says where it lies.
        const e = v.world[0].elements;
        if (!view.intersectsSphere(this.sphere.set(this.tmpP.set(e[12], e[13] - v.sink, e[14]), Math.max(v.height, v.radius) + 1))) continue;
      }
      const t = v.type;
      const slot = t.used++;
      for (let k = 0; k < t.meshes.length; k++) {
        const mesh = t.meshes[k];
        if (!mesh) continue;
        if (v.sink > 0) {
          this.rootM.makeTranslation(0, -v.sink, 0).multiply(v.world[k]);
          mesh.setMatrixAt(slot, this.rootM);
        } else mesh.setMatrixAt(slot, v.world[k]);
      }
    }
    for (const t of this.types.values()) {
      for (const m of t.meshes) if (m) commitInstances(m, t.used);
    }
  }

  /** A standing unit (or building) at (x, y, z) is on screen, or its shadow can reach the screen. */
  private standingInView(view: THREE.Frustum, u: SimUnit, x: number, y: number, z: number): boolean {
    const h = u.def.height;
    const lift = u.flying ? u.flyHeight : 0;
    return view.intersectsSphere(this.sphere.set(this.tmpP.set(x, y + h * 0.5, z), h * 0.5 + u.def.radius + (h + lift) * SHADOW_REACH + 0.5));
  }

  /** LOD frame: carry the last posed limbs along with the body's new position. */
  private moveRoot(v: UnitVis, x: number, y: number, z: number): void {
    this.composeRoot(v, x, y, z);
    this.delta.copy(v.root).invert().premultiply(this.rootM);
    for (const w of v.world) w.premultiply(this.delta);
    v.root.copy(this.rootM);
  }

  private composeRoot(v: UnitVis, x: number, y: number, z: number): void {
    this.tmpE.set(-v.tumble, v.yaw, 0, 'YXZ');
    this.tmpQ.setFromEuler(this.tmpE);
    this.rootM.compose(this.tmpP.set(x, y, z), this.tmpQ, this.one);
  }

  /** A culled unit's `world` is stale: pose it now at the last interpolation (no state advance). */
  private refresh(unitId: number, v: UnitVis): void {
    const sim = this.sim;
    const u = sim?.units[unitId];
    if (sim && u) this.poseAlive(u, v, sim, this.alpha, 0);
  }

  private poseAlive(u: SimUnit, v: UnitVis, sim: BattleSim, alpha: number, dt: number): void {
    const x = u.px + (u.x - u.px) * alpha;
    const y = u.py + (u.y - u.py) * alpha;
    const z = u.pz + (u.z - u.pz) * alpha;
    const vx = (u.x - u.px) / SIM_DT;
    const vz = (u.z - u.pz) / SIM_DT;
    if (u.structure) {
      // Buildings stand still; a tower turns its turret toward the target.
      const t = sim.units[u.targetId];
      if (t && t.alive && dt > 0) {
        let d = Math.atan2(t.x - u.x, t.z - u.z) - v.yaw - v.aim;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        v.aim += d * (1 - Math.exp(-dt * 5));
      }
    } else if (dt > 0) {
      const k = Math.min(1, dt * 10);
      const nvx = v.svx + (vx - v.svx) * k;
      const nvz = v.svz + (vz - v.svz) * k;
      const ax = (nvx - v.svx) / dt;
      const az = (nvz - v.svz) / dt;
      v.svx = nvx;
      v.svz = nvz;
      v.speed = Math.hypot(nvx, nvz);
      v.phase += v.speed * dt * (Math.PI / v.type.stride);
      const want = Math.atan2(u.fx, u.fz);
      let d = want - v.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      v.yaw += d * (1 - Math.exp(-dt * 10));
      const fX = Math.sin(v.yaw);
      const fZ = Math.cos(v.yaw);
      const aF = ax * fX + az * fZ;
      const aL = ax * fZ - az * fX;
      const tX = THREE.MathUtils.clamp(-aF * 0.035, -0.45, 0.45);
      // Rz(+) tips the torso toward -X (model right): inertia lags opposite the acceleration.
      const tZ = THREE.MathUtils.clamp(aL * 0.035, -0.45, 0.45);
      v.vLeanX += ((tX - v.leanX) * 70 - v.vLeanX * 7) * dt;
      v.vLeanZ += ((tZ - v.leanZ) * 70 - v.vLeanZ * 7) * dt;
      v.leanX = THREE.MathUtils.clamp(v.leanX + v.vLeanX * dt, -0.9, 0.9);
      v.leanZ = THREE.MathUtils.clamp(v.leanZ + v.vLeanZ * dt, -0.9, 0.9);
      v.tumble = u.airborne ? Math.min(1.3, v.tumble + dt * 3) : v.tumble * Math.exp(-dt * 6);
    }

    let attack = -1;
    const act = u.action ?? u.lastAction;
    const since = (sim.tick - u.lastAttackTick) * SIM_DT;
    // Fast attackers get a shorter follow-through so the next swing is not cut off.
    const strikeTime = Math.min(STRIKE_TIME, (act.def.cooldown / act.rate) * 0.8);
    if (u.action && u.windupLeft >= 0 && u.windupTotal > 0) attack = THREE.MathUtils.clamp(1 - u.windupLeft / u.windupTotal, 0, 1);
    else if (u.channelLeft > 0) attack = 1.25;
    else if (since >= 0 && since < strikeTime) attack = 1 + since / strikeTime;
    if (v.type.style === 'breath' && since < 0.45) attack = 1.5;

    const t = v.type;
    t.poser.compute(
      { time: this.time, speed: v.speed, phase: v.phase, attack, style: this.styleOf(t, act.def), airborne: u.airborne && !u.dashWeapon, stunned: u.stun > 0, leanX: v.leanX, leanZ: v.leanZ, seed: v.seed, refSpeed: t.refSpeed, aim: v.aim, climbing: u.climb !== null },
      this.pose,
    );
    this.composeRoot(v, x, y, z);
    for (let k = 0; k < t.template.parts.length; k++) v.world[k].multiplyMatrices(this.rootM, this.pose[k]);
    v.root.copy(this.rootM);
    v.stale = false;
  }

  private styleOf(type: TypeVis, weapon: WeaponDef): AttackStyle {
    let style = type.styles.get(weapon.id);
    if (!style) type.styles.set(weapon.id, (style = attackStyleFor(type.template, weapon)));
    return style;
  }

  /** Skeletal GLB units: drive the file's clips (idle/walk/run/attack/death) instead of the procedural poser. */
  private updateSkinned(u: SimUnit, v: UnitVis, alpha: number, dt: number, view: THREE.Frustum | null): void {
    if (!v.skin) {
      if (!v.skinUrl) return;
      const inst = cloneSkinned(v.skinUrl, v.skinTint, v.skinHide);
      if (!inst) return; // still loading; the unit pops in once the file arrives
      inst.group.scale.setScalar(v.skinScale);
      this.group.add(inst.group);
      v.skin = inst;
      const riderAsset = u.def.riderModelId ? this.assets.get(u.def.riderModelId) : undefined;
      if (riderAsset) {
        let template = this.riders.get(riderAsset.id);
        if (!template) this.riders.set(riderAsset.id, (template = createAssetModel(riderAsset)));
        const rider = template.clone();
        // Counter the mount's own scale so the rider keeps its own asset scale.
        rider.scale.multiplyScalar(1 / Math.max(0.0001, v.skinScale));
        seatRider(rider);
        inst.group.add(rider);
      }
    }
    const skin = v.skin;
    const x = u.px + (u.x - u.px) * alpha;
    const y = u.py + (u.y - u.py) * alpha;
    const z = u.pz + (u.z - u.pz) * alpha;
    if (dt > 0) {
      const k = Math.min(1, dt * 10);
      v.svx += ((u.x - u.px) / SIM_DT - v.svx) * k;
      v.svz += ((u.z - u.pz) / SIM_DT - v.svz) * k;
      v.speed = Math.hypot(v.svx, v.svz);
      v.phase += v.speed * dt * (Math.PI / v.type.stride);
      const want = Math.atan2(u.fx, u.fz);
      const d = Math.atan2(Math.sin(want - v.yaw), Math.cos(want - v.yaw));
      v.yaw += d * (1 - Math.exp(-dt * 10));
      v.atkT = Math.max(0, v.atkT - dt);
    }
    const attacking = (u.action && u.windupLeft >= 0 && u.windupTotal > 0) || u.channelLeft > 0;
    if (attacking) v.atkT = 0.8;
    let state: SkinState;
    if (!u.alive) state = 'death';
    else if (attacking || v.atkT > 0) state = 'attack';
    else if ((u.airborne && !u.dashWeapon) || u.climb !== null) state = 'jump';
    else if (v.speed > Math.max(1.5, v.type.refSpeed * 0.75)) state = 'run';
    else if (v.speed > 0.4) state = 'walk';
    else state = 'idle';
    setSkinState(skin, state);
    // Off screen: keep its place (emit points follow it) but skip the skeletal animation.
    skin.group.visible = !view || (u.alive ? this.standingInView(view, u, x, y, z) : view.intersectsSphere(this.sphere.set(this.tmpP.set(x, y, z), Math.max(v.height, v.radius) + 1)));
    if (skin.group.visible) stepSkin(skin, dt);
    // Dead flyers glide down instead of hovering: settle on the ground, then corpses sink as usual.
    if (!u.alive && skin.settled && dt > 0) {
      const restY = y - v.sink - v.fall;
      if (restY > 0.35) v.fall = Math.min(v.fall + dt * 2.2, y - v.sink - 0.35);
    }
    skin.group.position.set(x, y - v.sink - v.fall, z);
    skin.group.rotation.y = v.yaw;
  }

  onHit(e: HitEvent): void {
    const v = this.vis[e.targetId];
    if (!v || v.usesSkin) return;
    const fX = Math.sin(v.yaw);
    const fZ = Math.cos(v.yaw);
    const fwd = e.dx * fX + e.dz * fZ;
    const left = e.dx * fZ - e.dz * fX;
    const k = Math.min(9, 2.5 + e.damage * 0.06) * (e.blocked ? 0.5 : 1);
    v.vLeanX += fwd * k;
    v.vLeanZ -= left * k;
  }

  /** Building sinks, tilts and shudders into a ruin (debris and dust come from the engine). */
  private collapseStep(u: SimUnit, v: UnitVis, dt: number): void {
    if (!v.rest || v.collapse > COLLAPSE_TIME) return;
    v.collapse += dt;
    const k = Math.min(1, v.collapse / COLLAPSE_TIME);
    const fall = k * k;
    const h = u.def.height;
    const shake = (1 - k) * 0.12;
    const tilt = fall * 0.14 * (v.seed > 0.5 ? 1 : -1);
    const m = this.rootM
      .makeTranslation(u.x + (Math.random() * 2 - 1) * shake, u.y - fall * h * 0.72, u.z + (Math.random() * 2 - 1) * shake)
      .multiply(this.delta.makeRotationZ(tilt))
      .multiply(this.delta.makeRotationX(tilt * 0.6))
      .multiply(this.delta.makeTranslation(-u.x, -u.y, -u.z));
    for (let i = 0; i < v.world.length; i++) v.world[i].multiplyMatrices(m, v.rest[i]);
  }

  onDeath(e: DeathEvent, sim: BattleSim, settings: Settings): void {
    const v = this.vis[e.unitId];
    const u = sim.units[e.unitId];
    if (!v || !u || v.gone) return;
    // Died off screen: ragdoll, topple and collapse start from its real pose, not the last one drawn.
    if (v.stale) this.poseAlive(u, v, sim, 1, 0);
    if (u.structure) {
      v.collapse = 0;
      v.rest = v.world.map((w) => w.clone());
      return;
    }
    if (v.usesSkin) {
      // No rigid parts to ragdoll: the death clip plays, then the corpse freezes and sinks.
      v.corpse = true;
      this.corpses.push(v);
      return;
    }
    const vel = new THREE.Vector3((u.x - u.px) / SIM_DT, u.airborne ? u.vy : 0, (u.z - u.pz) / SIM_DT);
    const impulse = new THREE.Vector3(e.dx * e.force, e.dy * e.force + 1.5, e.dz * e.force);
    if (this.ragdolls && this.ragdolls.active.size < settings.ragdollLimit) {
      v.ragdoll = this.ragdolls.spawn(v.type.template, v.world, vel, impulse);
    } else {
      this.topple(v, u, e);
      v.corpse = true;
    }
    this.corpses.push(v);
  }

  /** Cheap fallback when the ragdoll budget is spent: tip the pose over. */
  private topple(v: UnitVis, u: SimUnit, e: DeathEvent): void {
    const axis = new THREE.Vector3(e.dz, 0, -e.dx);
    if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
    axis.normalize();
    const pivot = new THREE.Vector3(u.x, u.y, u.z);
    const m = new THREE.Matrix4()
      .makeTranslation(pivot.x, pivot.y + 0.25, pivot.z)
      .multiply(new THREE.Matrix4().makeRotationAxis(axis, -1.45))
      .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
    for (const w of v.world) w.premultiply(m);
  }

  /** Ragdoll lifetimes, ragdoll budget and corpse budget. */
  manage(dt: number, settings: Settings): void {
    const rd = this.ragdolls;
    if (rd) {
      let over = rd.active.size - settings.ragdollLimit;
      for (const v of this.corpses) {
        if (!v.ragdoll) continue;
        if (v.ragdoll.age > RAGDOLL_SECONDS || over > 0) {
          rd.freeze(v.ragdoll, v.world);
          v.ragdoll = null;
          v.corpse = true;
          over--;
        }
      }
    }
    let excess = -settings.corpseLimit;
    for (const c of this.corpses) if (!c.gone) excess++;
    for (const v of this.corpses) {
      if (excess <= 0) break;
      if (v.gone || v.ragdoll) continue;
      v.sink += dt * 0.6;
      if (v.sink > 2.5) v.gone = true;
      excess--;
    }
  }

  /** Where a unit's attacks and spells leave from: mouth, muzzle, staff orb or weapon hand (a mount's rider when the mount has none). */
  emitPoint(unitId: number, out: THREE.Vector3): boolean {
    for (const name of EMIT_SOCKETS) if (this.socketPosition(unitId, name, out)) return true;
    // Skinned units carry no named sockets: breathe/bite from in front of the snout.
    const v = this.vis[unitId];
    if (v?.usesSkin && v.skin) {
      out.copy(v.skin.group.position);
      out.x += Math.sin(v.yaw) * (v.radius + 0.5);
      out.z += Math.cos(v.yaw) * (v.radius + 0.5);
      out.y += v.height * 0.6;
      return true;
    }
    return false;
  }

  /** World position of a named socket on a unit (e.g. dragon "mouth"). */
  socketPosition(unitId: number, name: string, out: THREE.Vector3): boolean {
    const v = this.vis[unitId];
    if (!v || v.usesSkin) return false;
    const s = v.type.template.sockets[name];
    if (!s) return false;
    if (v.stale) this.refresh(unitId, v);
    out.setFromMatrixPosition(this.rootM.multiplyMatrices(v.world[s.part], s.matrix));
    return true;
  }

  private detachSkins(): void {
    for (const v of this.vis) {
      if (v.skin) {
        this.group.remove(v.skin.group);
        releaseSkinned(v.skin);
        v.skin = null;
      }
    }
  }

  clear(): void {
    for (const t of this.types.values()) {
      for (const m of t.meshes) {
        if (!m) continue;
        this.group.remove(m);
        m.dispose();
      }
    }
    this.detachSkins();
    this.types.clear();
    this.vis = [];
    this.corpses = [];
  }
}

/** Pose every n-th frame by camera distance². */
function lodEvery(d2: number): number {
  return d2 > LOD_FAR * LOD_FAR ? 3 : d2 > LOD_NEAR * LOD_NEAR ? 2 : 1;
}
