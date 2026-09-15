// img2threejs studio pipeline steps. The browser drives the loop (it renders the review
// sheets); each step here is one server call that streams progress and stores versions.
//   spec   — analyse the reference/brief and author a sculpt spec
//   review — compare a render sheet of a version with the reference, then refine
// Every spec passes zod validation and the deterministic gates before it counts; failures go
// back to Claude as a bounded repair loop.
import { runSculptGates, type GateReport } from '@/game/sculpt/gates';
import { referenceRig } from '@/game/sculpt/rigs';
import { sculptSpecSchema, type SculptSpec } from '@/shared/sculpt';
import {
  assessmentSchema,
  repairReplySchema,
  reviewReplySchema,
  reviewSchema,
  specReplySchema,
  type Assessment,
  type Review,
  type StudioEvent,
  type StudioJob,
  type StudioVersion,
  type VersionSource,
} from '@/shared/studio';
import { getDoc } from '../content';
import { callClaude, type ImageMediaType, type LlmBlock } from './llm';
import { repairRequest, reviewRequest, specRequest, STUDIO_SYSTEM_PROMPT, type JobFacts } from './prompts';
import { addUsage, addVersion, getImage, getJob, getVersion, listVersions, updateJob, updateVersion } from './store';

const MAX_REPAIRS = 2;
const PASS_FIDELITY = 0.8;
const PASS_CRITICAL = 0.7;

type Emit = (e: StudioEvent) => void;

const registry = globalThis as unknown as { __studioRuns?: Map<string, AbortController> };
const runs = (registry.__studioRuns ??= new Map());

export function isRunning(jobId: string): boolean {
  return runs.has(jobId);
}

export function stopRun(jobId: string): boolean {
  const ctl = runs.get(jobId);
  ctl?.abort();
  return Boolean(ctl);
}

function imageBlock(dataUrl: string): LlmBlock {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error('Ảnh không hợp lệ');
  return { type: 'image', mediaType: m[1] as ImageMediaType, data: m[2] };
}

async function facts(job: StudioJob): Promise<JobFacts> {
  const base = job.baseAssetId ? await getDoc('assets', job.baseAssetId) : null;
  return { name: job.name, kind: job.kind, prompt: job.prompt, hasImage: job.hasImage, reference: referenceRig(job.kind, base), base };
}

/** Runs one step with a per-job lock, a stop handle, and job status bookkeeping. */
export async function runStep(jobId: string, label: string, step: (job: StudioJob, signal: AbortSignal) => Promise<void>): Promise<void> {
  const job = getJob(jobId);
  if (!job) throw new Error('Không tìm thấy job');
  if (runs.has(jobId)) throw new Error('Job này đang chạy');
  const ctl = new AbortController();
  runs.set(jobId, ctl);
  updateJob(jobId, { status: 'running', step: label, error: null });
  try {
    await step(job, ctl.signal);
    updateJob(jobId, { status: 'idle', step: null });
  } catch (e) {
    const message = ctl.signal.aborted ? 'Đã dừng theo yêu cầu' : e instanceof Error ? e.message : String(e);
    updateJob(jobId, { status: 'error', step: null, error: message });
    throw new Error(message);
  } finally {
    runs.delete(jobId);
  }
}

async function ask(jobId: string, content: LlmBlock[], schema: Parameters<typeof callClaude>[0]['schema'], signal: AbortSignal, emit: Emit) {
  const last = { thinking: -Infinity, writing: -Infinity };
  const result = await callClaude({
    system: STUDIO_SYSTEM_PROMPT,
    content,
    schema,
    signal,
    onProgress(phase, chars) {
      // Throttle to roughly one event per 400 characters per phase.
      if (chars - last[phase] < 400) return;
      last[phase] = chars;
      emit({ t: 'progress', phase, chars });
    },
  });
  addUsage(jobId, result.usage, result.engine);
  return result.json;
}

function zodProblems(error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> }): string[] {
  return error.issues.slice(0, 40).map((i) => `spec.${i.path.map(String).join('.')}: ${i.message}`);
}

function gateProblems(gates: GateReport): string[] {
  return gates.gates.filter((g) => g.level === 'fail').flatMap((g) => g.details.map((d) => `${g.label}: ${d}`));
}

interface Candidate {
  raw: unknown;
  source: VersionSource;
  assessment: Assessment | null;
  feedback: string | null;
  notes: string | null;
}

/**
 * Validates and gates a spec from Claude, storing each usable spec as a version, and sends
 * problems back for repair (bounded). Returns the last stored version.
 */
