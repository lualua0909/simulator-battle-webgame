'use client';

import { SCULPT_KINDS, type SculptKind } from '@/game/sculpt/rigs';
import { ENUM_LABELS } from '@/shared/fields';

export const KIND_LABELS = Object.fromEntries(SCULPT_KINDS.map((k) => [k, k === 'prop' ? 'Đạo cụ tự do (chỉ tải về)' : ENUM_LABELS[k]])) as Record<SculptKind, string>;

export interface RunState {
  jobId: string;
  text: string;
  phase: 'thinking' | 'writing' | null;
  chars: number;
  startedAt: number;
}

export type RunPlan = { kind: 'auto' } | { kind: 'review'; version: number; feedback: string | null };

export function VerdictDot({ verdict }: { verdict: 'pass' | 'warn' | 'fail' }) {
  const map = { pass: ['bg-green-600', 'gate đạt'], warn: ['bg-amber-500', 'gate cảnh báo'], fail: ['bg-red-team', 'gate chặn'] } as const;
  return <span className={`mt-1 inline-block h-2 w-2 rounded-full ${map[verdict][0]}`} title={map[verdict][1]} />;
}
