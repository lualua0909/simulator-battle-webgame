'use client';

// img2threejs studio: create a model from a reference image and/or a brief, watch the
// staged pipeline (spec → gates → render review → refine), then export or apply it.
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SCULPT_KINDS, type SculptKind } from '@/game/sculpt/rigs';
import { useConfig } from '@/game/useConfig';
import type { EngineStatus, StudioEvent, StudioJob, StudioJobDetail } from '@/shared/studio';
import { api, ApiError } from '../api';
import { KIND_LABELS, VerdictDot, type RunPlan, type RunState } from './common';
import JobView from './JobView';
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
async function prepareImage(file: Blob): Promise<string> {
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

export default function Studio({ initialJob }: { initialJob?: string }) {
  const router = useRouter();
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [jobs, setJobs] = useState<StudioJob[]>([]);
  const [selected, setSelected] = useState<string | null>(initialJob ?? null);
  const [detail, setDetail] = useState<StudioJobDetail | null>(null);
  const [creating, setCreating] = useState(!initialJob);
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
    void loadList().then((list) => {
      if (!initialJob && list.length) setCreating(false);
    });
  }, [loadList, initialJob]);

  useEffect(() => {
    if (!selected) return setDetail(null);
    setDetail(null);
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
    setCreating(id === null);
    setMessage(null);
    router.replace(id ? `/admin/studio?job=${id}` : '/admin/studio');
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

  const stop = async (jobId: string) => {
    await api(`/api/admin/studio/${jobId}/run`, { method: 'POST', body: JSON.stringify({ action: 'stop' }) }).catch(() => undefined);
  };

  const remove = async (jobId: string) => {
    if (!confirm('Xóa job này cùng mọi version? Asset đã áp dụng model vẫn giữ bản sao của nó.')) return;
    try {
      await api(`/api/admin/studio/${jobId}`, { method: 'DELETE' });
      select(null);
      void loadList();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="grid items-start gap-3 lg:grid-cols-[270px_minmax(0,1fr)]">
      <aside className="panel flex flex-col gap-2 p-3 lg:sticky lg:top-3">
        <h1 className="font-display text-lg leading-tight">🧪 Xưởng img2threejs</h1>
        <EngineBadge engine={engine} />
        <button className="btn btn-gold py-1.5 text-sm" onClick={() => select(null)}>
          + Tạo model mới
        </button>
        <ul className="flex max-h-[65vh] flex-col gap-1 overflow-y-auto text-sm">
          {jobs.map((j) => (
            <li key={j.id}>
              <button className={`w-full rounded-lg px-2 py-1.5 text-left hover:bg-white ${selected === j.id && !creating ? 'bg-white ring-2 ring-ink' : ''}`} onClick={() => select(j.id)}>
                <div className="flex items-center gap-1 font-bold">
                  <span className="truncate">{j.name}</span>
                  {(j.status === 'running' || run?.jobId === j.id) && <span className="animate-pulse">⏳</span>}
                  {j.status === 'error' && <span title={j.error ?? ''}>⚠️</span>}
                </div>
                <div className="flex gap-2 text-xs opacity-70">
                  <span>{KIND_LABELS[j.kind]}</span>
                  {j.latest && <span>v{j.latest.n}</span>}
                  {j.latest?.fidelity != null && <span>{Math.round(j.latest.fidelity * 100)}%</span>}
                  {j.latest && <VerdictDot verdict={j.latest.verdict} />}
                </div>
              </button>
            </li>
          ))}
          {!jobs.length && <li className="px-2 text-xs opacity-60">Chưa có model nào.</li>}
        </ul>
      </aside>

      <main className="flex min-w-0 flex-col gap-3">
        {message && <div className={`rounded-lg border-2 px-3 py-2 text-sm ${message.ok ? 'border-green-700 bg-green-50' : 'border-red-team bg-red-50'}`}>{message.text}</div>}
        {creating || !selected ? (
          <NewJobForm
            engine={engine}
            busy={Boolean(run)}
            onCreated={(job) => {
              void loadList();
              select(job.id);
              void startRun(job.id, { kind: 'auto' });
            }}
          />
        ) : detail ? (
          <JobView job={detail} run={run?.jobId === detail.id ? run : null} busy={Boolean(run)} onRun={(plan) => void startRun(detail.id, plan)} onStop={() => void stop(detail.id)} onDelete={() => void remove(detail.id)} />
        ) : (
          <p className="panel p-4">Đang tải…</p>
        )}
      </main>
    </div>
  );
}

function EngineBadge({ engine }: { engine: EngineStatus | null }) {
  if (!engine) return <p className="text-xs opacity-60">Đang kiểm tra engine…</p>;
  if (!engine.active)
    return (
      <p className="rounded-lg border-2 border-red-team bg-red-50 px-2 py-1 text-xs">
        Chưa có engine Claude. Đặt <code>ANTHROPIC_API_KEY</code> hoặc cài + đăng nhập Claude Code CLI (<code>claude</code>) trên máy chủ.
      </p>
    );
  return (
    <p className="text-xs opacity-80">
      Engine: <b>{engine.active === 'api' ? 'Claude API' : 'Claude Code CLI'}</b> · <code>{engine.model}</code>
      {engine.active === 'cli' && (
        <span className="block opacity-70">
          (không có API key — dùng login của <code>claude</code>)
        </span>
      )}
    </p>
  );
}

function NewJobForm({ engine, busy, onCreated }: { engine: EngineStatus | null; busy: boolean; onCreated(job: StudioJob): void }) {
  const { bundle } = useConfig();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<SculptKind>('humanoid');
  const [baseAssetId, setBaseAssetId] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [maxRounds, setMaxRounds] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const bases = (bundle?.assets ?? []).filter((a) => a.kind === kind);

  const pick = async (file: Blob | null | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      setImage(await prepareImage(file));
    } catch {
      setError('Không đọc được ảnh này');
    }
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      if (item) void pick(item.getAsFile());
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      const job = await api<StudioJob>('/api/admin/studio', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() || (prompt.trim().slice(0, 40) || 'Model mới'), kind, baseAssetId: baseAssetId || null, prompt, image, maxRounds }),
      });
      onCreated(job);
    } catch (e) {
      setError(e instanceof ApiError && Array.isArray(e.details) ? `${e.message}: ${(e.details as { message: string }[]).map((d) => d.message).join(', ')}` : e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel flex flex-col gap-3 p-4">
      <div>
        <h2 className="font-display text-xl">Tạo model 3D với img2threejs</h2>
        <p className="text-sm opacity-75">
          Claude đọc ảnh mẫu (nếu có) và mô tả, viết sculpt spec từ primitive; generator dựng Three.js, chạy gate tất định (rig, chạm đất, liền khối, ngân sách tam giác), render 4 góc rồi tự so sánh và sửa. Kết quả xuất được TypeScript / GLB / OBJ… hoặc thay model nhân vật.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex flex-col gap-2.5">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-bold">Tên model</span>
            <input className="field" value={name} maxLength={48} placeholder="VD: Hiệp sĩ thánh chiến" onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-bold">Loại (quyết định rig animation)</span>
              <select
                className="field"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as SculptKind);
                  setBaseAssetId('');
                }}
              >
                {SCULPT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-bold">Dựa trên asset (tuỳ chọn)</span>
              <select className="field" value={baseAssetId} disabled={kind === 'prop'} onChange={(e) => setBaseAssetId(e.target.value)}>
                <option value="">— model mới —</option>
                {bases.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.id})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="-mt-1 text-xs opacity-60">Asset gốc cho Claude biết khớp, cỡ và kiểu vũ khí của model sẽ được thay; sau khi xong vẫn chọn được asset để áp dụng.</p>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-bold">Mô tả / prompt</span>
            <textarea
              className="field min-h-28"
              value={prompt}
              maxLength={4000}
              placeholder="VD: Hiệp sĩ giáp bạc, áo choàng đỏ, khiên tròn có hình sư tử vàng, cầm kiếm dài. Dáng to con."
              onChange={(e) => setPrompt(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="font-bold">Số vòng tự so sánh & sửa</span>
            <span className="w-16 shrink-0">
              <select className="field" value={maxRounds} onChange={(e) => setMaxRounds(Number(e.target.value))}>
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </span>
            <span className="text-xs opacity-60">mỗi vòng tốn thêm 1 lượt gọi Claude</span>
          </label>
        </div>
        <div
          className={`flex min-h-56 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-2 text-center text-sm ${image ? 'border-ink bg-white' : 'border-ink/40 bg-white/50'}`}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void pick(e.dataTransfer.files[0]);
          }}
        >
          {image ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt="Ảnh mẫu" className="max-h-56 rounded-lg object-contain" />
              <button
                type="button"
                className="btn px-2 py-0.5 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  setImage(null);
                }}
              >
                Bỏ ảnh
              </button>
            </>
          ) : (
            <>
              <span className="text-3xl">🖼️</span>
              <b>Ảnh mẫu (tuỳ chọn)</b>
              <span className="text-xs opacity-70">Bấm để chọn, kéo-thả, hoặc dán (Ctrl/⌘+V). Một vật thể rõ, nền đơn giản cho kết quả tốt nhất.</span>
            </>
          )}
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
        </div>
      </div>
      {error && <p className="text-sm font-bold text-red-team">{error}</p>}
      <div className="flex items-center gap-3">
        <button className="btn btn-gold" disabled={saving || busy || !engine?.active || (!prompt.trim() && !image)} onClick={() => void submit()}>
          {saving ? 'Đang tạo…' : '✨ Tạo & chạy img2threejs'}
        </button>
        {busy && <span className="text-xs opacity-70">Đang có một job chạy — chờ xong rồi tạo tiếp.</span>}
      </div>
    </section>
  );
}
