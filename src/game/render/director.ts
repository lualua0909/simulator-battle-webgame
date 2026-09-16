// Auto camera director: films the battle the way an action cameraman would.
//   marching        rides close behind the player's own front line, low to the ground
//   fighting        pulls back over the busiest clash so both lines, the melee and its skills fit
//   click on ground cranes over to that spot and tracks whatever fights there
// Every move runs through a critically damped spring, so a new shot glides in instead of snapping.
// The mouse and touch still work while it films: pinch/wheel is a zoom bias on top of the director's
// framing, a drag or a WASD pan hands control back for a moment and it resumes from where it was left.
import * as THREE from 'three';
import type { Side } from '../sim/terrain';
import { SIM_HZ, type BattleSim, type SimUnit } from '../sim/world';
import type { CameraInput, RtsCamera } from './camera';

const MARCH_MIN = 17;
const MARCH_MAX = 30;
const FIGHT_MIN = 22;
const FIGHT_MAX = 42;
const ZOOM_BIAS_MIN = 0.62;
const ZOOM_BIAS_MAX = 1.55;
/** Low, near-level shot up close; a little higher once the shot opens up. */
const PITCH_NEAR = 0.22;
const PITCH_FAR = 0.4;
/** Seconds the camera takes to settle on a new aim point — the longer the trip, the gentler it is. */
const AIM_SMOOTH = 0.85;
const AIM_SMOOTH_FAR = 2.2;
const ZOOM_SMOOTH = 1.1;
/** Seconds the director keeps its hands off after the last drag or key pan. */
const PAN_HOLD = 2.5;
/** Seconds a clicked (or panned-to) spot owns the shot: only fights inside ANCHOR_RADIUS of it count. */
const ANCHOR_HOLD = 7;
const ANCHOR_RADIUS = 45;
/** Seconds a fresh click holds the shot still, so the crane move reads before tracking resumes. */
const CLICK_LOCK = 1;
/** Fighters are binned into cells this wide; the busiest cell is the shot. */
const BIN = 18;
/** Fighters this close to the busiest cell are framed with it, so both lines stay on screen. */
const REACH = 45;
/** A new cell must beat the filmed one by this much to steal the shot. */
const SWITCH_MARGIN = 1.35;
/** A unit counts as fighting for this long after its last swing. */
const HOT_SECONDS = 1.5;
/** One unit loosing an arrow is not a battle: the shot stays with the army until this many fight. */
const MIN_FIGHTERS = 2;

/** Critically damped spring: the velocity stays continuous, so no new shot ever jolts the camera. */
class Spring {
  private vel = 0;

  constructor(public value: number) {}

  step(target: number, smoothTime: number, dt: number): number {
    const omega = 2 / smoothTime;
    const x = omega * dt;
    const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = this.value - target;
    const step = (this.vel + omega * change) * dt;
    this.vel = (this.vel - omega * step) * decay;
    return (this.value = target + (change + step) * decay);
  }

  set(value: number): void {
    this.value = value;
    this.vel = 0;
  }
}

interface Cell {
  x: number;
  z: number;
  n: number;
  mine: number;
}

export class CameraDirector {
  /** The side the camera belongs to: its troops are the ones followed. */
  side: Side = 'blue';
  private active = false;
  /** Smoothed aim point and zoom. */
  private readonly aimX = new Spring(0);
  private readonly aimZ = new Spring(0);
  private readonly zoom = new Spring(MARCH_MIN);
  /** Where the action is, and how wide the shot wants to be. */
  private readonly goal = new THREE.Vector2();
  private want = MARCH_MIN;
  /** Clicked or parked spot: while it lasts, only fights within ANCHOR_RADIUS of it are filmed. */
  private readonly anchor = new THREE.Vector2();
  private anchorLeft = 0;
  /** Seconds of user control left before the director resumes. */
  private hold = 0;
  /** Seconds left of a clicked spot's hold on the shot. */
  private lock = 0;
  private zoomBias = 1;
  /** Extra pull-back while travelling, decays away on arrival. */
  private bump = 0;
  private think = 0;
  private shotKey = -1;
  private readonly cells = new Map<number, Cell>();
  private readonly pool: SimUnit[] = [];

  constructor(private readonly rts: RtsCamera) {
    rts.onInput = (e) => this.onInput(e);
  }

