'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ConfigBundle } from '@/shared/schema';
import { ENV_ASSET_KINDS, SKINNED_GLB_KINDS } from '@/shared/schema';
import { preloadCustomGlbs } from '@/game/models/glbStatic';
import { preloadSkinnedGlbs } from '@/game/models/glbSkinned';
import { preloadBarracksGlbs, BARRACKS_GLB_URL } from '@/game/models/barracksGlb';
import { isCompactDevice } from '@/game/render/quality';
import { preloadGrass } from '@/game/render/scenery';

export interface ConfigOptions {
  /** Hand the bundle out at once and load the GLBs afterwards, when the page is idle (home page warm-up). */
  background?: boolean;
  /** The bundle renders battles: phones/tablets hide map scenery there, so its GLBs are skipped. */
  battle?: boolean;
}

/** Loads every GLB the renderer clones synchronously (units, structures, barracks, scenery) into the module caches. */
async function preloadGlbs(next: ConfigBundle, scenery: boolean): Promise<void> {
  const assets = scenery ? next.assets : next.assets.filter((a) => !(ENV_ASSET_KINDS as readonly string[]).includes(a.kind));
  await preloadCustomGlbs([
    ...assets,
    // Barracks resolves to its fixed file even when the database asset has no upload.
    { glb: { url: BARRACKS_GLB_URL, fileName: 'nha-linh.glb', uploadedAt: 0, tint: {}, hide: [] }, kind: 'structure', params: { type: 'barracks' } },
  ]);
  await preloadSkinnedGlbs(assets.filter((a) => (SKINNED_GLB_KINDS as readonly string[]).includes(a.kind)).map((a) => (a.glb ? { url: a.glb.url, tint: a.glb.tint, hide: a.glb.hide } : null)));
  await preloadBarracksGlbs([BARRACKS_GLB_URL]);
  if (scenery) await preloadGrass();
}

function whenIdle(run: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 3000 });
  else window.setTimeout(run, 1000);
}

/** `enabled: false` skips the fetch and GLB preload entirely — for a caller that already has a bundle from elsewhere. */
export function useConfig(enabled = true, { background = false, battle = false }: ConfigOptions = {}) {
  const [bundle, setBundle] = useState<ConfigBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = (await res.json()) as ConfigBundle;
      const scenery = !(battle && isCompactDevice());
      if (background) whenIdle(() => void preloadGlbs(next, scenery));
      else await preloadGlbs(next, scenery);
      setBundle(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [background, battle]);

  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);

  return { bundle, error, reload };
}
