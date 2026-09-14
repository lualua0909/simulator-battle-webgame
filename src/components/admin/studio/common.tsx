'use client';

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
