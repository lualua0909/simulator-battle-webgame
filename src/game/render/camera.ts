// RTS camera tuned for mouse and trackpad:
//   wheel / pinch                 zoom toward the cursor, proportional to the scroll amount
//   right-drag                    orbit (yaw) + tilt around the screen centre
//   middle-drag, Shift+right-drag grab-pan: the ground point under the cursor sticks to it
//   left-drag when `leftPan`      grab-pan too (whenever the left button is not placing units)
//   WASD / arrows pan, Q/E rotate.
// Tilt follows zoom (close = low and cinematic, far = top-down) plus the user's own tilt offset.
import * as THREE from 'three';
import type { Terrain } from '../sim/terrain';

const MIN_DISTANCE = 14;
const MIN_PITCH = 0.12;
const MAX_PITCH = 1.45;
const CLEARANCE = 1.5;
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
  private panWithLeft = false;
  private tilt = 0;
  private readonly goal = { yaw: this.yaw, distance: this.distance, target: new THREE.Vector3() };
  private keys = new Set<string>();
  private drag: Drag | null = null;
  private terrain: Terrain | null = null;
  private maxDistance = 220;
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
      const pan = e.button === 1 || (e.button === 2 && e.shiftKey) || (e.button === 0 && this.panWithLeft);
      if (!pan && e.button !== 2) return;
      this.spin = 0;
      this.onInput?.({ kind: pan ? 'pan' : 'orbit' });
      this.drag = { mode: pan ? 'pan' : 'orbit', x: e.clientX, y: e.clientY, grab: pan ? this.groundUnder(e.clientX, e.clientY)?.clone() ?? null : null };
      dom.style.cursor = 'grabbing';
    });
    on(window, 'pointermove', (e) => {
      const d = this.drag;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      d.x = e.clientX;
      d.y = e.clientY;
      if (d.mode === 'orbit') {
        this.goal.yaw -= dx * 0.0065;
        const pitch = THREE.MathUtils.clamp(this.goalPitch() + dy * 0.005, MIN_PITCH, MAX_PITCH);
        this.tilt = pitch - basePitch(this.goal.distance);
      } else this.dragPan(e.clientX, e.clientY, dx, dy, d.grab);
      this.onInput?.({ kind: d.mode });
    });
    on(window, 'pointerup', () => {
      if (!this.drag) return;
      this.drag = null;
      dom.style.cursor = this.panWithLeft ? 'grab' : '';
    });
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

  setTerrain(terrain: Terrain): void {
    this.terrain = terrain;
    // Zoomed all the way out the map just fills the frame — no further.
    this.maxDistance = Math.max(70, terrain.size * 1.05);
    this.goal.target.set(0, 0, 0);
    this.setView(Math.PI, 0.8, terrain.size * 0.55);
  }

  focus(x: number, z: number, distance?: number): void {
    this.goal.target.set(x, 0, z);
    if (distance) this.goal.distance = this.clampDistance(distance);
  }

  /** Zoom to a distance without touching the aim point (the auto-director's zoom). */
  setDistance(distance: number): void {
    this.goal.distance = this.clampDistance(distance);
  }

  setView(yaw: number, pitch: number, distance: number): void {
    this.goal.yaw = yaw;
    this.goal.distance = this.clampDistance(distance);
    this.tilt = pitch - basePitch(this.goal.distance);
  }

  /** Snap to a view with no smoothing (a cinematic handing the camera back). */
  jumpTo(view: CameraView): void {
    this.goal.target.copy(view.target);
    this.target.copy(view.target);
    this.goal.yaw = this.yaw = view.yaw;
    this.goal.distance = this.distance = this.clampDistance(view.distance);
    this.tilt = view.pitch - basePitch(this.distance);
    this.pitch = this.goalPitch();
    this.applyPose();
  }

  /** Where the live camera would sit for a view (same terrain clearance). */
  positionFor(view: CameraView, out: THREE.Vector3): THREE.Vector3 {
    this.poseCamera(this.scratch, view.target, view.yaw, view.pitch, view.distance);
    return out.copy(this.scratch.position);
  }

  /** Zoom by `factor` keeping the ground under the cursor fixed on screen. */
  zoomAt(clientX: number, clientY: number, factor: number): void {
    const anchor = this.groundUnder(clientX, clientY)?.clone();
    const before = this.goal.distance;
    this.goal.distance = this.clampDistance(before * factor);
    if (!anchor || this.goal.distance === before) return;
    this.scratch.copy(this.camera, false);
    this.poseCamera(this.scratch, this.goal.target, this.goal.yaw, this.goalPitch(), this.goal.distance);
    const after = this.planeHit(this.scratch, clientX, clientY, anchor.y);
    if (!after) return;
    this.goal.target.x += anchor.x - after.x;
    this.goal.target.z += anchor.z - after.z;
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
    return THREE.MathUtils.clamp(basePitch(this.goal.distance) + this.tilt, MIN_PITCH, MAX_PITCH);
  }

  private clampDistance(d: number): number {
    return THREE.MathUtils.clamp(d, MIN_DISTANCE, this.maxDistance);
  }

  private clampTargets(): void {
    if (!this.terrain) return;
    const lim = this.terrain.half;
    for (const t of [this.goal.target, this.target]) {
      t.x = THREE.MathUtils.clamp(t.x, -lim, lim);
      t.z = THREE.MathUtils.clamp(t.z, -lim, lim);
    }
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
    const q = grab && this.planeHit(this.camera, clientX, clientY, grab.y);
    if (grab && q) {
      mx = grab.x - q.x;
      mz = grab.z - q.z;
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
    this.applyPose();
  }

  private groundUnder(clientX: number, clientY: number): THREE.Vector3 | null {
    return this.pick?.(clientX, clientY) ?? this.planeHit(this.camera, clientX, clientY, this.target.y);
  }

  /** Cursor ray from `cam` against the horizontal plane at height `y`. */
  private planeHit(cam: THREE.PerspectiveCamera, clientX: number, clientY: number, y: number): THREE.Vector3 | null {
    const rect = this.dom.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, cam);
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