  /** A click (or tap) on the map: crane over and track whatever happens there. */
  focusAt(x: number, z: number): void {
    if (!this.active) return;
    this.anchor.set(x, z);
    this.anchorLeft = ANCHOR_HOLD;
    this.lock = CLICK_LOCK;
    this.hold = 0;
    this.shotKey = -1;
    this.goal.set(x, z);
    this.want = THREE.MathUtils.clamp(this.want, MARCH_MIN, MARCH_MAX);
    this.travel();
  }

  /** `sim` is null whenever the director should not be filming (deployment, cinematics). */
  update(dt: number, sim: BattleSim | null): void {
    const live = !!sim && !sim.result;
    if (live !== this.active) {
      this.active = live;
      // Take over from wherever the camera is, so the hand-over has no jump.
      if (live) {
        this.aimX.set(this.rts.target.x);
        this.aimZ.set(this.rts.target.z);
        this.zoom.set(this.rts.distance);
        this.goal.set(this.rts.target.x, this.rts.target.z);
        this.want = this.rts.distance;
        this.zoomBias = 1;
        this.hold = 0;
        this.anchorLeft = 0;
        this.lock = 0;
        this.bump = 0;
        this.shotKey = -1;
        this.think = 0;
      } else this.rts.releasePitch();
    }
    if (!live) return;
    this.hold = Math.max(0, this.hold - dt);
    this.anchorLeft = Math.max(0, this.anchorLeft - dt);
    this.lock = Math.max(0, this.lock - dt);
    this.bump *= Math.exp(-dt * 1.6);
    this.think -= dt;
    // A fresh click holds the shot where it landed before the director starts tracking again.
    if (this.think <= 0 && this.lock === 0) {
      this.think = 0.3;
      this.pickShot(sim!);
    }
    if (this.hold > 0) {
      // The user is driving: track the live view so the director resumes from there.
      this.aimX.set(this.rts.target.x);
      this.aimZ.set(this.rts.target.z);
    } else {
      // A long trip eases in and out: a far shot is taken slowly, the last metres settle tight.
      const far = Math.hypot(this.goal.x - this.aimX.value, this.goal.y - this.aimZ.value);
      const smooth = THREE.MathUtils.clamp(AIM_SMOOTH + far * 0.02, AIM_SMOOTH, AIM_SMOOTH_FAR);
      this.rts.focus(this.aimX.step(this.goal.x, smooth, dt), this.aimZ.step(this.goal.y, smooth, dt));
    }
    // A narrow phone frame sees less of the field, so the same action needs a little more distance.
    const fit = THREE.MathUtils.clamp(1.2 / this.rts.camera.aspect, 1, 1.35);
    const distance = this.zoom.step((this.want * fit + this.bump) * this.zoomBias, ZOOM_SMOOTH, dt);
    this.rts.setDistance(distance);
    this.rts.autoPitch = THREE.MathUtils.lerp(PITCH_NEAR, PITCH_FAR, THREE.MathUtils.clamp((distance - MARCH_MIN) / 30, 0, 1));
  }

  // ------------------------------------------------------------------ internals

  private onInput(e: CameraInput): boolean {
    if (!this.active) return false;
    if (e.kind === 'zoom') {
      // The wheel (or a pinch) biases the director's framing instead of fighting it.
      this.zoomBias = THREE.MathUtils.clamp(this.zoomBias * e.factor, ZOOM_BIAS_MIN, ZOOM_BIAS_MAX);
      return true;
    }
    if (e.kind === 'pan' || e.kind === 'key') {
      this.hold = PAN_HOLD;
      // Whatever the user pans to becomes the area the director films next.
      this.anchor.set(this.rts.target.x, this.rts.target.z);
      this.anchorLeft = ANCHOR_HOLD;
      this.shotKey = -1;
    }
    return false;
  }

  /** Pull back for the length of the trip, like a cameraman craning over the field. */
  private travel(): void {
    const far = Math.hypot(this.goal.x - this.aimX.value, this.goal.y - this.aimZ.value);
    if (far > 20) this.bump = Math.max(this.bump, Math.min(18, far * 0.2));
  }

