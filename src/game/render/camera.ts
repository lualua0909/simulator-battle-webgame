// RTS camera tuned for mouse, trackpad and touch:
//   wheel / pinch                 zoom toward the cursor, proportional to the scroll amount
//   right button                  ignored (does not move the camera)
//   middle-drag                   grab-pan: the ground point under the cursor sticks to it
//   left-drag when `leftPan`      grab-pan too (whenever the left button is not placing units)
//   one-finger drag               grab-pan; two fingers pinch to zoom, twist to orbit, drag to pan
//   WASD / arrows pan, Q/E rotate.
// Tilt follows zoom (close = low and cinematic, far = top-down) plus the user's own tilt offset.
// UI panels over the canvas are insets: the projection centres on the area they leave uncovered, so the aim point,
// orbit, framing and map bounds all work on what the player can actually see.
import * as THREE from 'three';
import type { Terrain } from '../sim/terrain';
import { angleDiff } from './unitView';

const MIN_DISTANCE = 10;
const MIN_PITCH = 0.12;
const MAX_PITCH = 1.45;
/**
 * Góc nâng tối thiểu cho thao tác của user (chuột phải kéo).
 * Phải lớn hơn nửa FOV dọc (50°/2 ≈ 0.436 rad) để mép dưới màn hình luôn
 * chạm đất (skirt) thay vì chĩa lên trời và lộ khoảng trắng ngoài map.
 * Cinematic/director (pitch thấp) vẫn được phép qua jumpTo/setView/autoPitch.
 */
const USER_MIN_PITCH = 0.55;
const CLEARANCE = 1.5;
/**
 * Phía trước tâm ngắm phải còn thấy map ít nhất từng này × khoảng cách camera. Không đòi cả mép trên màn hình:
 * góc thấp thì mép trên là đường chân trời, ra ngoài map là tự nhiên.
 */
const FAR_REACH = 0.4;
/**
 * Phần nửa bề rộng vùng trống mà mép trái/phải được phép lấn ra ngoài map khi nhìn chéo 45°. Nhìn chéo qua một góc
 * map (xếp quân 3-4 phe) thì cả hai mép đều lấn ra, không thể giữ trọn trong map; nhìn dọc theo mép map thì giữ được
 * nên không cho lấn.
 */
