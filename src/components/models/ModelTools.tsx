'use client';

// Model tools of the workshop: download (TypeScript / GLB / OBJ…), and regenerate a model with
// Claude through the img2threejs pipeline. Picking a generated version previews it in the
// workshop viewer in place of the asset; applying it overrides the asset (revertible).
import { Ban, Bone, Check, CircleCheck, Download, FlaskConical, ImageIcon, LoaderCircle, Package, Play, Ruler, Sparkles, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createAssetModel, createUnitModel } from '@/game/models';
import { IS_VERCEL } from '@/shared/deploy';
import { COLLECTION_SPECS } from '@/shared/fields';
import { RIG_OF_KIND, RIGID_GLB_KINDS, SKINNED_GLB_KINDS, type AssetDef, type ConfigBundle, type UnitDef } from '@/shared/schema';
import type { StudioJobDetail, StudioVersion } from '@/shared/studio';
import { api, ApiError } from '../admin/api';
import DocForm from '../admin/DocForm';
import TintEditor from './TintEditor';
import { VerdictDot, type RunState } from '../admin/studio/common';
import { EXPORT_FORMATS, exportModel, type ExportFormat, type ExportSource } from '../admin/studio/exporters';
import { prepareImage, useStudioRunner } from '../admin/studio/runner';

/** A generated version shown in the viewer instead of the asset's current model. */
export interface Candidate {
  assetId: string;
  sculpt: NonNullable<AssetDef['sculpt']>;
}

type Doc = Record<string, unknown>;

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** Assets with the candidate applied (what the viewer draws). */
export function withCandidate(assets: AssetDef[], candidate: Candidate | null): AssetDef[] {
  return candidate ? assets.map((a) => (a.id === candidate.assetId ? { ...a, sculpt: candidate.sculpt } : a)) : assets;
}

interface ModelTabProps {
  bundle: ConfigBundle;
  reload(): Promise<void>;
  unit: UnitDef;
  setUnit(unit: UnitDef): void;
  errors: Record<string, string>;
  candidate: Candidate | null;
  setCandidate(c: Candidate | null): void;
}

export default function ModelTab({ bundle, reload, unit, setUnit, errors, candidate, setCandidate }: ModelTabProps) {
  const [target, setTarget] = useState<'modelId' | 'riderModelId'>('modelId');
  const field = target === 'riderModelId' && unit.riderModelId ? 'riderModelId' : 'modelId';
  const asset = bundle.assets.find((a) => a.id === unit[field]);
  const fields = COLLECTION_SPECS.units.fields(unit as unknown as Doc).filter((f) => 'key' in f && (f.key === 'modelId' || f.key === 'riderModelId'));
  const whole: ExportSource = { name: unit.name, build: () => createUnitModel(unit, new Map(withCandidate(bundle.assets, candidate).map((a) => [a.id, a]))) };

  return (
    <div className="flex flex-col gap-3">
      <DocForm fields={fields} doc={unit as unknown as Doc} onChange={(d) => setUnit(d as unknown as UnitDef)} bundle={bundle} errors={errors} compact />
      {unit.riderModelId && (
        <div className="flex gap-1 text-xs">
          <span className="self-center font-bold">Công cụ cho:</span>
          {(['modelId', 'riderModelId'] as const).map((f) => (
            <button key={f} className={`btn px-2 py-0.5 text-xs ${field === f ? 'btn-gold' : ''}`} onClick={() => setTarget(f)}>
              {f === 'modelId' ? 'Thú cưỡi / thân' : 'Người cưỡi'}
            </button>
          ))}
        </div>
      )}
      {asset ? (
        <AssetModelTools
          key={asset.id}
          bundle={bundle}
          reload={reload}
          asset={asset}
          context={{ name: unit.name, description: unit.description }}
          candidate={candidate}
          setCandidate={setCandidate}
          extraSources={unit.riderModelId ? [{ label: `Cả lính (${unit.name})`, source: whole }] : []}
          onNewAsset={(id) => setUnit({ ...unit, [field]: id })}
        />
      ) : (
        <p className="text-sm text-red-team">Chưa chọn mô hình hợp lệ.</p>
      )}
    </div>
  );
}

