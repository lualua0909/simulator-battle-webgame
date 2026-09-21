// Quest (WebXR) controls. The headset camera and both controllers live in `rig`: moving, turning or
// scaling the rig moves the player through the battle, while their own head stays free to look around.
//   trigger              pick the soldier the ray points at and follow it
//   A / X                next view (sandbox table → third → first → second person)
//   B / Y                next soldier of the own army
//   grip                 back to the sandbox table
//   thumbstick ←/→       snap turn 30°
//   thumbstick ↑/↓       table mode: grow / shrink the table
import * as THREE from 'three';

export interface XrActions {
  /** Trigger pulled: world-space ray of the controller. */
  select(origin: THREE.Vector3, direction: THREE.Vector3): void;
  cycleView(): void;
  nextUnit(): void;
  overview(): void;
  turn(radians: number): void;
  /** Continuous table zoom: > 0 grows the table (player shrinks). */
  zoom(amount: number): void;
}

const SNAP_TURN = Math.PI / 6;

export class XrControls {
  readonly rig = new THREE.Group();
  /** Buttons held last frame per hand, for press edges. */
  private readonly held = new Map<string, boolean[]>();
  private readonly stickCentered = new Map<string, boolean>();
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly actions: XrActions,
  ) {
    const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    const rayMat = new THREE.LineBasicMaterial({ color: '#ffe27a', transparent: true, opacity: 0.8 });
    for (let i = 0; i < 2; i++) {
      const c = renderer.xr.getController(i);
      const ray = new THREE.Line(rayGeo, rayMat);
      ray.scale.z = 4;
      ray.frustumCulled = false;
      c.add(ray);
      c.addEventListener('select', () => {
        c.updateMatrixWorld(true);
        this.origin.setFromMatrixPosition(c.matrixWorld);
        this.direction.set(0, 0, -1).transformDirection(c.matrixWorld);
        this.actions.select(this.origin, this.direction);
      });
      c.addEventListener('squeeze', () => this.actions.overview());
      this.rig.add(c);
    }
  }

  /** Polls face buttons and thumbsticks (xr-standard mapping: 4 = A/X, 5 = B/Y, axes 2/3 = stick). */
  update(dt: number): void {
    const session = this.renderer.xr.getSession();
    if (!session) return;
    for (const src of session.inputSources) {
      const pad = src.gamepad;
      if (!pad) continue;
      const hand = src.handedness;
      const before = this.held.get(hand) ?? [];
      const now = pad.buttons.map((b) => b.pressed);
      if (now[4] && !before[4]) this.actions.cycleView();
      if (now[5] && !before[5]) this.actions.nextUnit();
      this.held.set(hand, now);
      const sx = pad.axes[2] ?? 0;
      const sy = pad.axes[3] ?? 0;
      // Snap turn fires once per push; the stick must come back to the centre before the next.
      const centered = this.stickCentered.get(hand) ?? true;
      if (centered && Math.abs(sx) > 0.7) {
        this.actions.turn(sx > 0 ? -SNAP_TURN : SNAP_TURN);
        this.stickCentered.set(hand, false);
      } else if (!centered && Math.abs(sx) < 0.3) this.stickCentered.set(hand, true);
      if (Math.abs(sy) > 0.2 && Math.abs(sy) > Math.abs(sx)) this.actions.zoom(-sy * dt);
    }
  }

  /** Back to the plain desktop camera: the rig must be identity outside VR. */
  reset(): void {
    this.rig.position.set(0, 0, 0);
    this.rig.rotation.set(0, 0, 0);
    this.rig.scale.setScalar(1);
    this.rig.updateMatrixWorld(true);
    this.held.clear();
    this.stickCentered.clear();
  }
}
