// Battle engine: owns the Three.js scene, steps the deterministic sim at a fixed rate,
// interpolates visuals, and turns sim events into particles, ragdolls and stuck arrows.
import * as THREE from 'three';
import type { ArmyStars } from '@/shared/net';
import type { ConfigBundle, MapDef, ParticleDef, ProjectileDef, WeaponDef } from '@/shared/schema';
import { getUnitTemplate } from '../models';
import type { Armies } from '../sim/army';
import { Terrain, type Side } from '../sim/terrain';
import { BattleSim, SIM_DT, type BattleResult, type SimEvent } from '../sim/world';
import { attackStyleFor, Poser } from './animate';
import { basePitch, RtsCamera, type CameraView } from './camera';
import { Cinematic, type Shot } from './cinematic';
import { EffectRenderer, type EffectHost } from './effects';
import { Fireworks } from './fireworks';
import { ParticleSystem } from './particles';
import { ProjectileRenderer } from './projectiles';
import { RagdollWorld } from './ragdoll';
import { createScenery } from './scenery';
import { createSkirt, createTerrainMesh, createWater, createZoneOverlay, type Water } from './terrainMesh';
import { UnitRenderer } from './units';

export interface PointerInfo {
  type: 'down' | 'move' | 'up';
  x: number;
  z: number;
  hit: boolean;
  button: number;
  shift: boolean;
  ctrl: boolean;
}

export interface BattleStats {
  blue: number;
  red: number;
  time: number;
}

export interface EngineEvents {
  onPointer?(p: PointerInfo): void;
  onResult?(r: BattleResult): void;
  onChecksum?(tick: number, hash: number): void;
  onStats?(s: BattleStats): void;
  /** Which cinematic owns the camera (null = player control). */
  onCinematic?(kind: CinematicKind | null): void;
}

export type CinematicKind = 'intro' | 'battle' | 'victory';

interface ActiveCinematic {
  kind: CinematicKind;
  run: Cinematic;
  /** RTS view the flight ends on; the camera is handed back there. */
  view: CameraView;
  onEnd: () => void;
}

const DUSK_TOP = new THREE.Color('#27305e');
const DUSK_BOTTOM = new THREE.Color('#f39a5b');
const SUN_DAY = new THREE.Color('#fff1d8');
const SUN_DUSK = new THREE.Color('#ffb070');
const FIREWORK_COLORS: Record<Side, string[]> = {
  blue: ['#4fb3ff', '#7cf0ff', '#ffd23f', '#ffffff', '#b98cff'],
  red: ['#ff4d4d', '#ff8a3d', '#ffd23f', '#ffffff', '#ff5fd2'],
};

