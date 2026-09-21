// Rendering quality tiers. Phones start one tier down; any device drops a tier (never climbs
// back within the session) when its frame rate stays low, shedding pixels, shadows, flash
// lights and ragdoll/corpse budgets in that order.
export type QualityTier = 'high' | 'medium' | 'low';

export interface QualityPreset {
  /** Cap on the device pixel ratio. */
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  /** The shadow map is redrawn every n-th frame. */
  shadowEvery: number;
  /** Point lights for strike/gunfire flashes: every lit pixel pays for each one, even when dark. */
  flashLights: number;
  /** Caps on the CMS ragdoll and corpse budgets. */
  ragdollCap: number;
  corpseCap: number;
}

export const QUALITY: Record<QualityTier, QualityPreset> = {
  high: { pixelRatio: 1.75, shadows: true, shadowMapSize: 2048, shadowEvery: 1, flashLights: 4, ragdollCap: Infinity, corpseCap: Infinity },
  medium: { pixelRatio: 1.25, shadows: true, shadowMapSize: 1024, shadowEvery: 2, flashLights: 1, ragdollCap: 30, corpseCap: 300 },
  low: { pixelRatio: 1, shadows: false, shadowMapSize: 1024, shadowEvery: 1, flashLights: 0, ragdollCap: 12, corpseCap: 150 },
};

export const LOWER_TIER: Record<QualityTier, QualityTier | null> = { high: 'medium', medium: 'low', low: null };

/** Seconds ignored after a map load, battle start or tier change (shader compiles, asset loads). */
const GRACE = 3;
/** Sampling window (s); two slow windows in a row trigger a drop. */
const WINDOW = 2;
const MIN_FPS = 40;

/** Watches the frame rate and says when to drop a tier. */
export class FrameRateGovernor {
  private frames = 0;
  private elapsed = 0;
  private slow = 0;
  private grace = GRACE;

  /** Feed one frame's duration; true = drop a tier now. */
  sample(dt: number): boolean {
    if (this.grace > 0) {
      this.grace -= dt;
      return false;
    }
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed < WINDOW) return false;
    const fps = this.frames / this.elapsed;
    this.frames = 0;
    this.elapsed = 0;
    this.slow = fps < MIN_FPS ? this.slow + 1 : 0;
    if (this.slow < 2) return false;
    this.hold();
    return true;
  }

  /** Stalls ahead (loading, a tier switch recompiling shaders): don't judge them. */
  hold(): void {
    this.grace = GRACE;
    this.frames = 0;
    this.elapsed = 0;
    this.slow = 0;
  }
}
