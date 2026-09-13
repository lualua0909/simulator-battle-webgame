'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { buildSculptModel } from '@/game/sculpt/build';
import type { GateReport } from '@/game/sculpt/gates';
import { weaponStyleOf } from '@/game/sculpt/rigs';
import { bakeModel } from '@/game/models/bake';
import { useConfig } from '@/game/useConfig';
import { assetParamDefaults } from '@/shared/fields';
import { RIG_OF_KIND, type AssetDef, type AssetKind, type WeaponDef } from '@/shared/schema';
import type { SculptSpec } from '@/shared/sculpt';
import type { StudioJobDetail, StudioVersion, VersionSource } from '@/shared/studio';
import ModelViewer, { type PreviewAnim } from '../../ModelViewer';
import { api } from '../api';
import { EXPORT_FORMATS, exportVersion, type ExportFormat } from './exporters';
import { KIND_LABELS, VerdictDot, type RunPlan, type RunState } from './common';

interface Props {
  job: StudioJobDetail;
  run: RunState | null;
  busy: boolean;
  onRun(plan: RunPlan): void;
  onStop(): void;
  onDelete(): void;
}

const SOURCE_LABELS: Record<VersionSource, string> = {
  spec: 'spec đầu tiên',
  repair: 'sửa theo gate',
  review: 'tự sửa sau review',
  feedback: 'sửa theo góp ý',
};

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export default function JobView({ job, run, busy, onRun, onStop, onDelete }: Props) {
  const [picked, setPicked] = useState<number | null>(null);
  const version = job.versions.find((v) => v.n === picked) ?? job.versions[job.versions.length - 1] ?? null;
  const assessment = job.versions.find((v) => v.assessment)?.assessment ?? null;
  const reviewedRounds = job.versions.filter((v) => v.review && v.review.round > 0).length;
  const running = Boolean(run) || job.status === 'running';

  useEffect(() => setPicked(null), [job.id, job.versions.length]);

  return (
    <>
      <section className="panel flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-xl">{job.name}</h2>
          <span className="rounded bg-ink px-1.5 text-xs font-bold text-white">{KIND_LABELS[job.kind]}</span>
          {job.baseAssetId && <span className="text-xs opacity-70">dựa trên asset {job.baseAssetId}</span>}
          <div className="ml-auto flex gap-2">
            {!running && job.versions.length === 0 && (
              <button className="btn btn-gold px-3 py-1 text-sm" disabled={busy} onClick={() => onRun({ kind: 'auto' })}>
                ▶ Chạy
              </button>
            )}
            {!running && job.versions.length > 0 && reviewedRounds < job.maxRounds && !job.versions[job.versions.length - 1].review && (
              <button className="btn px-3 py-1 text-sm" disabled={busy} onClick={() => onRun({ kind: 'auto' })}>
                ▶ Chạy vòng tự sửa còn lại ({job.maxRounds - reviewedRounds})
              </button>
            )}
            <button className="btn px-3 py-1 text-sm" disabled={running} onClick={onDelete}>
              Xóa
            </button>
          </div>
        </div>
        <RunBar job={job} run={run} onStop={onStop} />
        <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            {job.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={job.image} alt="Ảnh mẫu" className="max-h-64 w-full rounded-lg border-2 border-ink/20 bg-white object-contain" />
            ) : (
              <div className="rounded-lg border-2 border-dashed border-ink/30 p-3 text-center text-xs opacity-70">Không có ảnh mẫu — dựng từ mô tả (reference-free)</div>
            )}
            <p className="text-xs opacity-70">
              {job.usage.calls} lượt gọi Claude · {fmt(job.usage.inputTokens)} token vào / {fmt(job.usage.outputTokens)} token ra
              {job.usage.costUsd > 0 && ` · ≈ $${job.usage.costUsd.toFixed(2)}`}
              {job.engine && ` · ${job.engine === 'api' ? 'API' : 'CLI'}`}
            </p>
          </div>
          <div className="flex flex-col gap-2 text-sm">
            <p>
              <b>Mô tả:</b> {job.prompt || <i className="opacity-60">(không có)</i>}
            </p>
            {assessment && (
              <div className="rounded-lg bg-white/70 p-2">
                <p>
                  <b>Phân tích:</b> {assessment.subject} ·{' '}
                  <span className={assessment.suitability === 'good' ? 'text-green-700' : assessment.suitability === 'partial' ? 'text-amber-700' : 'text-red-team'}>
                    {{ good: 'dựng tốt', partial: 'dựng được một phần', poor: 'khó dựng' }[assessment.suitability]}
                  </span>
                </p>
                <p className="mt-1">{assessment.summary}</p>
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs font-bold">Chi tiết phân tích img2threejs</summary>
                  <dl className="mt-1 grid gap-1 text-xs">
                    <dt className="font-bold">Silhouette</dt>
                    <dd>{assessment.silhouette}</dd>
                    <dt className="font-bold">Thành phần (macro → micro)</dt>
                    <dd>
                      <ul className="list-disc pl-4">{assessment.components.map((c, i) => <li key={i}>{c}</li>)}</ul>
                    </dd>
                    <dt className="font-bold">Đặc điểm nhận dạng</dt>
                    <dd>
                      <ul className="list-disc pl-4">{assessment.identityFeatures.map((c, i) => <li key={i}>{c}</li>)}</ul>
                    </dd>
                    <dt className="font-bold">Bị che / chưa chắc</dt>
                    <dd>
                      <ul className="list-disc pl-4">{assessment.hiddenOrUncertain.map((c, i) => <li key={i}>{c}</li>)}</ul>
                    </dd>
                    <dt className="font-bold">Bảng màu</dt>
                    <dd className="flex flex-wrap gap-2">
                      {assessment.palette.map((p, i) => (
                        <span key={i} className="flex items-center gap-1">
                          <span className="inline-block h-3 w-3 rounded border border-ink/30" style={{ background: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : 'transparent' }} />
                          {p.name}
                        </span>
                      ))}
                    </dd>
                  </dl>
                </details>
              </div>
            )}
          </div>
        </div>
      </section>

      {version && (
        <section className="panel flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 font-display text-sm">Version</span>
            {job.versions.map((v) => (
              <button key={v.n} className={`btn gap-1 px-2 py-0.5 text-xs ${v.n === version.n ? 'btn-gold' : ''}`} onClick={() => setPicked(v.n)} title={SOURCE_LABELS[v.source]}>
                v{v.n}
                <VerdictDot verdict={v.gates.verdict} />
                {v.review && <span>{Math.round(v.review.fidelity * 100)}%</span>}
              </button>
            ))}
          </div>
          <VersionPanel key={`${job.id}-${version.n}`} job={job} version={version} busy={busy || running} onRun={onRun} />
        </section>
      )}
    </>
  );
}