async function settle(job: StudioJob, f: JobFacts, first: Candidate, signal: AbortSignal, emit: Emit): Promise<StudioVersion> {
  let candidate = first;
  let stored: StudioVersion | null = null;
  for (let attempt = 0; ; attempt++) {
    const parsed = sculptSpecSchema.safeParse(candidate.raw);
    let problems: string[];
    if (parsed.success) {
      const spec: SculptSpec = { ...parsed.data, name: job.name };
      const gates = runSculptGates(spec, job.kind, f.reference);
      stored = addVersion(job.id, { source: candidate.source, spec, gates, assessment: candidate.assessment, review: null, feedback: candidate.feedback, notes: candidate.notes });
      emit({ t: 'version', n: stored.n });
      if (gates.verdict !== 'fail') return stored;
      problems = gateProblems(gates);
    } else {
      problems = zodProblems(parsed.error);
    }
    if (attempt >= MAX_REPAIRS) {
      if (stored) return stored;
      throw new Error(`Spec vẫn không hợp lệ sau ${MAX_REPAIRS} lần sửa: ${problems.slice(0, 3).join('; ')}`);
    }
    emit({ t: 'status', text: `Gate chặn ${problems.length} lỗi — Claude sửa spec (lần ${attempt + 1}/${MAX_REPAIRS})…` });
    // The reference goes with repairs too, so fixing a gate never drifts away from the likeness.
    const image = job.hasImage ? getImage(job.id) : null;
    const content: LlmBlock[] = [...(image ? [imageBlock(image)] : []), { type: 'text', text: repairRequest(f, candidate.raw, problems) }];
    const reply = (await ask(job.id, content, repairReplySchema, signal, emit)) as { spec?: unknown; notes?: unknown };
    candidate = { raw: reply.spec, source: 'repair', assessment: null, feedback: candidate.feedback, notes: typeof reply.notes === 'string' ? reply.notes : null };
  }
}

export async function specStep(job: StudioJob, signal: AbortSignal, emit: Emit): Promise<void> {
  const f = await facts(job);
  const image = job.hasImage ? getImage(job.id) : null;
  emit({ t: 'status', text: image ? 'Claude đang phân tích ảnh mẫu và viết sculpt spec…' : 'Claude đang viết sculpt spec từ mô tả (không có ảnh mẫu)…' });
  const content: LlmBlock[] = [...(image ? [imageBlock(image)] : []), { type: 'text', text: specRequest(f) }];
  const reply = (await ask(job.id, content, specReplySchema, signal, emit)) as { assessment?: unknown; spec?: unknown };
  const assessment = assessmentSchema.safeParse(reply.assessment);
  await settle(job, f, { raw: reply.spec, source: 'spec', assessment: assessment.success ? assessment.data : null, feedback: null, notes: null }, signal, emit);
}

export interface ReviewInput {
  version: number;
  sheet: string;
  feedback: string | null;
}

export async function reviewStep(job: StudioJob, input: ReviewInput, signal: AbortSignal, emit: Emit): Promise<void> {
  const version = getVersion(job.id, input.version);
  if (!version) throw new Error(`Không có version ${input.version}`);
  const f = await facts(job);
  const image = job.hasImage ? getImage(job.id) : null;
  const round = input.feedback ? 0 : countReviews(job.id) + 1;
  // Manual reviews may go past the planned number of rounds.
  const maxRounds = Math.max(job.maxRounds, round, 1);
  emit({ t: 'status', text: input.feedback ? `Claude đang sửa v${version.n} theo góp ý…` : `Claude đang so render v${version.n} với ${image ? 'ảnh mẫu' : 'mô tả'} (vòng ${round}/${maxRounds})…` });
  const content: LlmBlock[] = [
    ...(image ? [imageBlock(image)] : []),
    imageBlock(input.sheet),
    { type: 'text', text: reviewRequest({ ...f, spec: version.spec, gates: version.gates, round: Math.max(1, round), maxRounds, feedback: input.feedback }) },
  ];
  const reply = (await ask(job.id, content, reviewReplySchema, signal, emit)) as { review?: unknown; spec?: unknown };
  const parsed = reviewSchema.safeParse(reply.review);
  if (!parsed.success) throw new Error('Claude trả về review không hợp lệ');
  const r = parsed.data;
  const passes = r.fidelity >= PASS_FIDELITY && r.features.filter((x) => x.critical).every((x) => x.score >= PASS_CRITICAL) && version.gates.verdict !== 'fail' && !input.feedback;
  const outcome: Review['outcome'] = passes ? 'continue' : reply.spec ? 'refine' : 'stalled';
  updateVersion(job.id, version.n, { review: { ...r, outcome, round } }, input.sheet);
  emit({ t: 'version', n: version.n });
  if (outcome === 'refine') {
    await settle(job, f, { raw: reply.spec, source: input.feedback ? 'feedback' : 'review', assessment: null, feedback: input.feedback, notes: r.summary }, signal, emit);
  }
}

function countReviews(jobId: string): number {
  return listVersions(jobId).filter((v) => v.review && v.review.round > 0).length;
}