interface ToolsProps {
  bundle: ConfigBundle;
  reload(): Promise<void>;
  asset: AssetDef;
  /** The unit being edited, for Claude's default brief. */
  context?: { name: string; description: string };
  candidate: Candidate | null;
  setCandidate(c: Candidate | null): void;
  extraSources?: Array<{ label: string; source: ExportSource }>;
  /** Unit context: point the unit at a new asset created from a version. */
  onNewAsset?(id: string): void;
  /** Gallery context: asset was deleted, clear the selection. */
  onDeleted?(): void;
}

export function AssetModelTools({ bundle, reload, asset, context, candidate, setCandidate, extraSources = [], onNewAsset, onDeleted }: ToolsProps) {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const users = bundle.units.filter((u) => u.modelId === asset.id || u.riderModelId === asset.id);
  const previewing = candidate?.assetId === asset.id ? candidate : null;

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

  const revert = () =>
    act(async () => {
      if (!confirm(`Hoàn tác "${asset.name}" về model procedural?${users.length ? `\nLính dùng asset này: ${users.map((u) => u.name).join(', ')}.` : ''}`)) throw new Error('Đã hủy');
      const doc = await api<AssetDef>(`/api/admin/assets/${asset.id}`);
      await api(`/api/admin/assets/${asset.id}`, { method: 'PUT', body: JSON.stringify({ ...doc, sculpt: null }) });
    }, 'Đã hoàn tác về model procedural');

  const remove = () =>
    act(async () => {
      if (!confirm(`Xóa hẳn asset "${asset.name}"? Không hoàn tác được.`)) throw new Error('Đã hủy');
      if (asset.glb) await fetch(`/api/admin/assets/${asset.id}/glb`, { method: 'DELETE', cache: 'no-store' });
      await api(`/api/admin/assets/${asset.id}`, { method: 'DELETE' });
      onDeleted?.();
    }, 'Đã xóa asset');

  const sources: Array<{ label: string; source: ExportSource }> = [
    ...(previewing ? [{ label: `Bản thử v${previewing.sculpt.version} (đang xem)`, source: { name: `${previewing.sculpt.spec.name}-v${previewing.sculpt.version}`, spec: previewing.sculpt.spec } }] : []),
    { label: `${asset.name}${asset.sculpt ? ' (img2threejs)' : ' (procedural)'}`, source: asset.sculpt ? { name: asset.name, spec: asset.sculpt.spec } : { name: asset.name, build: () => createAssetModel(asset) } },
    ...extraSources,
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-ink/20 bg-white/60 p-2 text-sm">
        <span>
          <b>{asset.name}</b> <span className="text-xs opacity-60">({asset.id})</span> ·{' '}
          {asset.sculpt ? (
            <>
              <FlaskConical /> img2threejs <b>{asset.sculpt.spec.name}</b> v{asset.sculpt.version}
            </>
          ) : (
            'preset procedural'
          )}
        </span>
        {asset.sculpt && (
          <button className="btn px-2 py-0 text-xs" disabled={saving} onClick={() => void revert()}>
            Hoàn tác về procedural
          </button>
        )}
        {onDeleted && (
          <button className="btn ml-auto px-2 py-0 text-xs" disabled={saving || users.length > 0} title={users.length ? 'Còn lính đang dùng, gỡ trước khi xóa' : undefined} onClick={() => void remove()}>
            Xóa asset
          </button>
        )}
        <span className="w-full text-xs opacity-60">{users.length ? `Dùng bởi: ${users.map((u) => u.name).join(', ')}` : 'Chưa lính nào dùng'}</span>
      </div>
      {status && status.text !== 'Đã hủy' && (
        <p className={`text-xs font-bold ${status.ok ? 'text-green-700' : 'text-red-team'}`}>
          {status.ok && <Check />} {status.text}
        </p>
      )}
      <ScalePanel asset={asset} act={act} saving={saving} />
      {(RIG_OF_KIND[asset.kind] === 'static' || (RIGID_GLB_KINDS as readonly string[]).includes(asset.kind)) && !(asset.kind === 'structure' && ((asset.params as Record<string, unknown> | undefined)?.type === 'wall' || (asset.params as Record<string, unknown> | undefined)?.type === 'brick-wall')) && <GlbUploadPanel asset={asset} users={users} act={act} saving={saving} />}
      {(SKINNED_GLB_KINDS as readonly string[]).includes(asset.kind) && <SkinnedGlbUploadPanel asset={asset} users={users} act={act} saving={saving} />}
      {asset.glb && (SKINNED_GLB_KINDS as readonly string[]).includes(asset.kind) && <TintSavePanel key={asset.glb.url} asset={asset} users={users} act={act} saving={saving} />}
      <DownloadPanel key={sources.map((s) => s.label).join('|')} sources={sources} />
      {!IS_VERCEL && <ClaudePanel bundle={bundle} asset={asset} context={context} users={users} setCandidate={setCandidate} act={act} saving={saving} onNewAsset={onNewAsset} />}
    </div>
  );
}

