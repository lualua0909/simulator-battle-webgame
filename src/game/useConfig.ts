'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ConfigBundle } from '@/shared/schema';

export function useConfig() {
  const [bundle, setBundle] = useState<ConfigBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setBundle((await res.json()) as ConfigBundle);
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