const SKY_VERT = `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FRAG = `uniform vec3 top; uniform vec3 bottom; varying vec3 vDir;
void main(){ float t = clamp(vDir.y * 1.6 + 0.12, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, t), 1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;

export class BattleEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.3, 1400);
  readonly rts: RtsCamera;
  terrain: Terrain | null = null;
  map: MapDef | null = null;
  sim: BattleSim | null = null;
  mode: 'deploy' | 'battle' = 'deploy';

  private speed = 1;
  private paused = false;
  private acc = 0;
  private resultSent = false;
  private hidden: Side | null = null;
  private readonly mapGroup = new THREE.Group();
  private zones: Record<Side, THREE.Group> | null = null;
  private water: Water | null = null;
  private readonly units: UnitRenderer;
  private readonly projectiles: ProjectileRenderer;
  private readonly particles = new ParticleSystem();
  private readonly effects: EffectRenderer;
  private readonly effectHost: EffectHost;
  /** Camera shake energy (0..1), decays every frame. */
  private shakeAmount = 0;
  /** Interpolation factor of the last rendered sim frame. */
  private alpha = 1;
  private readonly fireworks = new Fireworks();
  private cine: ActiveCinematic | null = null;
  /** The battle sim waits (units idle) while the battle intro plays. */
  private holdSim = false;
  private readonly dusk = { t: 0, goal: 0 };
  private readonly daySky = { top: new THREE.Color(), bottom: new THREE.Color() };
  private ragdolls: RagdollWorld | null = null;
  private ragdollToken = 0;
  private readonly sun = new THREE.DirectionalLight('#fff1d8', 2.6);
  private readonly hemi = new THREE.HemisphereLight('#dcecff', '#5a4a30', 1.25);
  private readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private ghost: { group: THREE.Group; side: Side; valid: (x: number, z: number) => boolean; mats: THREE.MeshStandardMaterial[] } | null = null;
  private readonly timer = new THREE.Timer();
  private time = 0;
  private statsTimer = 0;
  private readonly ro: ResizeObserver;
  private readonly particleDefs: Map<string, ParticleDef>;
  private readonly weapons: Map<string, WeaponDef>;
  private readonly projectileDefs: Map<string, ProjectileDef>;
  private readonly raycaster = new THREE.Raycaster();
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly host: HTMLElement,
    private readonly bundle: ConfigBundle,
    private readonly events: EngineEvents = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.timer.connect(document);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';
    host.appendChild(this.renderer.domElement);

    this.particleDefs = new Map(bundle.particles.map((p) => [p.id, p]));
    this.weapons = new Map(bundle.weapons.map((w) => [w.id, w]));
    this.projectileDefs = new Map(bundle.projectiles.map((p) => [p.id, p]));

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 24, 12),
      new THREE.ShaderMaterial({ uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } }, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    this.sky.frustumCulled = false;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.units = new UnitRenderer(bundle);
    this.projectiles = new ProjectileRenderer(bundle);
    this.effects = new EffectRenderer(bundle);
    this.effectHost = {
      particles: this.particles,
      emitPoint: (id, out) => this.units.emitPoint(id, out),
      chest: (id, out) => {
        const u = this.sim?.units[id];
        if (!u) return false;
        const a = this.mode === 'battle' ? this.alpha : 1;
        out.set(u.px + (u.x - u.px) * a, u.py + (u.y - u.py) * a + u.def.height * 0.55, u.pz + (u.z - u.pz) * a);
        return true;
      },
      shake: (amount, x, z) => {
        if (!this.bundle.settings.cameraShake) return;
        const near = THREE.MathUtils.clamp(1 - Math.hypot(this.rts.target.x - x, this.rts.target.z - z) / 90, 0, 1);
        this.shakeAmount = Math.min(1, this.shakeAmount + amount * near);
      },
    };
    this.scene.add(this.sky, this.hemi, this.sun, this.sun.target, this.mapGroup, this.units.group, this.projectiles.group, this.effects.group, this.particles.group, this.fireworks.group);

    this.rts = new RtsCamera(this.camera, this.renderer.domElement);
    this.rts.pick = (x, y) => this.groundAt(x, y);
    this.bindPointer();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ------------------------------------------------------------------ public API

  loadMap(mapId: string): void {
    const map = this.bundle.maps.find((m) => m.id === mapId) ?? this.bundle.maps[0];
    if (!map) return;
    for (const child of [...this.mapGroup.children]) {
      this.mapGroup.remove(child);
      child.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && o.name !== 'scenery' && !(o as THREE.InstancedMesh).isInstancedMesh) mesh.geometry.dispose();
      });
    }
    this.map = map;
    const terrain = new Terrain(map, this.bundle.assets);
    this.terrain = terrain;
    this.mapGroup.add(createTerrainMesh(terrain), createSkirt(terrain));
    this.water = createWater(terrain);
    if (this.water) this.mapGroup.add(this.water.mesh);
    this.mapGroup.add(createScenery(terrain, new Map(this.bundle.assets.map((a) => [a.id, a]))));
    this.zones = { blue: createZoneOverlay(terrain, 'blue', '#2f6fe0'), red: createZoneOverlay(terrain, 'red', '#d8373a') };
    this.mapGroup.add(this.zones.blue, this.zones.red);

    const top = new THREE.Color(map.skyTop);
    const bottom = new THREE.Color(map.skyBottom);
    this.daySky.top.copy(top);
    this.daySky.bottom.copy(bottom);
    this.scene.fog = new THREE.Fog(bottom, 40 + terrain.size * (1 - map.fog) * 0.8, 120 + terrain.size * (2.6 - map.fog * 1.4));
    this.hemi.color.copy(top).lerp(new THREE.Color('#ffffff'), 0.6);
    this.dusk.t = this.dusk.goal = 0;
    this.applyDusk();
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -terrain.half - 8;
    s.right = s.top = terrain.half + 8;
    s.near = 1;
    s.far = terrain.size * 3;
    s.updateProjectionMatrix();
    this.sun.position.set(-terrain.size * 0.45, terrain.size * 0.9, terrain.size * 0.35);
    this.sun.target.position.set(0, 0, 0);

    this.rts.setTerrain(terrain);
    this.effects.setTerrain(terrain);
    this.sim = null;
    this.mode = 'deploy';
    this.units.clear();
    this.projectiles.clear();
    this.particles.clear();
    this.effects.clear();
    this.resetRagdolls();
    this.setCine(null);
    this.clearVictory();
  }

  showZones(sides: readonly Side[]): void {
    if (!this.zones) return;
    this.zones.blue.visible = sides.includes('blue');
    this.zones.red.visible = sides.includes('red');
  }

  /** Camera behind a side's deployment zone, looking at the enemy. */
  viewSide(side: Side): void {
    const t = this.terrain;
    if (!t) return;
    const zone = t.zones[side];
    this.rts.focus(((zone.x0 + zone.x1) / 2) * 0.55, 0);
    this.rts.setView(side === 'blue' ? Math.PI : 0, 0.85, t.size * 0.42);
  }

  setHidden(side: Side | null): void {
    this.hidden = side;
  }

  /** Deployment preview: units stand at their placements (sim is not stepped). */
  setArmies(armies: Armies): void {
    if (!this.terrain || !this.map) return;
    this.mode = 'deploy';
    this.sim = new BattleSim(this.bundle, this.map, this.terrain, armies, 1);
    this.units.build(this.sim);
    this.projectiles.clear();
    this.particles.clear();
    this.effects.clear();
    this.clearVictory();
  }

  startBattle(armies: Armies, seed: number, stars?: Partial<ArmyStars>): void {
    if (!this.terrain || !this.map) return;
    this.resetRagdolls();
    this.sim = new BattleSim(this.bundle, this.map, this.terrain, armies, seed, stars);
    this.units.build(this.sim);
    this.projectiles.clear();
    this.particles.clear();
    this.effects.clear();
    this.shakeAmount = 0;
    this.mode = 'battle';
    this.acc = 0;
    this.resultSent = false;
    this.hidden = null;
    this.paused = false;
    this.setGhost(null);
    this.showZones([]);
    this.setCine(null);
    this.clearVictory();
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  get cinematic(): CinematicKind | null {
    return this.cine?.kind ?? null;
  }

  /** Establishing flight over the whole map that settles close behind `side`'s deployment zone. */
  playDeployIntro(side: Side, onEnd: () => void = () => {}): void {
    const t = this.terrain;
    if (!t) return onEnd();
    const s = side === 'blue' ? -1 : 1; // own half: x·s > 0
    const h = t.half;
    const zone = t.zones[side];
    const view = this.closeView(side, (zone.x0 + zone.x1) / 2, 0, 24);
    this.play('intro', view, onEnd, 6.5, [
      { at: 0, pos: new THREE.Vector3(-s * h, t.size * 0.5, -h * 0.95), look: this.ground(-s * h * 0.4, 0) },
      { at: 2.4, pos: new THREE.Vector3(-s * h * 0.15, t.size * 0.24, h * 0.9), look: this.ground(0, 0) },
      { at: 4.6, pos: new THREE.Vector3(s * h * 0.45, t.size * 0.16, h * 0.55), look: view.target.clone() },
    ]);
  }

  /** Short flight from the enemy line to close behind `side`'s army; the sim waits for it. */
  playBattleIntro(side: Side, onEnd: () => void = () => {}): void {
    const sim = this.sim;
    if (!this.terrain || !sim) return onEnd();
    const own = this.armyCenter(sim, side);
    const foe = this.armyCenter(sim, side === 'blue' ? 'red' : 'blue');
    const f = side === 'blue' ? 1 : -1; // own army advances toward x·f
    const view = this.closeView(side, own.x + f * 4, own.z, 20);
    const mid = this.ground((own.x + foe.x) / 2, (own.z + foe.z) / 2);
    this.play('battle', view, onEnd, 3.8, [
      { at: 0, pos: new THREE.Vector3(foe.x - f * 16, foe.y + 7, foe.z + 14), look: foe.clone() },
      { at: 1.8, pos: new THREE.Vector3(mid.x, mid.y + 20, mid.z + 28), look: mid },
    ]);
  }

  /** Glide along the winning army, rise to a hero shot, fireworks and dusk over the winners. */
  playVictory(winner: Side, onEnd: () => void = () => {}): void {
    const t = this.terrain;
    const units = this.sim?.units.filter((u) => u.alive && u.side === winner) ?? [];
    if (!t || units.length === 0) return onEnd();
    let cx = 0;
    let cz = 0;
    let fx = 0;
    let fz = 0;
    for (const u of units) {
      cx += u.x;
      cz += u.z;
      fx += u.fx;
      fz += u.fz;
    }
    cx /= units.length;
    cz /= units.length;
    // Principal axis of the survivors = the line to glide along.
    let sxx = 0;
    let sxz = 0;
    let szz = 0;
    for (const u of units) {
      sxx += (u.x - cx) ** 2;
      sxz += (u.x - cx) * (u.z - cz);
      szz += (u.z - cz) ** 2;
    }
    const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    const ax = Math.cos(angle);
    const az = Math.sin(angle);
    let lo = 0;
    let hi = 0;
    for (const u of units) {
      const p = (u.x - cx) * ax + (u.z - cz) * az;
      lo = Math.min(lo, p);
      hi = Math.max(hi, p);
    }
    // Film from the side the army faces.
    let nx = -az;
    let nz = ax;
    if (nx * fx + nz * fz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const len = hi - lo;
    const off = 8 + Math.min(10, len * 0.12);
    const along = (p: number, o: number, lift: number) => this.ground(cx + ax * p + nx * o, cz + az * p + nz * o, lift);
    const glide = THREE.MathUtils.clamp(len / 12, 3, 6);
    // Hero shot: low, from the front, looking over the army at the fireworks behind it.
    const distance = THREE.MathUtils.clamp(len * 0.5 + 30, 32, 70);
    const view: CameraView = { target: this.ground(cx, cz), yaw: Math.atan2(nz, nx), pitch: 0.16, distance };
    const done = () => {
      this.rts.spin = 0.06;
      onEnd();
    };
    // Glide near eye level, looking nearly level so the sky (and the bursts) fills the top of the frame.
    this.play('victory', view, done, glide + 2.4, [
      { at: 0, pos: along(lo - 5, off, 3.4), look: along(lo, 0, 2.4) },
      { at: glide / 2, pos: along((lo + hi) / 2, off * 0.85, 3.6), look: along((lo + hi) / 2 + 2, 0, 2.4) },
      { at: glide, pos: along(hi + 5, off, 4), look: along(hi, 0, 2.4) },
    ]);
    // Launch pads well behind the army, so the bursts land in frame above it.
    const pads = units.map((u) => ({ x: u.x - nx * 30, z: u.z - nz * 30 }));
    this.fireworks.start(pads, FIREWORK_COLORS[winner], (x, z) => t.height(x, z), 16);
    this.dusk.goal = 1;
  }

  skipCinematic(): void {
    if (this.cine) this.finishCinematic();
  }

  setGhost(unitId: string | null, side: Side = 'blue', valid: (x: number, z: number) => boolean = () => true): void {
    if (this.ghost && this.ghost.group.userData.unitId === unitId && this.ghost.side === side) {
      this.ghost.valid = valid;
      return;
    }
    if (this.ghost) {
      this.scene.remove(this.ghost.group);
      for (const m of this.ghost.mats) m.dispose();
      this.ghost = null;
    }
    const def = unitId ? this.bundle.units.find((u) => u.id === unitId) : undefined;
    if (!def) return;
    const template = getUnitTemplate(def, new Map(this.bundle.assets.map((a) => [a.id, a])));
    const poses = template.parts.map(() => new THREE.Matrix4());
    new Poser(template, attackStyleFor(template, this.weapons.get(def.weaponId))).compute(
      { time: 0, speed: 0, phase: 0, attack: -1, airborne: false, stunned: false, leanX: 0, leanZ: 0, seed: 0, refSpeed: 1 },
      poses,
    );
    const ok = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.55, depthWrite: false });
    const bad = new THREE.MeshStandardMaterial({ color: '#ff3030', flatShading: true, transparent: true, opacity: 0.5, depthWrite: false });
    const group = new THREE.Group();
    group.userData.unitId = unitId;
    template.parts.forEach((p, i) => {
      if (!p.geometry) return;
      const m = new THREE.Mesh(p.geometry, ok);
      m.matrixAutoUpdate = false;
      m.matrix.copy(poses[i]);
      group.add(m);
    });
    group.rotation.y = side === 'blue' ? Math.PI / 2 : -Math.PI / 2;
    group.visible = false;
    this.scene.add(group);
    this.ghost = { group, side, valid, mats: [ok, bad] };
  }

  /** Canvas snapshot (used for screenshots/share). */
  snapshot(): string {
    // No preserveDrawingBuffer: render and read back in the same task.
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    this.timer.dispose();
    this.rts.dispose();
    this.ragdollToken++;
    this.ragdolls?.dispose();
    this.units.clear();
    this.projectiles.dispose();
    this.particles.dispose();
    this.effects.dispose();
    this.fireworks.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ------------------------------------------------------------------ internals

  private play(kind: CinematicKind, view: CameraView, onEnd: () => void, endAt: number, shots: Shot[]): void {
    shots.push({ at: endAt, pos: this.rts.positionFor(view, new THREE.Vector3()), look: view.target.clone() });
    this.setCine({ kind, run: new Cinematic(shots, this.terrain), view, onEnd });
  }

  private finishCinematic(): void {
    const c = this.cine!;
    this.setCine(null);
    this.rts.jumpTo(c.view);
    c.onEnd();
  }

  /** Replaces the running cinematic (a replaced one's onEnd never fires). */
  private setCine(c: ActiveCinematic | null): void {
    if (!c && !this.cine) return;
    this.cine = c;
    this.holdSim = c?.kind === 'battle';
    this.rts.enabled = !c;
    if (c && this.ghost) this.ghost.group.visible = false;
    this.events.onCinematic?.(c?.kind ?? null);
  }

  private clearVictory(): void {
    this.fireworks.stop();
    this.rts.spin = 0;
    this.dusk.goal = 0;
  }

  /** Close RTS view behind `side`, looking toward the enemy. */
  private closeView(side: Side, x: number, z: number, distance: number): CameraView {
    return { target: this.ground(x, z), yaw: side === 'blue' ? Math.PI : 0, pitch: basePitch(distance), distance };
  }

  private armyCenter(sim: BattleSim, side: Side): THREE.Vector3 {
    let x = 0;
    let z = 0;
    let n = 0;
    for (const u of sim.units) {
      if (!u.alive || u.side !== side) continue;
      x += u.x;
      z += u.z;
      n++;
    }
    if (n === 0) {
      const zone = this.terrain!.zones[side];
      return this.ground((zone.x0 + zone.x1) / 2, 0, 1);
    }
    return this.ground(x / n, z / n, 1);
  }

  private ground(x: number, z: number, lift = 0): THREE.Vector3 {
    return new THREE.Vector3(x, this.terrain!.height(x, z) + lift, z);
  }

  private updateDusk(dt: number): void {
    const d = this.dusk;
    if (d.t === d.goal) return;
    d.t = d.goal > d.t ? Math.min(d.goal, d.t + dt * 0.5) : Math.max(d.goal, d.t - dt * 0.8);
    this.applyDusk();
  }

  /** Victory mood: sky and light lerp toward dusk so the fireworks pop. */
  private applyDusk(): void {
    const k = this.dusk.t;
    const u = this.sky.material.uniforms;
    u.top.value.copy(this.daySky.top).lerp(DUSK_TOP, k * 0.85);
    u.bottom.value.copy(this.daySky.bottom).lerp(DUSK_BOTTOM, k * 0.7);
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.copy(u.bottom.value);
    this.sun.color.copy(SUN_DAY).lerp(SUN_DUSK, k);
    this.sun.intensity = 2.6 * (1 - 0.45 * k);
    this.hemi.intensity = 1.25 * (1 - 0.4 * k);
  }

  private resetRagdolls(): void {
    const token = ++this.ragdollToken;
    this.ragdolls?.dispose();
    this.ragdolls = null;
    this.units.setRagdolls(null);
    const terrain = this.terrain;
    if (!terrain) return;
    void RagdollWorld.create(terrain)
      .then((world) => {
        if (token !== this.ragdollToken) return world.dispose();
        this.ragdolls = world;
        this.units.setRagdolls(world);
      })
      .catch((e) => console.warn('Ragdoll physics unavailable', e));
  }

  private resize(): void {
    const w = this.host.clientWidth || 800;
    const h = this.host.clientHeight || 600;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private groundAt(clientX: number, clientY: number): THREE.Vector3 | null {
    const terrain = this.terrain;
    if (!terrain) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    const { origin, direction } = this.raycaster.ray;
    const at = (t: number) => this.tmp.copy(origin).addScaledVector(direction, t);
    // Skip the stretch of ray above the highest possible terrain.
    const top = terrain.maxHeight + 0.5;
    if (origin.y > top && direction.y >= 0) return null;
    const start = origin.y > top ? Math.floor((top - origin.y) / direction.y) : 0;
    let prev = start;
    for (let t = start + 1; t < start + 900; t += 1) {
      const p = at(t);
      if (p.y < terrain.height(p.x, p.z)) {
        let lo = prev;
        let hi = t;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          const q = at(mid);
          if (q.y < terrain.height(q.x, q.z)) hi = mid;
          else lo = mid;
        }
        const hit = at(hi).clone();
        return Math.abs(hit.x) <= terrain.half && Math.abs(hit.z) <= terrain.half ? hit : null;
      }
      prev = t;
    }
    return null;
  }

  private bindPointer(): void {
    const dom = this.renderer.domElement;
    const send = (type: PointerInfo['type'], e: PointerEvent) => {
      const p = this.groundAt(e.clientX, e.clientY);
      if (this.ghost) {
        if (p && this.mode === 'deploy' && !this.cine) {
          this.ghost.group.visible = true;
          this.ghost.group.position.copy(p);
          const good = this.ghost.valid(p.x, p.z);
          const [ok, bad] = this.ghost.mats;
          this.ghost.group.children.forEach((c) => ((c as THREE.Mesh).material = good ? ok : bad));
        } else this.ghost.group.visible = false;
      }
      this.events.onPointer?.({ type, x: p?.x ?? 0, z: p?.z ?? 0, hit: !!p, button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey || e.altKey });
    };
    dom.addEventListener('pointerdown', (e) => {
      // A click skips a cinematic and is not treated as a placement.
      if (this.cine) return this.finishCinematic();
      send('down', e);
    });
    dom.addEventListener('pointermove', (e) => send('move', e));
    dom.addEventListener('pointerup', (e) => send('up', e));
    dom.addEventListener('pointerleave', () => {
      if (this.ghost) this.ghost.group.visible = false;
    });
  }

  private frame(): void {
    this.timer.update();
    const dt = Math.min(0.1, this.timer.getDelta());
    if (!this.cine) this.rts.update(dt);
    else if (!this.cine.run.update(dt, this.camera)) this.finishCinematic();
    const sim = this.sim;
    let simDt = 0;
    if (sim && this.mode === 'battle' && !this.paused && !this.holdSim) {
      this.acc += dt * this.speed;
      let steps = 0;
      while (this.acc >= SIM_DT && steps < 16) {
        sim.step();
        this.handleEvents(sim, sim.events);
        if (sim.tick % 30 === 0) this.events.onChecksum?.(sim.tick, sim.checksum());
        if (sim.result && !this.resultSent) {
          this.resultSent = true;
          this.events.onResult?.(sim.result);
        }
        this.acc -= SIM_DT;
        steps++;
      }
      if (steps === 16) this.acc = 0;
      simDt = dt * this.speed;
    }
    const animDt = this.mode === 'battle' && !this.holdSim ? simDt : dt;
    this.time += animDt;
    this.alpha = this.acc / SIM_DT;
    if (sim) {
      this.ragdolls?.step(simDt);
      this.units.manage(simDt, this.bundle.settings);
      this.units.update(sim, this.mode === 'battle' ? this.alpha : 1, animDt, this.hidden);
      this.projectiles.update(sim, this.alpha, simDt, this.particles);
    }
    this.effects.update(animDt, this.mode === 'battle' ? sim : null, this.alpha, this.effectHost);
    this.particles.update(animDt);
    this.fireworks.update(dt);
    this.updateDusk(dt);
    this.water?.update(this.time);
    this.sky.position.copy(this.camera.position);
    if (this.shakeAmount > 0.002) {
      const s = this.shakeAmount * this.shakeAmount * (0.15 + this.camera.position.distanceTo(this.rts.target) * 0.01);
      this.camera.position.x += (Math.random() * 2 - 1) * s;
      this.camera.position.y += (Math.random() * 2 - 1) * s;
      this.camera.position.z += (Math.random() * 2 - 1) * s;
      this.shakeAmount = Math.max(0, this.shakeAmount - dt * 1.6);
    }
    this.renderer.render(this.scene, this.camera);
    this.statsTimer += dt;
    if (sim && this.statsTimer > 0.25) {
      this.statsTimer = 0;
      this.events.onStats?.({ blue: sim.aliveCount('blue'), red: sim.aliveCount('red'), time: sim.time });
    }
    (window as unknown as { __engineFrames?: number }).__engineFrames = ((window as unknown as { __engineFrames?: number }).__engineFrames ?? 0) + 1;
  }

  private emit(id: string | null | undefined, x: number, y: number, z: number, dir?: { x: number; y: number; z: number }, count?: number): void {
    const def = id ? this.particleDefs.get(id) : undefined;
    if (def) this.particles.emit(def, x, y, z, dir, count);
  }

  private handleEvents(sim: BattleSim, events: readonly SimEvent[]): void {
    const terrain = this.terrain!;
    const settings = this.bundle.settings;
    for (const e of events) {
      switch (e.type) {
        case 'hit': {
          const w = this.weapons.get(e.weaponId);
          this.emit(e.blocked ? 'spark' : w?.hitParticleId, e.x, e.y, e.z, { x: e.dx, y: 0.6, z: e.dz });
          this.units.onHit(e);
          break;
        }
        case 'death': {
          const u = sim.units[e.unitId];
          this.units.onDeath(e, sim, settings);
          this.emit(settings.deathParticleId, u.x, u.y + u.def.height * 0.5, u.z, undefined, Math.round(8 + u.def.radius * 6));
          break;
        }
        case 'attack': {
          this.effects.onEvent(e, this.effectHost);
          const w = this.weapons.get(e.weaponId);
          if (!w?.fireParticleId && !(w?.attack === 'projectile' && w.areaParticleId)) break;
          const origin = this.tmp.set(e.x, e.y, e.z);
          this.units.emitPoint(e.unitId, origin);
          const dir = { x: e.dx, y: e.dy, z: e.dz };
          this.emit(w.fireParticleId, origin.x, origin.y, origin.z, dir);
          // Projectiles: the secondary particle lingers where the shot left (gun smoke).
          if (w.attack === 'projectile') this.emit(w.areaParticleId, origin.x, origin.y, origin.z, dir);
          break;
        }
        case 'impact': {
          const def = this.projectileDefs.get(e.defId);
          if (!def) break;
          const wet = terrain.inWater(e.x, e.z) && e.y <= terrain.waterLevel + 0.4;
          this.emit(wet ? settings.splashParticleId : def.impactParticleId, e.x, e.y + 0.1, e.z, { x: -e.dx, y: 0.8, z: -e.dz });
          if (e.stuck && e.ground && !wet) this.projectiles.stick(e.defId, e.x, e.y, e.z, e.dx, e.dy, e.dz);
          break;
        }
        case 'heal': {
          const w = this.weapons.get(e.weaponId);
          this.emit(w?.hitParticleId, e.x, e.y, e.z);
          break;
        }
        case 'land': {
          const wet = terrain.inWater(e.x, e.z);
          this.emit(wet ? settings.splashParticleId : settings.landParticleId, e.x, e.y + 0.1, e.z);
          break;
        }
        default:
          this.effects.onEvent(e, this.effectHost);
          break;
      }
    }
  }
}
