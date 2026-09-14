'use client';

// Client side of the img2threejs pipeline: job list/detail state, streamed steps and the
// auto loop (spec → render review → refine until the fidelity stops improving).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EngineStatus, StudioEvent, StudioJob, StudioJobDetail } from '@/shared/studio';
import { api } from '../api';
import type { RunPlan, RunState } from './common';
import { renderSheet } from './sheet';

async function streamStep(jobId: string, body: object, onEvent: (e: StudioEvent) => void): Promise<StudioJobDetail> {
  const res = await fetch(`/api/admin/studio/${jobId}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: StudioJobDetail | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const e = JSON.parse(line) as StudioEvent;
      if (e.t === 'done') result = e.job;
      else if (e.t === 'error') throw new Error(e.error);
      else onEvent(e);
    }
  }
  if (!result) throw new Error('Mất kết nối giữa chừng — bước vẫn chạy trên máy chủ, kết quả sẽ hiện khi xong');
  return result;
}

/** Downscales a picked/pasted image to Claude's recommended ≤ 1568 px edge, as JPEG. */
export async function prepareImage(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.9);
}

export function useStudioRunner() {
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [jobs, setJobs] = useState<StudioJob[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<StudioJobDetail | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const loadList = useCallback(async () => {
    const data = await api<{ engine: EngineStatus; jobs: StudioJob[] }>('/api/admin/studio');
    setEngine(data.engine);
    setJobs(data.jobs);
    return data.jobs;
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const d = await api<StudioJobDetail>(`/api/admin/studio/${id}`);
    if (selectedRef.current === id) setDetail(d);
    return d;
  }, []);

  useEffect(() => {
    loadList().catch((e: Error) => setMessage({ ok: false, text: e.message }));
  }, [loadList]);

  useEffect(() => {
    setDetail(null);
    if (!selected) return;
    loadDetail(selected).catch((e: Error) => setMessage({ ok: false, text: e.message }));
  }, [selected, loadDetail]);

  // A step started elsewhere (another tab, or before a reload) is still running: poll it.
  useEffect(() => {
    if (!detail || detail.status !== 'running' || run) return;
    const t = setInterval(() => {
      void loadDetail(detail.id);
      void loadList();
    }, 3000);
    return () => clearInterval(t);
  }, [detail, run, loadDetail, loadList]);

  const select = (id: string | null) => {
    setSelected(id);
    setMessage(null);
  };

  const onEvent = (jobId: string) => (e: StudioEvent) => {
    if (e.t === 'status') setRun((r) => (r ? { ...r, text: e.text, phase: null, chars: 0 } : r));
    else if (e.t === 'progress') setRun((r) => (r ? { ...r, phase: e.phase, chars: e.chars } : r));
    else if (e.t === 'version') void loadDetail(jobId);
  };

  const reviewOnce = async (d: StudioJobDetail, n: number, feedback: string | null) => {
    const version = d.versions.find((v) => v.n === n);
    if (!version) throw new Error(`Không có v${n}`);
    setRun((r) => (r ? { ...r, text: `Render 4 góc của v${n} để Claude so sánh…`, phase: null, chars: 0 } : r));
    const sheet = await renderSheet(version.spec);
    return streamStep(d.id, { action: 'review', version: n, sheet, feedback }, onEvent(d.id));
  };

  const startRun = async (jobId: string, plan: RunPlan) => {
    if (run) return;
    setMessage(null);
    setRun({ jobId, text: 'Bắt đầu…', phase: null, chars: 0, startedAt: Date.now() });
    try {
      let d = await loadDetail(jobId);
      if (plan.kind === 'review') {
        d = await reviewOnce(d, plan.version, plan.feedback);
      } else {
        if (!d.versions.length) d = await streamStep(jobId, { action: 'spec' }, onEvent(jobId));
        for (;;) {
          const reviewed = d.versions.filter((v) => v.review && v.review.round > 0);
          const latest = d.versions[d.versions.length - 1];
          if (!latest || latest.review || reviewed.length >= d.maxRounds) break;
          d = await reviewOnce(d, latest.n, null);
          const review = d.versions.find((v) => v.n === latest.n)?.review;
          if (!review || review.outcome !== 'refine') break;
          const previous = reviewed[reviewed.length - 1]?.review;
          if (previous && review.fidelity <= previous.fidelity + 0.01) {
            setMessage({ ok: true, text: `Dừng tự sửa: độ giống không tăng (${Math.round(previous.fidelity * 100)}% → ${Math.round(review.fidelity * 100)}%). Góp ý cụ thể để sửa tiếp.` });
            break;
          }
        }
      }
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setRun(null);
      void loadList();
      if (selectedRef.current === jobId) void loadDetail(jobId);
    }
  };

  const create = async (input: { name: string; kind: string; baseAssetId: string | null; prompt: string; image: string | null; maxRounds: number }) => {
    const job = await api<StudioJob>('/api/admin/studio', { method: 'POST', body: JSON.stringify(input) });
    void loadList();
    select(job.id);
    void startRun(job.id, { kind: 'auto' });
    return job;
  };

  const stop = async (jobId: string) => {
    await api(`/api/admin/studio/${jobId}/run`, { method: 'POST', body: JSON.stringify({ action: 'stop' }) }).catch(() => undefined);
  };

  const remove = async (jobId: string) => {
    try {
      await api(`/api/admin/studio/${jobId}`, { method: 'DELETE' });
      select(null);
      void loadList();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  return { engine, jobs, selected, detail, run, message, select, startRun, create, stop, remove };
}
