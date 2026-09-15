'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ConfigBundle } from '@/shared/schema';
import { preloadCustomGlbs } from '@/game/models/glbStatic';

export function useConfig() {
  const [bundle, setBundle] = useState<ConfigBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = (await res.json()) as ConfigBundle;
      await preloadCustomGlbs(next.assets);
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