  /** Picks the patch of battlefield worth filming, with hysteresis so the shot holds still. */
  private pickShot(sim: BattleSim): void {
    const cells = this.cells;
    cells.clear();
    const since = sim.tick - SIM_HZ * HOT_SECONDS;
    for (const u of sim.units) {
      if (!this.fighting(u, since)) continue;
      // While a clicked spot owns the shot, only the fighting around it counts.
      if (this.anchorLeft > 0 && Math.hypot(u.x - this.anchor.x, u.z - this.anchor.y) > ANCHOR_RADIUS) continue;
      const key = (Math.floor(u.x / BIN) + 512) * 1024 + Math.floor(u.z / BIN) + 512;
      let c = cells.get(key);
      if (!c) cells.set(key, (c = { x: 0, z: 0, n: 0, mine: 0 }));
      c.x += u.x;
      c.z += u.z;
      c.n++;
      if (u.side === this.side) c.mine++;
    }
    let fighters = 0;
    for (const c of cells.values()) fighters += c.n;
    if (fighters < MIN_FIGHTERS) return this.marchShot(sim);
    let key = -1;
    let best = 0;
    let bx = 0;
    let bz = 0;
    for (const [k, c] of cells) {
      const x = c.x / c.n;
      const z = c.z / c.n;
      const score = this.score(c, x, z);
      if (score > best) {
        best = score;
        key = k;
        bx = x;
        bz = z;
      }
    }
    const held = this.shotKey >= 0 ? cells.get(this.shotKey) : undefined;
    if (held && key !== this.shotKey) {
      const hx = held.x / held.n;
      const hz = held.z / held.n;
      if (best < this.score(held, hx, hz) * SWITCH_MARGIN) {
        key = this.shotKey;
        bx = hx;
        bz = hz;
      }
    }
    // Frame everyone fighting around that cell — both lines, not just the densest knot of them.
    const near = this.pool;
    near.length = 0;
    let sx = 0;
    let sz = 0;
    for (const u of sim.units) {
      if (!this.fighting(u, since) || Math.hypot(u.x - bx, u.z - bz) > REACH) continue;
      near.push(u);
      sx += u.x;
      sz += u.z;
    }
    const gx = sx / near.length;
    const gz = sz / near.length;
    let spread = 0;
    for (const u of near) spread = Math.max(spread, Math.hypot(u.x - gx, u.z - gz));
    this.shotKey = key;
    this.goal.set(gx, gz);
    this.want = THREE.MathUtils.clamp(spread * 1.6 + 16, FIGHT_MIN, FIGHT_MAX);
    this.travel();
  }

  /** Swinging in the last HOT_SECONDS, or winding up / channelling a skill right now. */
  private fighting(u: SimUnit, since: number): boolean {
    return u.alive && !u.structure && (u.action !== null || u.lastAttackTick >= since);
  }

  /** Nobody is fighting yet: hold the spot the user picked, else ride the own front line. */
  private marchShot(sim: BattleSim): void {
    if (this.anchorLeft > 0) return this.anchorShot(sim);
    const own = this.pool;
    own.length = 0;
    for (const u of sim.units) if (u.alive && !u.structure && u.side === this.side) own.push(u);
    if (own.length === 0) for (const u of sim.units) if (u.alive && !u.structure) own.push(u);
    if (own.length === 0) for (const u of sim.units) if (u.alive) own.push(u);
    if (own.length === 0) return;
    const f = this.side === 'blue' ? 1 : -1; // the side advances toward x·f
    let lead = -Infinity;
    for (const u of own) lead = Math.max(lead, u.x * f);
    // Stragglers well behind the line do not drag the shot back.
    const front = own.filter((u) => u.x * f >= lead - 30);
    let sx = 0;
    let sz = 0;
    for (const u of front) {
      sx += u.x;
      sz += u.z;
    }
    const cx = sx / front.length;
    const cz = sz / front.length;
    let spread = 0;
    for (const u of front) spread = Math.max(spread, Math.hypot(u.x - cx, u.z - cz));
    this.shotKey = -1;
    this.goal.set(cx + f * 5, cz); // look a step ahead of the line
    this.want = THREE.MathUtils.clamp(spread * 1.1 + 12, MARCH_MIN, MARCH_MAX);
    this.travel();
  }

  /** A clicked or panned-to spot with no fight of its own: frame it by whoever stands around it. */
  private anchorShot(sim: BattleSim): void {
    let spread = 0;
    for (const u of sim.units) {
      if (!u.alive || u.structure) continue;
      const d = Math.hypot(u.x - this.anchor.x, u.z - this.anchor.y);
      if (d <= 35) spread = Math.max(spread, d);
    }
    this.shotKey = -1;
    this.goal.copy(this.anchor);
    this.want = THREE.MathUtils.clamp(spread * 1.1 + 14, MARCH_MIN, MARCH_MAX);
    this.travel();
  }

  /** Busy cells win; the player's own troops and the shot already running both pull. */
  private score(c: Cell, x: number, z: number): number {
    const s = c.n * (1 + (c.mine / c.n) * 0.6);
    return s / (1 + Math.hypot(x - this.aimX.value, z - this.aimZ.value) / 90);
  }
}
