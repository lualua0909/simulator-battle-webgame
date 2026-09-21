'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Placement } from '../sim/army';
import type { Side } from '../sim/terrain';
import { UNAUTHORIZED, type AckResult, type BattleOutcome, type BattleStart, type ClientToServer, type RankMatched, type RoomSettings, type RoomState, type ServerToClient } from '@/shared/net';
import type { RankResult } from '@/shared/ranked';

type GameSocket = Socket<ServerToClient, ClientToServer>;

export interface OnlineHandlers {
  onStart(start: BattleStart): void;
  onDesync(tick: number): void;
  onResult(res: AckResult<{ winner: Side | 'draw' }>): void;
  onEliminate(side: Side, tick: number): void;
  /** Ranked: matchmaking seated you in a room (the seat is already set). */
  onMatched?(match: RankMatched): void;
  onRankCancelled?(reason: string): void;
  onRankResult?(res: AckResult<RankResult>): void;
}

export interface Seat {
  code: string;
  side: Side;
}

/** Connects only for a signed-in user (`uid`); the server reads the session cookie on the handshake. */
export function useOnline(uid: string | null, handlers: OnlineHandlers) {
  const [socket, setSocket] = useState<GameSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [seat, setSeat] = useState<Seat | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  /** Room to reclaim after a dropped connection (the seat belongs to this account). */
  const rejoin = useRef<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    const s: GameSocket = io({ path: '/socket.io', transports: ['websocket'] });
    s.on('connect', () => {
      setConnected(true);
      setError(null);
      const code = rejoin.current;
      if (!code) return;
      s.emit('room:join', { code }, (res) => {
        if (res.ok) return;
        rejoin.current = null;
        setSeat(null);
        setRoom(null);
      });
    });
    s.on('connect_error', (e) => setError(e.message === UNAUTHORIZED ? 'Phiên đăng nhập không hợp lệ — hãy đăng nhập lại' : `Không kết nối được máy chủ: ${e.message}`));
    s.on('disconnect', (reason) => {
      setConnected(false);
      // The server only drops a socket itself when the account connected elsewhere, was disabled, or flooded events.
      if (reason === 'io server disconnect') setError('Máy chủ đã ngắt kết nối (tài khoản đang chơi online ở tab khác hoặc bị khóa)');
    });
    s.on('room:state', setRoom);
    s.on('battle:start', (start) => handlersRef.current.onStart(start));
    s.on('battle:desync', ({ tick }) => handlersRef.current.onDesync(tick));
    s.on('battle:eliminate', ({ side, tick }) => handlersRef.current.onEliminate(side, tick));
    s.on('battle:result', (res) => handlersRef.current.onResult(res));
    s.on('rank:matched', (m) => {
      rejoin.current = m.code;
      setSeat({ code: m.code, side: m.side });
      handlersRef.current.onMatched?.(m);
    });
    s.on('rank:cancelled', ({ reason }) => handlersRef.current.onRankCancelled?.(reason));
    s.on('rank:result', (res) => handlersRef.current.onRankResult?.(res));
    setSocket(s);
    return () => {
      rejoin.current = null;
      s.emit('room:leave');
      s.disconnect();
      setSocket(null);
      setConnected(false);
      setSeat(null);
      setRoom(null);
    };
  }, [uid]);

  const remember = (res: AckResult<Seat>): AckResult<Seat> => {
    if (res.ok) {
      rejoin.current = res.code;
      setSeat({ code: res.code, side: res.side });
    }
    return res;
  };

  const create = useCallback(
    () => new Promise<AckResult<Seat>>((resolve) => (socket ? socket.emit('room:create', (r) => resolve(remember(r))) : resolve({ ok: false, error: 'Chưa kết nối' }))),
    [socket],
  );

  const join = useCallback(
    (code: string) => new Promise<AckResult<Seat>>((resolve) => (socket ? socket.emit('room:join', { code }, (r) => resolve(remember(r))) : resolve({ ok: false, error: 'Chưa kết nối' }))),
    [socket],
  );

  const ready = useCallback(
    (army: Placement[]) => new Promise<AckResult>((resolve) => (socket ? socket.emit('room:ready', { army }, resolve) : resolve({ ok: false, error: 'Chưa kết nối' }))),
    [socket],
  );

  const queue = useCallback(
    () => new Promise<AckResult>((resolve) => (socket ? socket.emit('rank:queue', resolve) : resolve({ ok: false, error: 'Chưa kết nối' }))),
    [socket],
  );

  /** Leaves the current room (ranked: back to the queue screen after the one battle). */
  const leave = useCallback(() => {
    socket?.emit('room:leave');
    rejoin.current = null;
    setSeat(null);
    setRoom(null);
  }, [socket]);

  return {
    connected,
    error,
    room,
    seat,
    create,
    join,
    ready,
    queue,
    cancelQueue: () => socket?.emit('rank:cancel'),
    leave,
    unready: () => socket?.emit('room:unready'),
    /** Live army edits while still deploying, so a 30s timeout can force-start with the latest draft. */
    draft: (army: Placement[]) => socket?.emit('room:draft', { army }),
    settings: (next: RoomSettings) => socket?.emit('room:settings', next),
    checksum: (tick: number, hash: number) => socket?.emit('battle:checksum', { tick, hash }),
    end: (outcome: BattleOutcome, tick: number) => socket?.emit('battle:end', { outcome, tick }),
    surrender: () => socket?.emit('battle:surrender'),
  };
}
