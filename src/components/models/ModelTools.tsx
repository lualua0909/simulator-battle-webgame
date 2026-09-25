'use client';

// Model tools of the workshop: scale, .glb upload, recolour and download (TypeScript / GLB / OBJ…).
import { Bone, Check, Download, Package, Ruler } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createAssetModel, createUnitModel } from '@/game/models';
import { IS_VERCEL } from '@/shared/deploy';
import { COLLECTION_SPECS } from '@/shared/fields';
import { RIG_OF_KIND, RIGID_GLB_KINDS, SKINNED_GLB_KINDS, type AssetDef, type ConfigBundle, type UnitDef } from '@/shared/schema';
import { api, ApiError } from '../admin/api';
import DocForm from '../admin/DocForm';
import TintEditor from './TintEditor';
import { EXPORT_FORMATS, exportModel, type ExportFormat, type ExportSource } from './exporters';

type Doc = Record<string, unknown>;

interface ModelTabProps {
  bundle: ConfigBundle;
  reload(): Promise<void>;
  unit: UnitDef;
  setUnit(unit: UnitDef): void;
  errors: Record<string, string>;
}

export default function ModelTab({ bundle, reload, unit, setUnit, errors }: ModelTabProps) {
  const [target, setTarget] = useState<'modelId' | 'riderModelId'>('modelId');
  const field = target === 'riderModelId' && unit.riderModelId ? 'riderModelId' : 'modelId';
  const asset = bundle.assets.find((a) => a.id === unit[field]);
  const fields = COLLECTION_SPECS.units.fields(unit as unknown as Doc).filter((f) => 'key' in f && (f.key === 'modelId' || f.key === 'riderModelId'));
  const whole: ExportSource = { name: unit.name, build: () => createUnitModel(unit, new Map(bundle.assets.map((a) => [a.id, a]))) };

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
          extraSources={unit.riderModelId ? [{ label: `Cả lính (${unit.name})`, source: whole }] : []}
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
  extraSources?: Array<{ label: string; source: ExportSource }>;
  /** Gallery context: asset was deleted, clear the selection. */
  onDeleted?(): void;
}

export function AssetModelTools({ bundle, reload, asset, extraSources = [], onDeleted }: ToolsProps) {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const users = bundle.units.filter((u) => u.modelId === asset.id || u.riderModelId === asset.id);

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

  const remove = () =>
    act(async () => {
      if (!confirm(`Xóa hẳn asset "${asset.name}"? Không hoàn tác được.`)) throw new Error('Đã hủy');
      if (asset.glb) await fetch(`/api/admin/assets/${asset.id}/glb`, { method: 'DELETE', cache: 'no-store' });
      await api(`/api/admin/assets/${asset.id}`, { method: 'DELETE' });
      onDeleted?.();
    }, 'Đã xóa asset');

  const sources: Array<{ label: string; source: ExportSource }> = [
    { label: `${asset.name} (procedural)`, source: { name: asset.name, build: () => createAssetModel(asset) } },
    ...extraSources,
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-ink/20 bg-white/60 p-2 text-sm">
        <span>
          <b>{asset.name}</b> <span className="text-xs opacity-60">({asset.id})</span> · preset procedural
        </span>
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

/** Display scale of the 3D model (independent of the underlying procedural/glb source). */
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

/** Upload a real .glb/.gltf to replace this asset's procedural model outright (static-rig kinds: baked to one mesh). */
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
