// Auto camera director: films the battle the way an action cameraman would.
//   marching        rides just behind the player's own front line, close in
//   fighting        pulls back over the busiest clash so the melee and its skills stay in frame
//   click on ground cranes over to that spot and tracks whatever fights there
// The mouse still works while it films: the wheel is a zoom bias on top of the director's framing,
// a drag or a WASD pan hands control back for a moment and the director resumes from where it was left.
import * as THREE from 'three';
import type { Side } from '../sim/terrain';
import { SIM_HZ, type BattleSim, type SimUnit } from '../sim/world';
import type { CameraInput, RtsCamera } from './camera';

const MARCH_MIN = 26;
const MARCH_MAX = 46;
const FIGHT_MIN = 34;
const FIGHT_MAX = 62;
const ZOOM_BIAS_MIN = 0.62;
const ZOOM_BIAS_MAX = 1.55;
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
  /** Smoothed aim point (x, z) and the spot the action is at. */
  private readonly focus = new THREE.Vector2();
  private readonly goal = new THREE.Vector2();
  /** Clicked or parked spot: while it lasts, only fights within ANCHOR_RADIUS of it are filmed. */
  private readonly anchor = new THREE.Vector2();
  private anchorLeft = 0;
  /** Seconds of user control left before the director resumes. */
  private hold = 0;
  /** Seconds left of a clicked spot's hold on the shot. */
  private lock = 0;
  private zoomBias = 1;
  private distance = MARCH_MIN;
  private want = MARCH_MIN;
  /** Extra pull-back while travelling, decays away on arrival. */
  private bump = 0;
  private think = 0;
  private shotKey = -1;
  private readonly cells = new Map<number, Cell>();
  private readonly pool: SimUnit[] = [];

  constructor(private readonly rts: RtsCamera) {
    rts.onInput = (e) => this.onInput(e);
  }

  /** A click on the map: crane over and track whatever happens there. */
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
        this.focus.set(this.rts.target.x, this.rts.target.z);
        this.goal.copy(this.focus);
        this.distance = this.want = this.rts.distance;
        this.zoomBias = 1;
        this.hold = 0;
        this.anchorLeft = 0;
        this.bump = 0;
        this.lock = 0;
        this.shotKey = -1;
        this.think = 0;
      }
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
      this.focus.set(this.rts.target.x, this.rts.target.z);
    } else {
      this.focus.lerp(this.goal, 1 - Math.exp(-dt * 2.4));
      this.rts.focus(this.focus.x, this.focus.y);
    }
    this.distance += (this.want - this.distance) * (1 - Math.exp(-dt * 1.6));
    this.rts.setDistance(this.distance * this.zoomBias + this.bump);
  }

  // ------------------------------------------------------------------ internals

  private onInput(e: CameraInput): boolean {
    if (!this.active) return false;
    if (e.kind === 'zoom') {
      // The wheel biases the director's framing instead of fighting it.
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
    const far = Math.hypot(this.goal.x - this.focus.x, this.goal.y - this.focus.y);
    if (far > 20) this.bump = Math.max(this.bump, Math.min(30, far * 0.25));
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
    this.want = THREE.MathUtils.clamp(spread * 2 + 24, FIGHT_MIN, FIGHT_MAX);
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
    this.want = THREE.MathUtils.clamp(spread * 1.3 + 18, MARCH_MIN, MARCH_MAX);
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
    this.want = THREE.MathUtils.clamp(spread * 1.4 + 18, MARCH_MIN, MARCH_MAX);
    this.travel();
  }

  /** Busy cells win; the player's own troops and the shot already running both pull. */
  private score(c: Cell, x: number, z: number): number {
    const s = c.n * (1 + (c.mine / c.n) * 0.6);
    return s / (1 + Math.hypot(x - this.focus.x, z - this.focus.y) / 90);
  }
}
