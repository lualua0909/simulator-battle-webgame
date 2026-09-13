// img2threejs studio: job/version records and the JSON Claude returns at each pipeline step.
import { z } from 'zod';
import type { GateReport } from '@/game/sculpt/gates';
import type { SculptKind } from '@/game/sculpt/rigs';
import { sculptSpecSchema, type SculptSpec } from './sculpt';

export const assessmentSchema = z.object({
  subject: z.string(),
  suitability: z.enum(['good', 'partial', 'poor']),
  silhouette: z.string(),
  components: z.array(z.string()),
  palette: z.array(z.object({ name: z.string(), color: z.string() })),
  identityFeatures: z.array(z.string()),
  hiddenOrUncertain: z.array(z.string()),
  summary: z.string(),
});

export const reviewSchema = z.object({
  fidelity: z.number().min(0).max(1),
  features: z.array(z.object({ name: z.string(), score: z.number().min(0).max(1), critical: z.boolean(), note: z.string() })),
  mismatches: z.array(z.string()),
  decision: z.enum(['continue', 'refine']),
  summary: z.string(),
});

/** What Claude is asked to return (JSON schema source). */
export const specReplySchema = z.object({ assessment: assessmentSchema, spec: sculptSpecSchema });
export const reviewReplySchema = z.object({ review: reviewSchema, spec: sculptSpecSchema.nullable() });
export const repairReplySchema = z.object({ spec: sculptSpecSchema, notes: z.string() });

export type Assessment = z.infer<typeof assessmentSchema>;
export type Review = z.infer<typeof reviewSchema> & {
  /** Decision after the studio's own thresholds (may overrule Claude's). */
  outcome: 'continue' | 'refine' | 'stalled';
  round: number;
};

export type EngineName = 'api' | 'cli';

export interface EngineStatus {
  api: boolean;
  cli: boolean;
  active: EngineName | null;
  model: string;
}

export interface StudioUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Reported by the Claude Code CLI only. */
  costUsd: number;
}

export type VersionSource = 'spec' | 'repair' | 'review' | 'feedback';

export interface StudioVersion {
  n: number;
  source: VersionSource;
  spec: SculptSpec;
  gates: GateReport;
  assessment: Assessment | null;
  review: Review | null;
  feedback: string | null;
  notes: string | null;
  /** Render sheet (PNG data URL) that the review of this version looked at. */
  sheet: string | null;
  createdAt: number;
}

export interface StudioJob {
  id: string;
  name: string;
  kind: SculptKind;
  baseAssetId: string | null;
  prompt: string;
  maxRounds: number;
  hasImage: boolean;
  status: 'idle' | 'running' | 'error';
  step: string | null;
  error: string | null;
  engine: EngineName | null;
  usage: StudioUsage;
  latest: { n: number; verdict: GateReport['verdict']; fidelity: number | null } | null;
  createdAt: number;
  updatedAt: number;
}

export interface StudioJobDetail extends StudioJob {
  image: string | null;
  versions: StudioVersion[];
}

export type StudioEvent =
  | { t: 'status'; text: string }
  | { t: 'progress'; phase: 'thinking' | 'writing'; chars: number }
  | { t: 'version'; n: number }
  | { t: 'ping' }
  | { t: 'done'; job: StudioJobDetail }
  | { t: 'error'; error: string };

export const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;