/** Recolour the uploaded skeletal model (saved separately; the workshop viewer updates after saving). */
function TintSavePanel({ asset, users, act, saving }: { asset: AssetDef; users: UnitDef[]; act: (fn: () => Promise<unknown>, ok: string) => Promise<void>; saving: boolean }) {
  const [tint, setTint] = useState<NonNullable<AssetDef['glb']>['tint']>(asset.glb?.tint ?? {});
  useEffect(() => setTint(asset.glb?.tint ?? {}), [asset.id, asset.glb?.url]);
  const dirty = JSON.stringify(tint) !== JSON.stringify(asset.glb?.tint ?? {});

  const save = () =>
    act(async () => {
      const notes = users.length ? `Đổi màu cho: ${users.map((u) => u.name).join(', ')}.` : 'Chưa lính nào dùng asset này.';
      if (!confirm(`Lưu màu mới của asset "${asset.name}"?\n\n${notes}\n\nGame dùng màu mới từ trận tiếp theo.`)) throw new Error('Đã hủy');
      const doc = await api<AssetDef>(`/api/admin/assets/${asset.id}`);
      await api(`/api/admin/assets/${asset.id}`, { method: 'PUT', body: JSON.stringify({ ...doc, glb: doc.glb ? { ...doc.glb, tint } : doc.glb }) });
    }, 'Đã lưu màu — khung xem thử cập nhật sau khi tải lại');

  if (!asset.glb) return null;
  return (
    <div className="flex flex-col gap-2">
      <TintEditor glbUrl={asset.glb.url} tint={tint} onChange={setTint} />
      <button className="btn btn-gold self-start px-3 py-1 text-xs" disabled={saving || !dirty} onClick={() => void save()}>
        Lưu màu
      </button>
    </div>
  );
}

/** Display scale of the 3D model (independent of the underlying procedural/sculpt/glb source). */
function ScalePanel({ asset, act, saving }: { asset: AssetDef; act: (fn: () => Promise<unknown>, ok: string) => Promise<void>; saving: boolean }) {
  const [scale, setScale] = useState(asset.scale);
  useEffect(() => setScale(asset.scale), [asset.id, asset.scale]);
  const dirty = scale !== asset.scale;

  const save = () =>
    act(async () => {
      const doc = await api<AssetDef>(`/api/admin/assets/${asset.id}`);
      await api(`/api/admin/assets/${asset.id}`, { method: 'PUT', body: JSON.stringify({ ...doc, scale }) });
    }, `Đã lưu tỉ lệ ${scale.toFixed(2)}×`);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-ink/20 bg-white/60 p-2 text-xs">
      <b><Ruler /> Kích cỡ hiển thị</b>
      <input type="range" min={0.1} max={10} step={0.05} value={scale} className="flex-1" onChange={(e) => setScale(Number(e.target.value))} />
      <input type="number" min={0.1} max={10} step={0.05} value={scale} className="field w-16 py-0.5 text-xs" onChange={(e) => setScale(Number(e.target.value) || asset.scale)} />
      <span className="opacity-70">×</span>
      <button className="btn px-2 py-0.5 text-xs" disabled={saving || !dirty} onClick={() => void save()}>
        Lưu tỉ lệ
      </button>
    </div>
  );
}

