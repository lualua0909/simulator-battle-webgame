'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Placement } from '../sim/army';
import type { Side } from '../sim/terrain';
import type { AckResult, BattleStart, ClientToServer, RoomState, ServerToClient } from '@/shared/net';

type GameSocket = Socket<ServerToClient, ClientToServer>;

export interface OnlineHandlers {
  onStart(start: BattleStart): void;
  onDesync(tick: number): void;
}

export interface Seat {
  code: string;
  side: Side;
  token: string;
}

const tokenKey = (code: string) => `battle-room-${code}`;

export function useOnline(enabled: boolean, handlers: OnlineHandlers) {
  const [socket, setSocket] = useState<GameSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [seat, setSeat] = useState<Seat | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  /** Seat + name to reclaim after a dropped connection (a reconnect gets a new socket id). */
  const rejoin = useRef<{ seat: Seat; name: string } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const s: GameSocket = io({ path: '/socket.io', transports: ['websocket'] });
    s.on('connect', () => {
      setConnected(true);
      const r = rejoin.current;
      if (!r) return;
      s.emit('room:join', { code: r.seat.code, name: r.name, token: r.seat.token }, (res) => {
        if (res.ok) return;
        rejoin.current = null;
        setSeat(null);
        setRoom(null);
      });
    });
    s.on('disconnect', () => setConnected(false));
    s.on('room:state', setRoom);
    s.on('battle:start', (start) => handlersRef.current.onStart(start));
    s.on('battle:desync', ({ tick }) => handlersRef.current.onDesync(tick));
    setSocket(s);
    return () => {
      rejoin.current = null;
      s.emit('room:leave');
      s.disconnect();
      setSocket(null);
    };
  }, [enabled]);

  const remember = (res: AckResult<Seat>, name: string): AckResult<Seat> => {
    if (res.ok) {
      const seat = { code: res.code, side: res.side, token: res.token };
      rejoin.current = { seat, name };
      setSeat(seat);
      try {
        sessionStorage.setItem(tokenKey(res.code), res.token);
      } catch {
        /* storage unavailable */
      }
    }
    return res;
  };

  const create = useCallback(
    (name: string) => new Promise<AckResult<Seat>>((resolve) => (socket ? socket.emit('room:create', { name }, (r) => resolve(remember(r, name))) : resolve({ ok: false, error: 'Chưa kết nối' }))),
    [socket],
  );

  const join = useCallback(
    (code: string, name: string) =>
      new Promise<AckResult<Seat>>((resolve) => {
        if (!socket) return resolve({ ok: false, error: 'Chưa kết nối' });
        let token: string | undefined;
        try {
          token = sessionStorage.getItem(tokenKey(code.toUpperCase())) ?? undefined;
        } catch {
          token = undefined;
        }
        socket.emit('room:join', { code, name, token }, (r) => resolve(remember(r, name)));
      }),
    [socket],
  );

  const ready = useCallback(
    (army: Placement[]) => new Promise<AckResult>((resolve) => (socket ? socket.emit('room:ready', { army }, resolve) : resolve({ ok: false, error: 'Chưa kết nối' }))),
    [socket],
  );

  return {
    connected,
    room,
    seat,
    create,
    join,
    ready,
    unready: () => socket?.emit('room:unready'),
    settings: (mapId: string, budget: number) => socket?.emit('room:settings', { mapId, budget }),
    checksum: (tick: number, hash: number) => socket?.emit('battle:checksum', { tick, hash }),
    end: (winner: Side | 'draw') => socket?.emit('battle:end', { winner }),
  };
}
