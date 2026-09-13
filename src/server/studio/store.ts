// SQLite storage for img2threejs studio jobs and their versions (kept apart from CMS docs,
// so content resets and bundle imports never touch generation history).
import { randomBytes } from 'node:crypto';
import type { SculptKind } from '@/game/sculpt/rigs';
import type { StudioJob, StudioJobDetail, StudioUsage, StudioVersion } from '@/shared/studio';
import { getDb } from '../db';

type JobData = Omit<StudioJob, 'id' | 'hasImage' | 'latest' | 'createdAt' | 'updatedAt'>;
type VersionData = Omit<StudioVersion, 'n' | 'sheet' | 'createdAt'>;

// Route handlers may load separate module instances; keep the one-time setup per process.
const flags = globalThis as unknown as { __studioTables?: boolean };

function db() {
  const d = getDb();
  if (!flags.__studioTables) {
    d.exec(`CREATE TABLE IF NOT EXISTS studio_jobs (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      image TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS studio_versions (
      job_id TEXT NOT NULL,
      n INTEGER NOT NULL,
      data TEXT NOT NULL,
      sheet TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (job_id, n)
    )`);
    // A server restart kills any step that was running.
    const rows = d.prepare('SELECT id, data FROM studio_jobs').all() as { id: string; data: string }[];
    for (const r of rows) {
      const data = JSON.parse(r.data) as JobData;
      if (data.status === 'running') d.prepare('UPDATE studio_jobs SET data = ? WHERE id = ?').run(JSON.stringify({ ...data, status: 'error', step: null, error: 'Máy chủ khởi động lại khi đang chạy' }), r.id);
    }
    flags.__studioTables = true;
  }
  return d;
}

interface JobRow {
  id: string;
  data: string;
  has_image: number;
  created_at: number;
  updated_at: number;
}

function latestOf(jobId: string): StudioJob['latest'] {
  const rows = db().prepare('SELECT n, data FROM studio_versions WHERE job_id = ? ORDER BY n DESC').all(jobId) as { n: number; data: string }[];
  if (!rows.length) return null;
  const versions = rows.map((r) => JSON.parse(r.data) as VersionData);
  return { n: rows[0].n, verdict: versions[0].gates.verdict, fidelity: versions.find((v) => v.review)?.review?.fidelity ?? null };
}

function toJob(row: JobRow): StudioJob {
  return { id: row.id, ...(JSON.parse(row.data) as JobData), hasImage: row.has_image === 1, latest: latestOf(row.id), createdAt: row.created_at, updatedAt: row.updated_at };
}

export function listJobs(): StudioJob[] {
  const rows = db().prepare('SELECT id, data, image IS NOT NULL AS has_image, created_at, updated_at FROM studio_jobs ORDER BY created_at DESC').all() as JobRow[];
  return rows.map(toJob);
}

export function getJob(id: string): StudioJob | null {
  const row = db().prepare('SELECT id, data, image IS NOT NULL AS has_image, created_at, updated_at FROM studio_jobs WHERE id = ?').get(id) as JobRow | undefined;
  return row ? toJob(row) : null;
}

export function getJobDetail(id: string): StudioJobDetail | null {
  const job = getJob(id);
  if (!job) return null;
  const { image } = db().prepare('SELECT image FROM studio_jobs WHERE id = ?').get(id) as { image: string | null };
  return { ...job, image, versions: listVersions(id) };
}

export function getImage(id: string): string | null {
  const row = db().prepare('SELECT image FROM studio_jobs WHERE id = ?').get(id) as { image: string | null } | undefined;
  return row?.image ?? null;
}

export interface NewJob {
  name: string;
  kind: SculptKind;
  baseAssetId: string | null;
  prompt: string;
  maxRounds: number;
  image: string | null;
}

export function createJob(input: NewJob): StudioJob {
  const id = `sj-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const usage: StudioUsage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const data: JobData = { name: input.name, kind: input.kind, baseAssetId: input.baseAssetId, prompt: input.prompt, maxRounds: input.maxRounds, status: 'idle', step: null, error: null, engine: null, usage };
  const now = Date.now();
  db().prepare('INSERT INTO studio_jobs (id, data, image, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, JSON.stringify(data), input.image, now, now);
  return getJob(id)!;
}

export function updateJob(id: string, patch: Partial<JobData>): void {
  const row = db().prepare('SELECT data FROM studio_jobs WHERE id = ?').get(id) as { data: string } | undefined;
  if (!row) return;
  const data = { ...(JSON.parse(row.data) as JobData), ...patch };
  db().prepare('UPDATE studio_jobs SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), Date.now(), id);
}

export function deleteJob(id: string): boolean {
  const d = db();
  return d.transaction(() => {
    d.prepare('DELETE FROM studio_versions WHERE job_id = ?').run(id);
    return d.prepare('DELETE FROM studio_jobs WHERE id = ?').run(id).changes > 0;
  })();
}

export function listVersions(jobId: string): StudioVersion[] {
  const rows = db().prepare('SELECT n, data, sheet, created_at FROM studio_versions WHERE job_id = ? ORDER BY n').all(jobId) as { n: number; data: string; sheet: string | null; created_at: number }[];
  return rows.map((r) => ({ n: r.n, ...(JSON.parse(r.data) as VersionData), sheet: r.sheet, createdAt: r.created_at }));
}

export function getVersion(jobId: string, n: number): StudioVersion | null {
  const r = db().prepare('SELECT n, data, sheet, created_at FROM studio_versions WHERE job_id = ? AND n = ?').get(jobId, n) as { n: number; data: string; sheet: string | null; created_at: number } | undefined;
  return r ? { n: r.n, ...(JSON.parse(r.data) as VersionData), sheet: r.sheet, createdAt: r.created_at } : null;
}

export function addVersion(jobId: string, data: VersionData): StudioVersion {
  const d = db();
  const n = d.transaction(() => {
    const { max } = d.prepare('SELECT COALESCE(MAX(n), 0) AS max FROM studio_versions WHERE job_id = ?').get(jobId) as { max: number };
    d.prepare('INSERT INTO studio_versions (job_id, n, data, sheet, created_at) VALUES (?, ?, ?, NULL, ?)').run(jobId, max + 1, JSON.stringify(data), Date.now());
    return max + 1;
  })();
  return getVersion(jobId, n)!;
}

export function updateVersion(jobId: string, n: number, patch: Partial<VersionData>, sheet?: string): void {
  const row = db().prepare('SELECT data, sheet FROM studio_versions WHERE job_id = ? AND n = ?').get(jobId, n) as { data: string; sheet: string | null } | undefined;
  if (!row) return;
  const data = { ...(JSON.parse(row.data) as VersionData), ...patch };
  db()
    .prepare('UPDATE studio_versions SET data = ?, sheet = ? WHERE job_id = ? AND n = ?')
    .run(JSON.stringify(data), sheet ?? row.sheet, jobId, n);
}

export function addUsage(jobId: string, add: Omit<StudioUsage, 'calls'>, engine: StudioJob['engine']): void {
  const job = getJob(jobId);
  if (!job) return;
  const u = job.usage;
  updateJob(jobId, {
    engine,
    usage: { calls: u.calls + 1, inputTokens: u.inputTokens + add.inputTokens, outputTokens: u.outputTokens + add.outputTokens, costUsd: u.costUsd + add.costUsd },
  });
}