function RunBar({ job, run, onStop }: { job: StudioJobDetail; run: RunState | null; onStop(): void }) {
  const [now, setNow] = useState(() => Date.now());
  const active = Boolean(run) || job.status === 'running';
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  if (!active) {
    return job.status === 'error' && job.error ? <div className="rounded-lg border-2 border-red-team bg-red-50 px-3 py-2 text-sm">Lần chạy trước lỗi: {job.error}</div> : null;
  }
  const seconds = run ? Math.max(0, Math.round((now - run.startedAt) / 1000)) : null;
  const progress = run?.phase === 'thinking' ? `Claude đang suy nghĩ…${run.chars > 0 ? ` (${fmt(run.chars)} ký tự)` : ''}` : run?.phase === 'writing' ? `Claude đang viết… ${fmt(run.chars)} ký tự` : null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-ink bg-gold/30 px-3 py-2 text-sm">
      <span className="animate-spin">⏳</span>
      <b>{run?.text ?? `Đang chạy trên máy chủ (${job.step ?? '…'})`}</b>
      {progress && <span className="opacity-80">{progress}</span>}
      {seconds !== null && (
        <span className="font-mono text-xs opacity-70">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
        </span>
      )}
      <button className="btn btn-red ml-auto px-2 py-0.5 text-xs" onClick={onStop}>
        Dừng
      </button>
    </div>
  );
}

