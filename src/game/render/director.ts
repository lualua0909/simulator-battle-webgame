// Auto camera director: films the battle the way an action cameraman would.
//   marching        rides close behind the player's own front line, low to the ground
//   fighting        pulls back over the busiest clash so both lines, the melee and its skills fit
//   click on ground cranes over to that spot and tracks whatever fights there
// Every move runs through a critically damped spring, so a new shot glides in instead of snapping, and
// both the aim and the zoom ignore the churn of a melee: they only move once the action really shifts.
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
/** Góc quay battle: đủ cao để mép dưới màn hình luôn chạm đất trong map/skirt, không chĩa lên trời lộ ngoài map. */
const PITCH_NEAR = 0.5;
const PITCH_FAR = 0.68;
/** Side view: as flat as the battle floor allows (see RtsCamera.goalPitch), so the two lines meet across the screen. */
const FLAT_NEAR = 0.45;
const FLAT_FAR = 0.52;
/** Seconds the camera takes to settle on a new aim point — the longer the trip, the gentler it is. */
const AIM_SMOOTH = 1.5;
const AIM_SMOOTH_FAR = 3.2;
/** The zoom glides slower still, and closes in more lazily than it opens up. */
const ZOOM_OUT_SMOOTH = 2.4;
const ZOOM_IN_SMOOTH = 3.4;
/** The framing only changes once the action needs this much more (or less) room: the shot never breathes. */
const ZOOM_DEADBAND = 0.15;
/** Share of the gap the smoothed room need closes per look (every 0.3 s): about two seconds of memory. */
const NEED_EASE = 0.15;
/** Metres of pull-back per m/s of travel (capped), so the ground never rushes past a close lens. */
const CRANE = 0.35;
const CRANE_MAX = 12;
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
/** Another fight must beat the filmed one by this much to steal the shot... */
const SWITCH_MARGIN = 1.35;
/** ...and not before the filmed one had this many seconds on screen. */
const SHOT_MIN = 4;
/** A unit counts as fighting for this long after its last swing, or a slow weapon for its reload (up to HOT_MAX). */
const HOT_SECONDS = 4;
const HOT_MAX = 12;
/** Seconds a fight keeps the shot once nobody fights there, so a lull does not send the camera away and back. */
const LULL = 3;
/** One unit loosing an arrow is not a battle: the shot stays with the army until this many fight. */
const MIN_FIGHTERS = 2;