/** Upload a real .glb/.gltf to replace this asset's procedural model outright (static-rig kinds: baked; rigid mounts like elephant: baked rigid, keeps body motion + saddle). */
function GlbUploadPanel({ asset, users, act, saving }: { asset: AssetDef; users: UnitDef[]; act: (fn: () => Promise<unknown>, ok: string) => Promise<void>; saving: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = (file: File) =>
    act(async () => {
      if (!/\.(glb|gltf)$/i.test(file.name)) throw new Error('Chỉ nhận .glb hoặc .gltf');
      const notes = users.length ? `Đổi model cho: ${users.map((u) => u.name).join(', ')}.` : 'Chưa lính nào dùng asset này.';
      if (!confirm(`Thay model của asset "${asset.name}" bằng file "${file.name}"?\n\n${notes}\n\nModel cũ (nếu là glb upload trước đó) sẽ bị xóa để tiết kiệm bộ nhớ.`)) throw new Error('Đã hủy');
      const form = new FormData();
      form.set('file', file);
      const res = await fetch(`/api/admin/assets/${asset.id}/glb`, { method: 'POST', body: form, cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error ?? res.statusText, (data as { details?: unknown })?.details);
    }, 'Đã thay model bằng file upload');

  const remove = () =>
    act(async () => {
      if (!confirm(`Xóa model upload của "${asset.name}" và hoàn tác về procedural?`)) throw new Error('Đã hủy');
      const res = await fetch(`/api/admin/assets/${asset.id}/glb`, { method: 'DELETE', cache: 'no-store' });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
    }, 'Đã xóa model upload');

  // Vercel has no writable disk: no new upload, only reverting one made before.
  if (IS_VERCEL && !asset.glb) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-ink/20 bg-white/60 p-2 text-xs">
      <b><Package /> Upload model (.glb/.gltf)</b>
      {asset.glb && (
        <span className="opacity-70">
          đang dùng: <b>{asset.glb.fileName}</b>
        </span>
      )}
      <input
        ref={fileInput}
        type="file"
        accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          try {
            await upload(file);
          } finally {
            setBusy(false);
          }
        }}
      />
      {!IS_VERCEL && (
        <button className="btn px-2 py-0.5 text-xs" disabled={saving || busy} onClick={() => fileInput.current?.click()}>
          {busy ? 'Đang tải lên…' : asset.glb ? 'Thay file khác' : 'Chọn file…'}
        </button>
      )}
      {asset.glb && (
        <button className="btn ml-auto px-2 py-0.5 text-xs" disabled={saving || busy} onClick={() => void remove()}>
          Hoàn tác về procedural
        </button>
      )}
    </div>
  );
}

/** Upload a skeletal .glb/.gltf for an animated kind: the file's clips (idle/walk/run/attack/death) play in battle. */
function SkinnedGlbUploadPanel({ asset, users, act, saving }: { asset: AssetDef; users: UnitDef[]; act: (fn: () => Promise<unknown>, ok: string) => Promise<void>; saving: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = (file: File) =>
    act(async () => {
      if (!/\.(glb|gltf)$/i.test(file.name)) throw new Error('Chỉ nhận .glb hoặc .gltf');
      const notes = users.length ? `Đổi model cho: ${users.map((u) => u.name).join(', ')}.` : 'Chưa lính nào dùng asset này.';
      if (!confirm(`Thay model của asset "${asset.name}" bằng file "${file.name}"?\n\n${notes}\n\nAnimation lấy từ file (idle/walk/run/attack/death). Model cũ (nếu là glb upload trước đó) sẽ bị xóa để tiết kiệm bộ nhớ.`)) throw new Error('Đã hủy');
      const form = new FormData();
      form.set('file', file);
      const res = await fetch(`/api/admin/assets/${asset.id}/glb`, { method: 'POST', body: form, cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error ?? res.statusText, (data as { details?: unknown })?.details);
    }, 'Đã thay model bằng file upload');

  const remove = () =>
    act(async () => {
      if (!confirm(`Xóa model upload của "${asset.name}" và hoàn tác về procedural?`)) throw new Error('Đã hủy');
      const res = await fetch(`/api/admin/assets/${asset.id}/glb`, { method: 'DELETE', cache: 'no-store' });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
    }, 'Đã xóa model upload');

  // Vercel has no writable disk: no new upload, only reverting one made before.
  if (IS_VERCEL && !asset.glb) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-ink/20 bg-white/60 p-2 text-xs">
      <b><Bone /> Upload model animated (.glb/.gltf)</b>
      {asset.glb && (
        <span className="opacity-70">
          đang dùng: <b>{asset.glb.fileName}</b>
        </span>
      )}
      <input
        ref={fileInput}
        type="file"
        accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          try {
            await upload(file);
          } finally {
            setBusy(false);
          }
        }}
      />
      {!IS_VERCEL && (
        <button className="btn px-2 py-0.5 text-xs" disabled={saving || busy} onClick={() => fileInput.current?.click()}>
          {busy ? 'Đang tải lên…' : asset.glb ? 'Thay file khác' : 'Chọn file…'}
        </button>
      )}
      {asset.glb && (
        <button className="btn ml-auto px-2 py-0.5 text-xs" disabled={saving || busy} onClick={() => void remove()}>
          Hoàn tác về procedural
        </button>
      )}
      <span className="w-full opacity-70">Trận đấu, khung xem thử và thẻ bài đều dùng model + animation từ file.</span>
    </div>
  );
}