/** Weapon stand-in so the preview plays the attack animation the game would pick. */
function previewWeapon(spec: SculptSpec): WeaponDef {
  const attack = spec.rig === 'dragon' ? 'breath' : spec.rig === 'catapult' || spec.weaponStyle === 'bow' ? 'projectile' : 'melee';
  return { attack } as WeaponDef;
}

function VersionPanel({ job, version, busy, onRun }: { job: StudioJobDetail; version: StudioVersion; busy: boolean; onRun(plan: RunPlan): void }) {
  const [anim, setAnim] = useState<PreviewAnim>('idle');
  const [explode, setExplode] = useState(false);
  const [part, setPart] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const template = useMemo(() => {
    try {
      return bakeModel(buildSculptModel(version.spec));
    } catch {
      return null;
    }
  }, [version.spec]);
  const stats = version.gates.stats;
  const animated = version.spec.rig !== 'static';

  return (
    <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {animated &&
            (['idle', 'walk', 'attack'] as const).map((a) => (
              <button key={a} className={`btn px-2 py-0.5 text-xs ${anim === a ? 'btn-gold' : ''}`} onClick={() => setAnim(a)}>
                {a === 'idle' ? 'Đứng' : a === 'walk' ? 'Đi' : 'Đánh'}
              </button>
            ))}
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={explode} onChange={(e) => setExplode(e.target.checked)} /> Tách rời
          </label>
          {part && <span className="rounded bg-white px-2 py-0.5 font-mono">{part}</span>}
          <span className="ml-auto opacity-70">
            v{version.n} · {SOURCE_LABELS[version.source]}
          </span>
        </div>
        <div className="h-[28rem] overflow-hidden rounded-lg border-2 border-ink/20">
          {template ? <ModelViewer template={template} weapon={previewWeapon(version.spec)} anim={animated ? anim : 'idle'} explode={explode} onPick={setPart} /> : <p className="p-4 text-sm">Spec này không dựng được — xem gate.</p>}
        </div>
        {stats && (
          <p className="text-xs opacity-70">
            {stats.triangles} tam giác · {stats.meshes} mesh · {stats.parts} part · cao {stats.height.toFixed(2)} m · rộng {stats.width.toFixed(2)} m · dài {stats.depth.toFixed(2)} m
          </p>
        )}
        {version.notes && (
          <p className="rounded-lg bg-white/70 p-2 text-sm">
            <b>Ghi chú của Claude:</b> {version.notes}
          </p>
        )}
        {version.feedback && (
          <p className="rounded-lg bg-white/70 p-2 text-sm">
            <b>Góp ý đã áp dụng:</b> {version.feedback}
          </p>
        )}
        <ExportPanel job={job} version={version} />
      </div>

      <div className="flex flex-col gap-3">
        <GateList report={version.gates} />
        {version.review ? <ReviewPanel version={version} next={job.versions.find((v) => v.n === version.n + 1) ?? null} /> : <p className="text-sm opacity-70">Chưa review bằng vision.</p>}
        <div className="flex flex-col gap-2 rounded-lg border-2 border-ink/20 bg-white/60 p-2">
          <b className="text-sm">Góp ý để Claude sửa v{version.n}</b>
          <textarea className="field min-h-20" value={feedback} maxLength={2000} placeholder="VD: đầu to hơn 20%, khiên màu xanh dương, bỏ áo choàng, kiếm dài hơn" onChange={(e) => setFeedback(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-gold px-3 py-1 text-sm" disabled={busy || !feedback.trim()} onClick={() => onRun({ kind: 'review', version: version.n, feedback: feedback.trim() })}>
              Sửa theo góp ý
            </button>
            <button className="btn px-3 py-1 text-sm" disabled={busy} onClick={() => onRun({ kind: 'review', version: version.n, feedback: null })} title="Render lại, so với ảnh mẫu, tự sửa nếu cần">
              So sánh lại
            </button>
          </div>
        </div>
        <ApplyPanel job={job} version={version} />
      </div>
    </div>
  );
}

function GateList({ report }: { report: GateReport }) {
  const icon = { pass: '✅', warn: '⚠️', fail: '⛔' } as const;
  return (
    <div className="rounded-lg border-2 border-ink/20 bg-white/60 p-2">
      <b className="text-sm">Gate tất định</b>
      <ul className="mt-1 flex flex-col gap-1 text-xs">
        {report.gates.map((g) => (
          <li key={g.id} className="flex gap-1.5">
            <span>{icon[g.level]}</span>
            <span>
              <b>{g.label}</b>
              {g.details.length > 0 && <span className="opacity-80"> — {g.details.join(' · ')}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReviewPanel({ version, next }: { version: StudioVersion; next: StudioVersion | null }) {
  const r = version.review!;
  const outcome =
    r.outcome === 'continue' ? <span className="text-green-700">đạt ngưỡng — dừng</span> : r.outcome === 'refine' ? <span className="text-amber-700">cần sửa{next ? ` → v${next.n}` : ''}</span> : <span className="text-red-team">Claude không đưa bản sửa</span>;
  return (
    <div className="rounded-lg border-2 border-ink/20 bg-white/60 p-2 text-sm">
      <div className="flex items-baseline gap-2">
        <b>Review vision{r.round > 0 ? ` (vòng ${r.round})` : ' (theo góp ý)'}</b>
        <span className="font-display text-lg">{Math.round(r.fidelity * 100)}%</span>
        <span className="text-xs">{outcome}</span>
      </div>
      <p className="mt-1">{r.summary}</p>
      <ul className="mt-2 flex flex-col gap-1 text-xs">
        {r.features.map((f, i) => (
          <li key={i}>
            <div className="flex items-center gap-2">
              <span className="w-40 truncate" title={f.name}>
                {f.critical ? '★ ' : ''}
                {f.name}
              </span>
              <span className="h-2 flex-1 overflow-hidden rounded bg-ink/10">
                <span className={`block h-full ${f.score >= 0.7 ? 'bg-green-600' : f.score >= 0.5 ? 'bg-amber-500' : 'bg-red-team'}`} style={{ width: `${Math.round(f.score * 100)}%` }} />
              </span>
              <span className="w-8 text-right">{Math.round(f.score * 100)}</span>
            </div>
            {f.note && <div className="pl-2 opacity-70">{f.note}</div>}
          </li>
        ))}
      </ul>
      {r.mismatches.length > 0 && (
        <>
          <b className="mt-2 block text-xs">Còn lệch</b>
          <ul className="list-disc pl-4 text-xs">
            {r.mismatches.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </>
      )}
      {version.sheet && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-bold">Ảnh render Claude đã xem</summary>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={version.sheet} alt="Render 4 góc" className="mt-1 w-full rounded border border-ink/20" />
        </details>
      )}
    </div>
  );
}

function ExportPanel({ job, version }: { job: StudioJobDetail; version: StudioVersion }) {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="rounded-lg border-2 border-ink/20 bg-white/60 p-2">
      <b className="text-sm">Tải về v{version.n}</b>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {EXPORT_FORMATS.map((f) => (
          <button
            key={f.id}
            className="btn px-2 py-0.5 text-xs"
            title={f.hint}
            disabled={busy !== null}
            onClick={async () => {
              setBusy(f.id);
              setError(null);
              try {
                await exportVersion(f.id, version.spec, job.id, version.n);
              } catch (e) {
                setError(`${f.label}: ${e instanceof Error ? e.message : String(e)}`);
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === f.id ? '…' : f.label}
          </button>
        ))}
      </div>
      {error && <p className="mt-1 text-xs font-bold text-red-team">{error}</p>}
    </div>
  );
}

function ApplyPanel({ job, version }: { job: StudioJobDetail; version: StudioVersion }) {
  const { bundle, reload } = useConfig();
  const spec = version.spec;
  const compatible = (bundle?.assets ?? []).filter((a) => RIG_OF_KIND[a.kind] === spec.rig);
  const [target, setTarget] = useState(job.baseAssetId ?? '');
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState(job.name);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const using = (bundle?.assets ?? []).filter((a) => a.sculpt?.studioId === job.id);
  const blocked = version.gates.verdict === 'fail';
  const sculpt = { studioId: job.id, version: version.n, spec };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setSaving(true);
    setStatus(null);
    try {
      await fn();
      await reload();
      setStatus({ ok: true, text: ok });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const replace = () =>
    act(async () => {
      const asset = await api<AssetDef>(`/api/admin/assets/${target}`);
      const users = (bundle?.units ?? []).filter((u) => u.modelId === asset.id || u.riderModelId === asset.id).map((u) => u.name);
      const notes = [
        users.length ? `Lính dùng asset này: ${users.join(', ')}.` : 'Chưa có lính nào dùng asset này.',
        spec.rig === 'humanoid' && weaponStyleOf(asset.params.weapon) !== spec.weaponStyle ? `Lưu ý: asset gốc dùng kiểu vũ khí "${weaponStyleOf(asset.params.weapon)}", model mới "${spec.weaponStyle}".` : '',
        version.gates.verdict === 'warn' ? 'Gate còn cảnh báo (xem danh sách gate).' : '',
      ].filter(Boolean);
      if (!confirm(`Thay model của asset "${asset.name}" bằng "${job.name}" v${version.n}?\n\n${notes.join('\n')}\n\nGame dùng model mới từ trận tiếp theo. Có thể hoàn tác bất cứ lúc nào.`)) throw new Error('Đã hủy');
      await api(`/api/admin/assets/${asset.id}`, { method: 'PUT', body: JSON.stringify({ ...asset, sculpt }) });
    }, 'Đã thay model ✓');

  const revert = (id: string) =>
    act(async () => {
      const asset = await api<AssetDef>(`/api/admin/assets/${id}`);
      await api(`/api/admin/assets/${id}`, { method: 'PUT', body: JSON.stringify({ ...asset, sculpt: null }) });
    }, 'Đã hoàn tác về model procedural ✓');

  const create = () =>
    act(async () => {
      const kind = job.kind as AssetKind;
      await api('/api/admin/assets', { method: 'POST', body: JSON.stringify({ id: newId, name: newName, kind, scale: 1, seed: 1, params: assetParamDefaults(kind), sculpt }) });
    }, `Đã tạo asset "${newId}" ✓ — gán cho lính trong mục Quân lính`);

  return (
    <div className="flex flex-col gap-2 rounded-lg border-2 border-ink bg-parch/60 p-2 text-sm">
      <b>Dùng trong game</b>
      {blocked && <p className="text-xs font-bold text-red-team">Gate đang chặn version này — sửa trước khi dùng trong game.</p>}
      <div className="flex gap-2">
        <select className="field" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">— chọn asset để thay —</option>
          {compatible.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.id}){a.sculpt ? ' · đang dùng img2threejs' : ''}
            </option>
          ))}
        </select>
        <button className="btn btn-gold shrink-0 px-3 py-1 text-sm" disabled={blocked || saving || !target} onClick={() => void replace()}>
          Thay model
        </button>
      </div>
      {job.kind !== 'prop' && (
        <div className="flex flex-wrap gap-2">
          <input className="field w-36" placeholder="id-asset-moi" value={newId} onChange={(e) => setNewId(e.target.value.toLowerCase())} />
          <input className="field w-40 flex-1" placeholder="Tên asset" value={newName} maxLength={48} onChange={(e) => setNewName(e.target.value)} />
          <button className="btn shrink-0 px-3 py-1 text-sm" disabled={blocked || saving || !newId || !newName.trim()} onClick={() => void create()}>
            Lưu thành asset mới
          </button>
        </div>
      )}
      {using.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs">
          {using.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              <Link href={`/admin/c/assets/${a.id}`} className="underline">
                {a.name}
              </Link>
              <span className="opacity-70">đang dùng v{a.sculpt!.version}</span>
              <button className="btn ml-auto px-2 py-0 text-xs" disabled={saving} onClick={() => void revert(a.id)}>
                Hoàn tác
              </button>
            </li>
          ))}
        </ul>
      )}
      {status && status.text !== 'Đã hủy' && <p className={`text-xs font-bold ${status.ok ? 'text-green-700' : 'text-red-team'}`}>{status.text}</p>}
    </div>
  );
}