/** Critically damped spring: the velocity stays continuous, so no new shot ever jolts the camera. */
class Spring {
  vel = 0;

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
  /** Side view: film low from the flank instead of from behind the own army. */
  flat = false;
  private active = false;
  /** Smoothed aim point and zoom. */
  private readonly aimX = new Spring(0);
  private readonly aimZ = new Spring(0);
  private readonly zoom = new Spring(MARCH_MIN);
  /** Where the action is, and how wide the shot wants to be. */
  private readonly goal = new THREE.Vector2();
  private want = MARCH_MIN;
  /** The room the action has needed over the last couple of seconds: `want` follows it in steps. */
  private need = MARCH_MIN;
  /** Clicked or parked spot: while it lasts, only fights within ANCHOR_RADIUS of it are filmed. */
  private readonly anchor = new THREE.Vector2();
  private anchorLeft = 0;
  /** Seconds of user control left before the director resumes. */
  private hold = 0;
  /** Seconds left of a clicked spot's hold on the shot. */
  private lock = 0;
  private zoomBias = 1;
  private think = 0;
  private clock = 0;
  /** Filming a fight (not the march or a parked spot), since when it has had the shot, and when it last fought. */
  private filming = false;
  private shotAt = 0;
  private fightAt = 0;
  private readonly cells = new Map<number, Cell>();
  private readonly pool: SimUnit[] = [];
  private readonly at = new THREE.Vector2();

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
    this.filming = false;
    this.goal.set(x, z);
    this.want = this.need = THREE.MathUtils.clamp(this.want, MARCH_MIN, MARCH_MAX);
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
        this.want = this.need = this.rts.distance;
        this.zoomBias = 1;
        this.hold = 0;
        this.anchorLeft = 0;
        this.lock = 0;
        this.filming = false;
        this.think = 0;
      } else this.rts.releasePitch();
    }
    if (!live) return;
    this.clock += dt;
    this.hold = Math.max(0, this.hold - dt);
    this.anchorLeft = Math.max(0, this.anchorLeft - dt);
    this.lock = Math.max(0, this.lock - dt);
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
    // Craning up with the travel speed makes a long trip one smooth arc out and back in.
    const framing = this.want * fit + Math.min(CRANE_MAX, Math.hypot(this.aimX.vel, this.aimZ.vel) * CRANE);
    const settle = framing > this.zoom.value ? ZOOM_OUT_SMOOTH : ZOOM_IN_SMOOTH;
    // The wheel's bias sits outside the slow spring, so a scroll still answers at once.
    const distance = this.zoom.step(framing, settle, dt) * this.zoomBias;
    this.rts.setDistance(distance);
    const t = THREE.MathUtils.clamp((distance - MARCH_MIN) / 30, 0, 1);
    this.rts.autoPitch = this.flat ? THREE.MathUtils.lerp(FLAT_NEAR, FLAT_FAR, t) : THREE.MathUtils.lerp(PITCH_NEAR, PITCH_FAR, t);
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
      this.filming = false;
    }
    return false;
  }

  /** Picks the patch of battlefield worth filming, with hysteresis so the shot holds still. */
  private pickShot(sim: BattleSim): void {
    const cells = this.cells;
    cells.clear();
    for (const u of sim.units) {
      if (!this.fighting(u, sim.tick)) continue;
      const p = this.spot(sim, u);
      // While a clicked spot owns the shot, only the fighting around it counts.
      if (this.anchorLeft > 0 && Math.hypot(p.x - this.anchor.x, p.y - this.anchor.y) > ANCHOR_RADIUS) continue;
      const key = (Math.floor(p.x / BIN) + 512) * 1024 + Math.floor(p.y / BIN) + 512;
      let c = cells.get(key);
      if (!c) cells.set(key, (c = { x: 0, z: 0, n: 0, mine: 0 }));
      c.x += p.x;
      c.z += p.y;
      c.n++;
      if (u.side === this.side) c.mine++;
    }
    let fighters = 0;
    for (const c of cells.values()) fighters += c.n;
    if (fighters < MIN_FIGHTERS) {
      // A lull is not the end of the fight: the shot waits a moment before it rides the line again.
      if (this.filming && this.clock - this.fightAt < LULL) return;
      return this.marchShot(sim);
    }
    this.fightAt = this.clock;
    // The busiest cell anywhere, and the busiest one of the fight already on screen.
    let best = 0;
    let bx = 0;
    let bz = 0;
    let here = 0;
    for (const c of cells.values()) {
      const x = c.x / c.n;
      const z = c.z / c.n;
      const score = this.score(c, x, z);
      if (score > best) {
        best = score;
        bx = x;
        bz = z;
      }
      if (this.filming && score > here && Math.hypot(x - this.goal.x, z - this.goal.y) <= REACH) here = score;
    }
    // Another fight takes over only once this one had its time, and only when clearly bigger: no ping-pong.
    // Staying, the shot drifts with the fight's own centre instead of hopping between its cells.
    if (here > 0 && (this.clock - this.shotAt < SHOT_MIN || best < here * SWITCH_MARGIN)) {
      bx = this.goal.x;
      bz = this.goal.y;
    } else this.shotAt = this.clock;
    // Frame everyone fighting around that spot — both lines, not just the densest knot of them.
    let n = 0;
    let sx = 0;
    let sz = 0;
    let ss = 0;
    for (const u of sim.units) {
      if (!this.fighting(u, sim.tick)) continue;
      const p = this.spot(sim, u);
      if (Math.hypot(p.x - bx, p.y - bz) > REACH) continue;
      n++;
      sx += p.x;
      sz += p.y;
      ss += p.x * p.x + p.y * p.y;
    }
    if (n === 0) return;
    const gx = sx / n;
    const gz = sz / n;
    // RMS radius rather than the farthest fighter, so one straggler does not yank the zoom.
    const spread = Math.sqrt(Math.max(0, ss / n - gx * gx - gz * gz));
    this.filming = true;
    this.goal.set(gx, gz);
    this.frame(spread * 2.2 + 16, FIGHT_MIN, FIGHT_MAX);
  }

  /** Swung within HOT_SECONDS (or its own reload, for a slow weapon), or winding up / channelling a skill right now. */
  private fighting(u: SimUnit, tick: number): boolean {
    if (!u.alive || u.structure) return false;
    const a = u.lastAction;
    const hot = THREE.MathUtils.clamp(a.def.cooldown / a.rate + 1, HOT_SECONDS, HOT_MAX);
    return u.action !== null || tick - u.lastAttackTick <= hot * SIM_HZ;
  }

  /** Where a unit's fight is: halfway to the target in its reach, so a volley is filmed where it flies. */
  private spot(sim: BattleSim, u: SimUnit): THREE.Vector2 {
    const t = sim.units[u.targetId];
    if (!t?.alive || Math.hypot(t.x - u.x, t.z - u.z) > u.weapon.range * u.rangeMul + 2) return this.at.set(u.x, u.z);
    return this.at.set((u.x + t.x) / 2, (u.z + t.z) / 2);
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
    let ss = 0;
    for (const u of front) {
      sx += u.x;
      sz += u.z;
      ss += u.x * u.x + u.z * u.z;
    }
    const cx = sx / front.length;
    const cz = sz / front.length;
    const spread = Math.sqrt(Math.max(0, ss / front.length - cx * cx - cz * cz));
    this.filming = false;
    this.goal.set(cx + f * 5, cz); // look a step ahead of the line
    this.frame(spread * 1.5 + 12, MARCH_MIN, MARCH_MAX);
  }

  /** A clicked or panned-to spot with no fight of its own: frame it by whoever stands around it. */
  private anchorShot(sim: BattleSim): void {
    let n = 0;
    let ss = 0;
    for (const u of sim.units) {
      if (!u.alive || u.structure) continue;
      const d = Math.hypot(u.x - this.anchor.x, u.z - this.anchor.y);
      if (d > 35) continue;
      n++;
      ss += d * d;
    }
    this.filming = false;
    this.goal.copy(this.anchor);
    this.frame(Math.sqrt(ss / Math.max(1, n)) * 1.5 + 14, MARCH_MIN, MARCH_MAX);
  }

  /** Re-frames only once the action has needed clearly more or less room for a while, so the zoom never pumps. */
  private frame(want: number, min: number, max: number): void {
    this.need += (THREE.MathUtils.clamp(want, min, max) - this.need) * NEED_EASE;
    if (Math.abs(this.need - this.want) > this.want * ZOOM_DEADBAND) this.want = this.need;
    this.want = THREE.MathUtils.clamp(this.want, min, max);
  }

  /** Busy cells win; the player's own troops and the shot already running both pull. */
  private score(c: Cell, x: number, z: number): number {
    const s = c.n * (1 + (c.mine / c.n) * 0.6);
    return s / (1 + Math.hypot(x - this.aimX.value, z - this.aimZ.value) / 90);
  }
}