const SIDE_SLACK = 0.5;
/** fit(): lề chừa trong vùng trống, theo tỉ lệ kích thước vùng đó. */
const FIT_PAD = 0.04;
const NO_INSETS: ViewInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const MOVE_KEYS = ['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];

/** Pitch preferred at a zoom distance; the user's tilt is an offset on top of it. */
export function basePitch(distance: number): number {
  const t = THREE.MathUtils.clamp(Math.log(distance / 8) / Math.log(20), 0, 1);
  return 0.3 + t * 0.6;
}

/** Input the auto-director may take over (see `onInput`). */
export type CameraInput = { kind: 'zoom'; factor: number } | { kind: 'pan' } | { kind: 'orbit' } | { kind: 'key' };

export interface CameraView {
  target: THREE.Vector3;
  yaw: number;
  pitch: number;
  distance: number;
}

/** CSS pixels of the canvas covered by UI along each edge. */
export interface ViewInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Two-finger state: spread, twist and midpoint on screen. */
interface Gesture {
  dist: number;
  angle: number;
  x: number;
  y: number;
}

interface Drag {
  mode: 'orbit' | 'pan';
  x: number;
  y: number;
  /** Ground point grabbed by a pan (null when the cursor was on the sky). */
  grab: THREE.Vector3 | null;
}

export class RtsCamera {
  readonly target = new THREE.Vector3();
  yaw = Math.PI;
  pitch = 0.78;
  distance = 70;
  /** Input is ignored while a cinematic drives the camera. */
  enabled = true;
  /** Slow automatic orbit in rad/s; any camera input stops it. */
  spin = 0;
  /** Ground point under a screen position (terrain raycast), supplied by the engine. */
  pick: ((clientX: number, clientY: number) => THREE.Vector3 | null) | null = null;
  /** Auto-director hook; returning true means the director applied the input itself. */
  onInput: ((e: CameraInput) => boolean) | null = null;
  /** Pitch the auto-director asks for (null = the pitch that follows the zoom distance). */
  autoPitch: number | null = null;
  /** Yaw the camera is held at (null = free): Q/E, drag and twist no longer turn it. */
  lockYaw: number | null = null;
  private panWithLeft = false;
  private tilt = 0;
  private readonly goal = { yaw: this.yaw, distance: this.distance, target: new THREE.Vector3() };
  private keys = new Set<string>();
  private drag: Drag | null = null;
  /** Live touch points, and the two-finger gesture they form. */
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinch: Gesture | null = null;
  private terrain: Terrain | null = null;
  private maxDistance = 220;
  private insets = NO_INSETS;
  /** Canvas size in CSS pixels. */
  private width = 1;
  private height = 1;
  /** Half the uncovered area's width and height on the image plane one metre in front of the camera. */
  private halfU = 1;
  private halfV = 1;
  private readonly scratch = new THREE.PerspectiveCamera();
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly hit = new THREE.Vector3();
  private readonly cleanup: Array<() => void> = [];

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement,
  ) {
    const on = <K extends keyof WindowEventMap>(target: Window | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener));
    };
    on(window, 'keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.key.toLowerCase());
    });
    on(window, 'keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    on(window, 'blur', () => this.keys.clear());
    on(dom, 'contextmenu', (e) => e.preventDefault());
    // Stops the browser's middle-click autoscroll.
    on(dom, 'mousedown', (e) => e.button === 1 && e.preventDefault());
    on(dom, 'pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'touch') {
        this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        // A second finger ends the one-finger pan and starts a pinch.
        if (this.touches.size >= 2) {
          this.drag = null;
          this.pinch = this.touches.size === 2 ? this.gesture() : null;
          return;
        }
      }
      const pan = e.button === 1 || (e.button === 0 && this.panWithLeft);
      if (!pan) return;
      this.spin = 0;
      this.onInput?.({ kind: pan ? 'pan' : 'orbit' });
      this.drag = { mode: pan ? 'pan' : 'orbit', x: e.clientX, y: e.clientY, grab: pan ? this.groundUnder(e.clientX, e.clientY)?.clone() ?? null : null };
      dom.style.cursor = 'grabbing';
    });
    on(window, 'pointermove', (e) => {
      const touch = this.touches.get(e.pointerId);
      if (touch) {
        touch.x = e.clientX;
        touch.y = e.clientY;
        if (this.pinch) return this.pinchMove();
      }
      const d = this.drag;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      d.x = e.clientX;
      d.y = e.clientY;
      if (d.mode === 'orbit') {
        this.goal.yaw -= dx * 0.0065;
        // User không được hạ góc xuống quá thấp (lộ bầu trời / ngoài map);
        // cinematic vẫn có thể dùng pitch thấp qua jumpTo/autoPitch.
        const pitch = THREE.MathUtils.clamp(this.goalPitch() + dy * 0.005, USER_MIN_PITCH, MAX_PITCH);
        this.tilt = pitch - this.pitchBase();
      } else this.dragPan(e.clientX, e.clientY, dx, dy, d.grab);
      this.onInput?.({ kind: d.mode });
    });
    const lift = (e: PointerEvent) => {
      if (this.touches.delete(e.pointerId)) this.pinch = this.touches.size === 2 ? this.gesture() : null;
      if (!this.drag) return;
      this.drag = null;
      dom.style.cursor = this.panWithLeft ? 'grab' : '';
    };
    on(window, 'pointerup', lift);
    on(window, 'pointercancel', lift);
    on(
      dom,
      'wheel',
      (e) => {
        e.preventDefault();
        if (!this.enabled) return;
        this.spin = 0;
        // Line/page deltas (Firefox, some mice) → pixels; clamp accelerated wheels.
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
        const dy = THREE.MathUtils.clamp(e.deltaY * unit, -160, 160);
        // ctrlKey = trackpad pinch: small deltas, so a stronger gain.
        const factor = Math.exp(dy * (e.ctrlKey ? 0.012 : 0.0015));
        if (this.onInput?.({ kind: 'zoom', factor })) return;
        this.zoomAt(e.clientX, e.clientY, factor);
      },
      { passive: false },
    );
  }

  /** Left-drag pans the map (set while the left button is not used for placing units). */
  set leftPan(on: boolean) {
    this.panWithLeft = on;
    if (!this.drag) this.dom.style.cursor = on ? 'grab' : '';
  }

  get leftPan(): boolean {
    return this.panWithLeft;
  }

  /** The canvas was resized (CSS pixels). */
  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.updateProjection();
  }

  /** UI now covers these canvas edges (null = none): from here on the view centres on the rest. */
  setInsets(insets: ViewInsets | null): void {
    this.insets = insets ?? NO_INSETS;
    this.updateProjection();
    this.clampTargets();
  }

  setTerrain(terrain: Terrain): void {
    this.terrain = terrain;
    // Zoomed all the way out the map just fills the frame — no further.
    // An island may be zoomed out further, to see it floating whole.
    this.maxDistance = Math.max(70, terrain.size * (terrain.island ? 1.8 : 1.05));
    this.goal.target.set(0, 0, 0);
    this.setView(Math.PI, 0.8, terrain.size * 0.55);
  }

  focus(x: number, z: number, distance?: number): void {
    this.goal.target.set(x, 0, z);
    if (distance) this.goal.distance = this.clampDistance(distance);
    this.clampTargets();
  }

  /** Hand the pitch back: whatever angle the director held becomes the user's own tilt. */
  releasePitch(): void {
    if (this.autoPitch === null) return;
    this.tilt = this.goalPitch() - basePitch(this.goal.distance);
    // Không giữ góc là là mặt đất của director làm góc của user (sẽ lộ ngoài map).
    const minTilt = USER_MIN_PITCH - basePitch(this.goal.distance);
    if (this.tilt < minTilt) this.tilt = minTilt;
    this.autoPitch = null;
  }

  /** Zoom to a distance without touching the aim point (the auto-director's zoom). */
  setDistance(distance: number): void {
    this.goal.distance = this.clampDistance(distance);
  }

  setView(yaw: number, pitch: number, distance: number): void {
    this.goal.yaw = yaw;
    this.goal.distance = this.clampDistance(distance);
    this.tilt = pitch - this.pitchBase();
    this.clampTargets();
  }

  /** Snap to a view with no smoothing (a cinematic handing the camera back). */
  jumpTo(view: CameraView): void {
    this.goal.target.copy(view.target);
    this.target.copy(view.target);
    this.goal.yaw = this.yaw = view.yaw;
    this.goal.distance = this.distance = this.clampDistance(view.distance);
    this.tilt = view.pitch - this.pitchBase();
    this.pitch = this.goalPitch();
    this.clampTargets();
    this.target.copy(this.goal.target);
    this.applyPose();
  }

  /** Glide to a view with the usual smoothing; the yaw turns the short way round. */
  glideTo(view: CameraView): void {
    this.spin = 0;
    this.goal.target.copy(view.target);
    this.goal.yaw = this.yaw + angleDiff(view.yaw, this.yaw);
    this.goal.distance = this.clampDistance(view.distance);
    this.tilt = view.pitch - this.pitchBase();
    this.clampTargets();
  }

  /** Where the live camera would sit for a view (same terrain clearance). */
  positionFor(view: CameraView, out: THREE.Vector3): THREE.Vector3 {
    this.poseCamera(this.scratch, view.target, view.yaw, view.pitch, view.distance);
    return out.copy(this.scratch.position);
  }

  /**
   * The view from `yaw`/`pitch` that holds `points` inside the uncovered area, as close as they fit — but never
   * farther than `maxDistance`: a set that still does not fit is centred and overflows evenly. Spare height goes
   * above the points (the ground ahead), not below them (behind, where the map ends). The map bounds are applied
   * while fitting, so the view survives them unchanged.
   */
  fit(points: readonly THREE.Vector3[], yaw: number, pitch: number, maxDistance = this.maxDistance): CameraView {
    const cam = this.scratch.copy(this.camera, false);
    const i = this.insets;
    // Room for the points' on-screen box, in normalised device coordinates (the aim point is its centre).
    const roomW = ((2 * (this.width - i.left - i.right)) / this.width) * (1 - FIT_PAD * 2);
    const roomH = ((2 * (this.height - i.top - i.bottom)) / this.height) * (1 - FIT_PAD * 2);
    const target = new THREE.Vector3();
    for (const p of points) target.add(p);
    target.divideScalar(Math.max(1, points.length));
    const p = new THREE.Vector3();
    // Re-aims at `distance` until the box is centred across and sits on the bottom of the room (or is centred,
    // when taller than it); returns how many times too big the box is — at most 1 means it fits.
    const place = (distance: number): number => {
      for (let n = 0; ; n++) {
        this.poseCamera(cam, target, yaw, pitch, distance);
        let x0 = Infinity;
        let x1 = -Infinity;
        let y0 = Infinity;
        let y1 = -Infinity;
        for (const q of points) {
          p.copy(q).project(cam);
          x0 = Math.min(x0, p.x);
          x1 = Math.max(x1, p.x);
          y0 = Math.min(y0, p.y);
          y1 = Math.max(y1, p.y);
        }
        const lift = Math.max(0, roomH - (y1 - y0)) / 2;
        const aim = n < 8 && this.planeHitNdc(cam, (x0 + x1) / 2, (y0 + y1) / 2 + lift, target.y);
        if (!aim) return Math.max((x1 - x0) / roomW, (y1 - y0) / roomH);
        target.copy(aim);
        this.clampTarget(target, yaw, pitch, distance);
        if (this.terrain) target.y = this.terrain.height(target.x, target.z);
      }
    };
    // The nearest distance that still fits (moving the aim point rescales the box, so search rather than solve).
    let far = this.clampDistance(maxDistance);
    if (place(far) <= 1) {
      let near = MIN_DISTANCE;
      for (let n = 0; n < 14; n++) {
        const mid = (near + far) / 2;
        if (place(mid) <= 1) far = mid;
        else near = mid;
      }
      place(far);
    }
    return { target, yaw, pitch, distance: far };
  }

  /** Zoom by `factor` keeping the ground under the cursor fixed on screen. */
  zoomAt(clientX: number, clientY: number, factor: number): void {
    const anchor = this.groundUnder(clientX, clientY)?.clone();
    const before = this.goal.distance;
    this.goal.distance = this.clampDistance(before * factor);
    if (this.goal.distance === before) return;
    // Neo vào khoảng trống ngoài map thì chỉ zoom tại chỗ, không kéo tâm theo.
    if (!anchor || !this.insideMap(anchor.x, anchor.z)) {
      this.clampTargets();
      return;
    }
    this.scratch.copy(this.camera, false);
    this.poseCamera(this.scratch, this.goal.target, this.goal.yaw, this.goalPitch(), this.goal.distance);
    const after = this.planeHit(this.scratch, clientX, clientY, anchor.y);
    if (!after) {
      this.clampTargets();
      return;
    }
    this.goal.target.x += anchor.x - after.x;
    this.goal.target.z += anchor.z - after.z;
    this.clampTargets();
  }

  update(dt: number): void {
    if (this.enabled) {
      const k = this.keys;
      const speed = this.goal.distance * 0.9 * dt * (k.has('shift') ? 2.5 : 1);
      if (MOVE_KEYS.some((key) => k.has(key))) {
        this.spin = 0;
        this.onInput?.({ kind: 'key' });
      }
      if (k.has('w') || k.has('arrowup')) this.pan(0, -speed);
      if (k.has('s') || k.has('arrowdown')) this.pan(0, speed);
      if (k.has('a') || k.has('arrowleft')) this.pan(-speed, 0);
      if (k.has('d') || k.has('arrowright')) this.pan(speed, 0);
      if (k.has('q')) this.goal.yaw += dt * 1.4;
      if (k.has('e')) this.goal.yaw -= dt * 1.4;
    }
    this.goal.yaw += this.spin * dt;
    if (this.lockYaw !== null) this.goal.yaw = this.yaw + angleDiff(this.lockYaw, this.yaw);
    this.clampTargets();
    if (this.terrain) this.goal.target.y = this.terrain.height(this.goal.target.x, this.goal.target.z);
    // Rotation settles fast (direct feel); zoom/moves glide a little longer.
    const kr = 1 - Math.exp(-dt * 14);
    const km = 1 - Math.exp(-dt * 9);
    this.yaw += (this.goal.yaw - this.yaw) * kr;
    this.pitch += (this.goalPitch() - this.pitch) * kr;
    this.distance += (this.goal.distance - this.distance) * km;
    this.target.lerp(this.goal.target, km);
    this.applyPose();
  }

  dispose(): void {
    for (const c of this.cleanup) c();
  }

  // ------------------------------------------------------------------ internals

  private goalPitch(): number {
    // Khi director cầm (battle) không cho góc tụt xuống quá thấp dù còn dư tilt cũ của user.
    const lo = this.autoPitch !== null ? 0.45 : MIN_PITCH;
    return THREE.MathUtils.clamp(this.pitchBase() + this.tilt, lo, MAX_PITCH);
  }

  /** Pitch before the user's own tilt: the director's, else the one that follows the zoom. */
  private pitchBase(): number {
    return this.autoPitch ?? basePitch(this.goal.distance);
  }

  /** Spread, twist and midpoint of the two live touch points. */
  private gesture(): Gesture | null {
    const [a, b] = [...this.touches.values()];
    if (!a || !b) return null;
    return { dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), angle: Math.atan2(b.y - a.y, b.x - a.x), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  /** Two fingers: spread zooms, twist orbits, and the midpoint drags the map. */
  private pinchMove(): void {
    const from = this.pinch;
    const to = this.gesture();
    if (!from || !to) return;
    this.pinch = to;
    this.spin = 0;
    const factor = from.dist / to.dist;
    if (factor !== 1 && !this.onInput?.({ kind: 'zoom', factor })) this.zoomAt(to.x, to.y, factor);
    // Twist past a small deadzone rotates; a plain pinch must not spin the view.
    let twist = to.angle - from.angle;
    if (twist > Math.PI) twist -= Math.PI * 2;
    if (twist < -Math.PI) twist += Math.PI * 2;
    if (Math.abs(twist) > 0.01) {
      this.goal.yaw -= twist;
      this.onInput?.({ kind: 'orbit' });
    }
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (dx || dy) {
      this.onInput?.({ kind: 'pan' });
      this.dragPan(to.x, to.y, dx, dy, null);
    }
  }

  private clampDistance(d: number): number {
    return THREE.MathUtils.clamp(d, MIN_DISTANCE, this.maxDistance);
  }

  private insideMap(x: number, z: number): boolean {
    if (!this.terrain) return false;
    const half = this.terrain.half;
    return Math.abs(x) <= half && Math.abs(z) <= half;
  }

  /** Projection whose principal point is the centre of the uncovered area: the aim point shows there. */
  private updateProjection(): void {
    const cam = this.camera;
    const i = this.insets;
    cam.aspect = this.width / this.height;
    cam.updateProjectionMatrix();
    const e = cam.projectionMatrix.elements;
    e[8] = (i.right - i.left) / this.width;
    e[9] = (i.top - i.bottom) / this.height;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    const perPx = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) / (this.height / 2);
    this.halfU = (Math.max(1, this.width - i.left - i.right) * perPx) / 2;
    this.halfV = (Math.max(1, this.height - i.top - i.bottom) * perPx) / 2;
  }

  /** Keeps the view the camera is heading for on the map (see clampTarget). */
  private clampTargets(): void {
    this.clampTarget(this.goal.target, this.goal.yaw, this.goalPitch(), this.goal.distance);
  }

  /**
   * Keeps what the uncovered area shows on the map: the ground under the middle of its bottom, left and right
   * edges, and FAR_REACH × distance ahead of the aim point, stay on the map (a diagonal view's sides may reach past
   * its edge, see SIDE_SLACK). Along an axis where that span is wider than the map, the view is
   * centred on the map instead — zoomed far out the map sits in the middle of the uncovered area rather than
   * sliding off it.
   */
  private clampTarget(t: THREE.Vector3, yaw: number, pitch: number, distance: number): void {
    if (!this.terrain) return;
    const u = this.halfU;
    const v = this.halfV;
    const sp = Math.sin(pitch);
    const cp = Math.cos(pitch);
    // Ground distances from the aim point: to the side edges, back to the bottom edge, and ahead.
    const side = distance * u;
    const near = (distance * v) / (sp + v * cp);
    const down = sp - v * cp;
    const far = distance * Math.min(FAR_REACH, down > 1e-3 ? v / down : FAR_REACH);
    // Ground direction from the camera toward the aim point.
    const fx = -Math.cos(yaw);
    const fz = -Math.sin(yaw);
    const lim = this.terrain.half;
    const slack = SIDE_SLACK * Math.abs(Math.sin(2 * yaw));
    const sx = side * Math.max(0, Math.abs(fz) - slack);
    const sz = side * Math.max(0, Math.abs(fx) - slack);
    t.x = clampSpan(t.x, Math.min(far * fx, -near * fx, -sx), Math.max(far * fx, -near * fx, sx), lim);
    t.z = clampSpan(t.z, Math.min(far * fz, -near * fz, -sz), Math.max(far * fz, -near * fz, sz), lim);
  }

  /** Keyboard pan in camera-relative ground axes (smoothed). */
  private pan(right: number, forward: number): void {
    const fx = -Math.cos(this.goal.yaw);
    const fz = -Math.sin(this.goal.yaw);
    this.goal.target.x += -fz * right + fx * -forward;
    this.goal.target.z += fx * right + fz * -forward;
  }

  /** Grab-pan: move so the grabbed ground point is back under the cursor, immediately. */
  private dragPan(clientX: number, clientY: number, dx: number, dy: number, grab: THREE.Vector3 | null): void {
    let mx: number;
    let mz: number;
    // Điểm grab ngoài map (mặt phẳng vô hạn / bầu trời) thì không dùng để neo,
    // rớt về pan theo tỉ lệ màn hình để khỏi lôi tâm camera ra khỏi map.
    const usableGrab = grab && this.insideMap(grab.x, grab.z) ? grab : null;
    const q = usableGrab && this.planeHit(this.camera, clientX, clientY, usableGrab.y);
    if (usableGrab && q) {
      mx = usableGrab.x - q.x;
      mz = usableGrab.z - q.z;
      // Near the horizon a pixel spans many metres; cap the step.
      const len = Math.hypot(mx, mz);
      const cap = this.distance * 0.5;
      if (len > cap) {
        mx *= cap / len;
        mz *= cap / len;
      }
    } else {
      // Grabbed the sky: fall back to a screen-proportional pan.
      const right = -dx * this.distance * 0.0016;
      const forward = -dy * this.distance * 0.0016;
      const fx = -Math.cos(this.yaw);
      const fz = -Math.sin(this.yaw);
      mx = -fz * right - fx * forward;
      mz = fx * right - fz * forward;
    }
    this.target.x += mx;
    this.target.z += mz;
    this.goal.target.x += mx;
    this.goal.target.z += mz;
    this.clampTargets();
    this.clampTarget(this.target, this.yaw, this.pitch, this.distance);
    this.applyPose();
  }

  private groundUnder(clientX: number, clientY: number): THREE.Vector3 | null {
    return this.pick?.(clientX, clientY) ?? this.planeHit(this.camera, clientX, clientY, this.target.y);
  }

  /** Cursor ray from `cam` against the horizontal plane at height `y`. */
  private planeHit(cam: THREE.PerspectiveCamera, clientX: number, clientY: number, y: number): THREE.Vector3 | null {
    const rect = this.dom.getBoundingClientRect();
    return this.planeHitNdc(cam, ((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1, y);
  }

  /** Ray from `cam` through a point in normalised device coordinates against the horizontal plane at height `y`. */
  private planeHitNdc(cam: THREE.PerspectiveCamera, ndcX: number, ndcY: number, y: number): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.ndc.set(ndcX, ndcY), cam);
    const { origin, direction } = this.raycaster.ray;
    if (direction.y > -1e-3) return null;
    return this.hit.copy(origin).addScaledVector(direction, (y - origin.y) / direction.y);
  }

  private applyPose(): void {
    this.poseCamera(this.camera, this.target, this.yaw, this.pitch, this.distance);
  }

  private poseCamera(cam: THREE.PerspectiveCamera, target: THREE.Vector3, yaw: number, pitch: number, distance: number): void {
    const cp = Math.cos(pitch);
    const pos = cam.position.set(target.x + Math.cos(yaw) * cp * distance, target.y + Math.sin(pitch) * distance, target.z + Math.sin(yaw) * cp * distance);
    if (this.terrain) pos.y = Math.max(pos.y, this.terrain.height(pos.x, pos.z) + CLEARANCE);
    cam.lookAt(target);
    cam.updateMatrixWorld();
  }
}

/** `t` clamped so the span [t + lo, t + hi] stays within ±lim; a span wider than that is centred on 0 instead. */
function clampSpan(t: number, lo: number, hi: number, lim: number): number {
  const min = -lim - lo;
  const max = lim - hi;
  return min <= max ? THREE.MathUtils.clamp(t, min, max) : (min + max) / 2;
}
