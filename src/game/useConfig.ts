'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ConfigBundle } from '@/shared/schema';
import { SKINNED_GLB_KINDS } from '@/shared/schema';
import { preloadCustomGlbs } from '@/game/models/glbStatic';
import { preloadSkinnedGlbs } from '@/game/models/glbSkinned';

export function useConfig() {
  const [bundle, setBundle] = useState<ConfigBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = (await res.json()) as ConfigBundle;
      await preloadCustomGlbs(next.assets);
      await preloadSkinnedGlbs(next.assets.filter((a) => (SKINNED_GLB_KINDS as readonly string[]).includes(a.kind)).map((a) => (a.glb ? { url: a.glb.url, tint: a.glb.tint, hide: a.glb.hide } : null)));
      setBundle(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { bundle, error, reload };
}