function DownloadPanel({ sources }: { sources: Array<{ label: string; source: ExportSource }> }) {
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picked = sources[Math.min(index, sources.length - 1)];
  const sculpted = 'spec' in picked.source;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border-2 border-ink/20 bg-white/60 p-2">
      <b className="text-sm"><Download /> Tải về</b>
      {sources.length > 1 && (
        <select className="field py-0.5 text-xs" value={index} onChange={(e) => setIndex(Number(e.target.value))}>
          {sources.map((s, i) => (
            <option key={s.label} value={i}>
              {s.label}
            </option>
          ))}
        </select>
      )}
      <div className="flex flex-wrap gap-1.5">
        {EXPORT_FORMATS.filter((f) => sculpted || f.id !== 'json').map((f) => (
          <button
            key={f.id}
            className="btn px-2 py-0.5 text-xs"
            title={f.hint}
            disabled={busy !== null}
            onClick={async () => {
              setBusy(f.id);
              setError(null);
              try {
                await exportModel(f.id, picked.source);
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
      {error && <p className="text-xs font-bold text-red-team">{error}</p>}
    </div>
  );
}

interface ClaudeProps {
  bundle: ConfigBundle;
  asset: AssetDef;
  context?: { name: string; description: string };
  users: UnitDef[];
  setCandidate(c: Candidate | null): void;
  act(fn: () => Promise<unknown>, ok: string): Promise<void>;
  saving: boolean;
  onNewAsset?(id: string): void;
}

function ClaudePanel({ bundle, asset, context, users, setCandidate, act, saving, onNewAsset }: ClaudeProps) {
  const runner = useStudioRunner();
  const { engine, detail, run } = runner;
  const [picked, setPicked] = useState<number | 'off' | null>(null);
  const related = (j: { id: string; baseAssetId: string | null }) => j.baseAssetId === asset.id || asset.sculpt?.studioId === j.id;
  const jobs = runner.jobs.filter((j) => j.kind === asset.kind).sort((a, b) => Number(related(b)) - Number(related(a)) || b.updatedAt - a.updatedAt);
  const version = detail && picked !== 'off' ? (detail.versions.find((v) => v.n === picked) ?? detail.versions[detail.versions.length - 1] ?? null) : null;
  const running = Boolean(run) || detail?.status === 'running';

  useEffect(() => setPicked(null), [detail?.id, detail?.versions.length]);
  useEffect(() => {
    setCandidate(detail && version ? { assetId: asset.id, sculpt: { studioId: detail.id, version: version.n, spec: version.spec } } : null);
  }, [detail?.id, version?.n, asset.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setCandidate(null), [setCandidate]);

  return (
    <div className="flex flex-col gap-2 rounded-lg border-2 border-ink bg-parch/60 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <b><Sparkles /> Claude tối ưu model (img2threejs)</b>
        <EngineBadge engine={engine} />
      </div>
      <select className="field py-0.5 text-xs" value={runner.selected ?? ''} disabled={running} onChange={(e) => runner.select(e.target.value || null)}>
        <option value="">＋ Yêu cầu mới</option>
        {jobs.map((j) => (
          <option key={j.id} value={j.id}>
            {related(j) ? '★ ' : ''}
            {j.name} {j.latest ? `· v${j.latest.n}` : ''} {j.latest?.fidelity != null ? `· ${Math.round(j.latest.fidelity * 100)}%` : ''} {j.status === 'running' ? '· đang chạy' : j.status === 'error' ? '· lỗi' : ''}
          </option>
        ))}
      </select>
      {runner.message && <p className={`rounded border-2 px-2 py-1 text-xs ${runner.message.ok ? 'border-green-700 bg-green-50' : 'border-red-team bg-red-50'}`}>{runner.message.text}</p>}
      {!runner.selected ? (
        <RequestForm asset={asset} context={context} disabled={!engine?.active || Boolean(run)} onSubmit={(input) => runner.create(input)} />
      ) : !detail ? (
        <p className="text-xs">Đang tải…</p>
      ) : (
        <>
          <RunBar job={detail} run={run?.jobId === detail.id ? run : null} onStop={() => void runner.stop(detail.id)} />
          <p className="text-xs opacity-70">
            {detail.prompt || '(không có mô tả)'} · {detail.usage.calls} lượt gọi Claude
            {detail.usage.costUsd > 0 && ` · ≈ $${detail.usage.costUsd.toFixed(2)}`}
          </p>
          {detail.versions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <button className={`btn px-2 py-0.5 text-xs ${picked === 'off' ? 'btn-gold' : ''}`} onClick={() => setPicked('off')} title="Xem model hiện tại của asset">
                Hiện tại
              </button>
              {detail.versions.map((v) => (
                <button key={v.n} className={`btn gap-1 px-2 py-0.5 text-xs ${v.n === version?.n ? 'btn-gold' : ''}`} onClick={() => setPicked(v.n)}>
                  v{v.n}
                  <VerdictDot verdict={v.gates.verdict} />
                  {v.review && <span>{Math.round(v.review.fidelity * 100)}%</span>}
                </button>
              ))}
            </div>
          )}
          {version && (
            <VersionTools
              key={`${detail.id}-${version.n}`}
              bundle={bundle}
              job={detail}
              version={version}
              asset={asset}
              users={users}
              busy={running || saving}
              onRun={(feedback) => void runner.startRun(detail.id, { kind: 'review', version: version.n, feedback })}
              act={act}
              onNewAsset={onNewAsset}
            />
          )}
          <div className="flex flex-wrap gap-2">
            {!running && detail.versions.length === 0 && (
              <button className="btn btn-gold px-2 py-0.5 text-xs" disabled={Boolean(run)} onClick={() => void runner.startRun(detail.id, { kind: 'auto' })}>
                <Play /> Chạy
              </button>
            )}
            <button
              className="btn ml-auto px-2 py-0.5 text-xs"
              disabled={running}
              onClick={() => {
                if (confirm('Xóa yêu cầu này cùng mọi version? Asset đã áp dụng vẫn giữ bản sao model.')) void runner.remove(detail.id);
              }}
            >
              Xóa yêu cầu
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function EngineBadge({ engine }: { engine: ReturnType<typeof useStudioRunner>['engine'] }) {
  if (!engine) return <span className="text-xs opacity-60">kiểm tra engine…</span>;
  if (!engine.active)
    return (
      <span className="w-full rounded border-2 border-red-team bg-red-50 px-2 py-1 text-xs">
        Chưa có engine Claude: đặt <code>ANTHROPIC_API_KEY</code> hoặc cài + đăng nhập Claude Code CLI trên máy chủ.
      </span>
    );
  return (
    <span className="text-xs opacity-70">
      {engine.active === 'api' ? 'Claude API' : 'Claude Code CLI'} · <code>{engine.model}</code>
    </span>
  );
}

function RequestForm({ asset, context, disabled, onSubmit }: { asset: AssetDef; context?: { name: string; description: string }; disabled: boolean; onSubmit(input: Parameters<ReturnType<typeof useStudioRunner>['create']>[0]): Promise<unknown> }) {
  const [prompt, setPrompt] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [maxRounds, setMaxRounds] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const name = context?.name ?? asset.name;

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
    setSending(true);
    const brief = prompt.trim() || `Tạo lại mô hình "${name}" đẹp và chi tiết hơn, giữ đúng vai trò, dáng người và vũ khí của asset gốc.${context?.description ? ` Mô tả nhân vật: ${context.description}` : ''}`;
    try {
      await onSubmit({ name: name.slice(0, 48), kind: asset.kind, baseAssetId: asset.id, prompt: brief, image, maxRounds });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs opacity-70">Chưa ưng tạo hình? Claude viết sculpt spec mới dựa trên asset gốc (khớp rig + kiểu vũ khí), chạy gate, render 4 góc rồi tự so sánh và sửa. Kết quả xem thử ngay trong khung 3D trước khi áp dụng.</p>
      <textarea className="field min-h-20 text-sm" value={prompt} maxLength={4000} placeholder={`Góp ý / mô tả (tuỳ chọn). VD: ${name} giáp bạc, áo choàng đỏ, đầu to hơn, kiếm dài hơn`} onChange={(e) => setPrompt(e.target.value)} />
      <div
        className={`flex cursor-pointer items-center gap-2 rounded-lg border-2 border-dashed p-2 text-xs ${image ? 'border-ink bg-white' : 'border-ink/40 bg-white/50'}`}
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
            <img src={image} alt="Ảnh mẫu" className="h-16 rounded object-contain" />
            <button
              type="button"
              className="btn ml-auto px-2 py-0 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                setImage(null);
              }}
            >
              Bỏ ảnh
            </button>
          </>
        ) : (
          <span><ImageIcon /> Ảnh mẫu (tuỳ chọn): bấm chọn, kéo-thả hoặc dán (Ctrl/⌘+V)</span>
        )}
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span>Vòng tự so sánh & sửa</span>
        <span className="w-14">
          <select className="field py-0.5 text-xs" value={maxRounds} onChange={(e) => setMaxRounds(Number(e.target.value))}>
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </span>
        <button className="btn btn-gold ml-auto px-3 py-1 text-sm" disabled={disabled || sending} onClick={() => void submit()}>
          {sending ? 'Đang gửi…' : <><Sparkles /> Yêu cầu Claude generate lại</>}
        </button>
      </div>
      {error && <p className="text-xs font-bold text-red-team">{error}</p>}
    </div>
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
  if (!active) return job.status === 'error' && job.error ? <p className="rounded border-2 border-red-team bg-red-50 px-2 py-1 text-xs">Lần chạy trước lỗi: {job.error}</p> : null;
  const seconds = run ? Math.max(0, Math.round((now - run.startedAt) / 1000)) : null;
  const progress = run?.phase === 'thinking' ? `Claude đang suy nghĩ…${run.chars > 0 ? ` (${fmt(run.chars)} ký tự)` : ''}` : run?.phase === 'writing' ? `Claude đang viết… ${fmt(run.chars)} ký tự` : null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-ink bg-gold/30 px-2 py-1 text-xs">
      <LoaderCircle className="animate-spin" />
      <b>{run?.text ?? `Đang chạy trên máy chủ (${job.step ?? '…'})`}</b>
      {progress && <span className="opacity-80">{progress}</span>}
      {seconds !== null && (
        <span className="font-mono opacity-70">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
        </span>
      )}
      <button className="btn btn-red ml-auto px-2 py-0 text-xs" onClick={onStop}>
        Dừng
      </button>
    </div>
  );
}

interface VersionProps {
  bundle: ConfigBundle;
  job: StudioJobDetail;
  version: StudioVersion;
  asset: AssetDef;
  users: UnitDef[];
  busy: boolean;
  onRun(feedback: string | null): void;
  act(fn: () => Promise<unknown>, ok: string): Promise<void>;
  onNewAsset?(id: string): void;
}

function VersionTools({ bundle, job, version, asset, users, busy, onRun, act, onNewAsset }: VersionProps) {
  const [feedback, setFeedback] = useState('');
  const [newId, setNewId] = useState('');
  const blocked = version.gates.verdict === 'fail';
  const issues = version.gates.gates.filter((g) => g.level !== 'pass');
  const review = version.review;
  const stats = version.gates.stats;
  const sculpt = { studioId: job.id, version: version.n, spec: version.spec };

  const replace = () =>
    act(async () => {
      const doc = await api<AssetDef>(`/api/admin/assets/${asset.id}`);
      const notes = [users.length ? `Đổi model cho: ${users.map((u) => u.name).join(', ')}.` : 'Chưa có lính nào dùng asset này.', version.gates.verdict === 'warn' ? 'Gate còn cảnh báo.' : ''].filter(Boolean);
      if (!confirm(`Thay model của asset "${asset.name}" bằng v${version.n}?\n\n${notes.join('\n')}\n\nGame dùng model mới từ trận tiếp theo. Hoàn tác được bất cứ lúc nào.`)) throw new Error('Đã hủy');
      await api(`/api/admin/assets/${asset.id}`, { method: 'PUT', body: JSON.stringify({ ...doc, sculpt }) });
    }, 'Đã thay model');

  const createAsset = () =>
    act(async () => {
      if (bundle.assets.some((a) => a.id === newId)) throw new Error(`Đã có asset "${newId}"`);
      await api('/api/admin/assets', { method: 'POST', body: JSON.stringify({ id: newId, name: job.name, kind: asset.kind, scale: asset.scale, seed: asset.seed, params: asset.params, sculpt }) });
      onNewAsset?.(newId);
    }, `Đã tạo asset "${newId}" và gán cho lính — bấm Lưu để giữ thay đổi của lính`);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs opacity-70">
        Đang xem thử v{version.n} trong khung 3D
        {stats && ` · ${stats.triangles} tam giác · ${stats.parts} part · cao ${stats.height.toFixed(2)} m`}
      </p>
      <div className="rounded border border-ink/20 bg-white/60 p-1.5 text-xs">
        <b>Gate:</b> {{ pass: <><CircleCheck /> đạt</>, warn: <><TriangleAlert /> cảnh báo</>, fail: <><Ban /> chặn</> }[version.gates.verdict]}
        {issues.length > 0 && (
          <ul className="mt-0.5 list-disc pl-4">
            {issues.map((g) => (
              <li key={g.id}>
                <b>{g.label}</b>
                {g.details.length > 0 && ` — ${g.details.join(' · ')}`}
              </li>
            ))}
          </ul>
        )}
      </div>
      {review && (
        <div className="rounded border border-ink/20 bg-white/60 p-1.5 text-xs">
          <b>Claude tự đánh giá: {Math.round(review.fidelity * 100)}%</b> — {review.summary}
          {review.mismatches.length > 0 && (
            <ul className="mt-0.5 list-disc pl-4">
              {review.mismatches.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {version.notes && (
        <p className="text-xs">
          <b>Ghi chú của Claude:</b> {version.notes}
        </p>
      )}
      <textarea className="field min-h-14 text-sm" value={feedback} maxLength={2000} placeholder="Góp ý để sửa tiếp. VD: đầu to hơn 20%, khiên xanh dương, bỏ áo choàng" onChange={(e) => setFeedback(e.target.value)} />
      <div className="flex flex-wrap gap-1.5">
        <button className="btn btn-gold px-2 py-0.5 text-xs" disabled={busy || !feedback.trim()} onClick={() => onRun(feedback.trim())}>
          Sửa theo góp ý
        </button>
        <button className="btn px-2 py-0.5 text-xs" disabled={busy} onClick={() => onRun(null)} title="Render lại, Claude so sánh và tự sửa nếu cần">
          So sánh lại
        </button>
      </div>
      <div className="flex flex-col gap-1.5 border-t-2 border-ink/15 pt-2">
        <b className="text-xs">Dùng v{version.n} trong game</b>
        {blocked && <p className="text-xs font-bold text-red-team">Gate đang chặn version này — sửa trước khi dùng.</p>}
        <button className="btn btn-gold px-2 py-1 text-xs" disabled={blocked || busy} onClick={() => void replace()}>
          Thay model của asset “{asset.name}”{users.length > 1 ? ` (${users.length} lính)` : ''}
        </button>
        {onNewAsset && (
          <div className="flex gap-1.5">
            <input className="field py-0.5 text-xs" placeholder="id-asset-moi" value={newId} onChange={(e) => setNewId(e.target.value.toLowerCase())} />
            <button className="btn shrink-0 px-2 py-0.5 text-xs" disabled={blocked || busy || !newId} onClick={() => void createAsset()} title="Không đụng asset đang dùng chung, chỉ lính này đổi model">
              Tạo asset riêng cho lính này
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
