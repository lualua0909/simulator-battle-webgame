'use client';

// The signed-in player's wallet for the game UI. The server owns every number: this only reads
// /api/player and posts actions, then shows whatever state the server sends back.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { BoxReward, BoxStatus, PlayerAction, PlayerState } from '@/shared/economy';
import { useAuth } from '@/components/auth/AuthProvider';

type PlayerCtx = {
  /** null for guests (and while loading). */
  player: PlayerState | null;
  boxes: BoxStatus | null;
  loading: boolean;
  error: string | null;
  /** Current server time in ms: countdowns follow the server clock, not the device clock. */
  now(): number;
  /** Runs an action on the server; throws the server's message when it is refused. */
  act(action: PlayerAction): Promise<{ reward?: BoxReward }>;
  refresh(): Promise<void>;
};

type Response = { player: PlayerState | null; boxes: BoxStatus | null; now: number; reward?: BoxReward; error?: string };

const Ctx = createContext<PlayerCtx | null>(null);

export function usePlayer(): PlayerCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePlayer needs <PlayerProvider>');
  return ctx;
}

/** Re-renders every `ms` so countdowns tick. */
export function useTick(ms = 1000): void {
  const [, set] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => set((n) => n + 1), ms);
    return () => window.clearInterval(t);
  }, [ms]);
}

export default function PlayerProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [boxes, setBoxes] = useState<BoxStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offset = useRef(0);
  const uid = user?.uid ?? null;

  const apply = useCallback((data: Response) => {
    offset.current = data.now - Date.now();
    setPlayer(data.player);
    setBoxes(data.boxes);
  }, []);

  const refresh = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    try {
      const res = await fetch('/api/player', { cache: 'no-store' });
      const data = (await res.json()) as Response;
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      apply(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [uid, apply]);

  useEffect(() => {
    setPlayer(null);
    setBoxes(null);
    void refresh();
  }, [refresh]);

  const act = useCallback(
    async (action: PlayerAction) => {
      const res = await fetch('/api/player', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action), cache: 'no-store' });
      const data = (await res.json().catch(() => ({}))) as Response;
      if (!res.ok) throw new Error(data.error ?? 'Không thực hiện được, thử lại sau');
      apply(data);
      return { reward: data.reward };
    },
    [apply],
  );

  const value = useMemo<PlayerCtx>(() => ({ player: uid ? player : null, boxes: uid ? boxes : null, loading, error, now: () => Date.now() + offset.current, act, refresh }), [uid, player, boxes, loading, error, act, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
