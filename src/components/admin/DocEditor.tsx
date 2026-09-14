'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ASSET_KINDS, type AssetDef, type AssetKind, type CollectionName, type ConfigBundle } from '@/shared/schema';
import { assetParamDefaults, COLLECTION_SPECS } from '@/shared/fields';
import { useConfig } from '@/game/useConfig';
import { api, ApiError, detailsToErrors } from './api';
import DocForm from './DocForm';
import { AssetPreview, BotTester, FactionPreview, MapPreview, ParticlePreview, ProjectilePreview, UnitPreview, WeaponPreview } from './Previews';

type Doc = Record<string, unknown>;

function isSculpted(doc: Doc | null): doc is Doc & { sculpt: NonNullable<AssetDef['sculpt']> } {
  return Boolean(doc && doc.sculpt);
}

/** `modelId` pre-selects the model of a new unit (e.g. an asset just made in the img2threejs studio). */
export default function DocEditor({ collection, id, from, modelId }: { collection: CollectionName; id: string; from?: string; modelId?: string }) {
  const router = useRouter();
  const spec = COLLECTION_SPECS[collection];
  const { bundle, reload } = useConfig();
  const isNew = id === 'new';
  const [doc, setDoc] = useState<Doc | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ ok: boolean; text: string; list?: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!isNew) {
          const d = await api<Doc>(`/api/admin/${collection}/${id}`);
          if (!cancelled) setDoc(d);
        } else if (from) {
          const d = await api<Doc>(`/api/admin/${collection}/${from}`);
          if (!cancelled) setDoc({ ...d, id: `${from}-copy`, name: `${String(d.name)} (bản sao)` });
        } else if (bundle && !cancelled) {
          const model = collection === 'units' ? bundle.assets.find((a) => a.id === modelId) : undefined;
          setDoc((prev) => prev ?? { ...spec.blank(bundle), ...(model && { modelId: model.id, name: model.name }) });
        }
      } catch (e) {
        if (!cancelled) setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [collection, id, from, modelId, isNew, bundle, spec]);

  const change = (next: Doc) => {
    if (collection === 'assets' && doc && next.kind !== doc.kind && (ASSET_KINDS as readonly string[]).includes(String(next.kind))) {
      next = { ...next, params: assetParamDefaults(next.kind as AssetKind) };
    }
    setDoc(next);
    setDirty(true);
  };

  const save = useCallback(async () => {
    if (!doc) return;
    setSaving(true);
    setErrors({});
    try {
      const saved = await api<Doc>(isNew ? `/api/admin/${collection}` : `/api/admin/${collection}/${id}`, { method: isNew ? 'POST' : 'PUT', body: JSON.stringify(doc) });
      setDoc(saved);
      setDirty(false);
      setStatus({ ok: true, text: 'Đã lưu ✓ — game sẽ dùng dữ liệu mới ở trận tiếp theo.' });
      await reload();
      if (isNew) router.replace(`/admin/c/${collection}/${String(saved.id)}`);
    } catch (e) {
      if (e instanceof ApiError) {
        const errs = detailsToErrors(e.details);
        setErrors(errs);
        setStatus({ ok: false, text: e.message, list: Object.entries(errs).map(([k, v]) => `${k}: ${v}`) });
      } else setStatus({ ok: false, text: String(e) });
    } finally {
      setSaving(false);
    }
  }, [doc, isNew, collection, id, reload, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const remove = async () => {
    if (!confirm(`Xóa ${collection}/${id}?`)) return;
    try {
      await api(`/api/admin/${collection}/${id}`, { method: 'DELETE' });
      await reload();
      router.push(`/admin/c/${collection}`);
    } catch (e) {
      if (e instanceof ApiError) setStatus({ ok: false, text: e.message, list: Array.isArray(e.details) ? (e.details as string[]) : undefined });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/admin/c/${collection}`} className="text-sm underline">
          {spec.icon} {spec.label}
        </Link>
        <span className="opacity-40">/</span>
        <h1 className="font-display text-xl">{isNew ? 'Tạo mới' : String(doc?.name ?? id)}</h1>
        {dirty && <span className="rounded bg-gold px-1.5 text-xs font-bold">chưa lưu</span>}
        <div className="ml-auto flex gap-2">
          {!isNew && (
            <>
              <Link className="btn px-3 py-1 text-sm" href={`/admin/c/${collection}/new?from=${id}`}>
                Nhân bản
              </Link>
              <button className="btn px-3 py-1 text-sm" onClick={() => void remove()}>
                Xóa
              </button>
            </>
          )}
          <button className="btn btn-gold px-4 py-1" disabled={!doc || saving} onClick={() => void save()} title="Ctrl/⌘ + S">
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </div>
      {status && (
        <div className={`rounded-lg border-2 px-3 py-2 text-sm ${status.ok ? 'border-green-700 bg-green-50' : 'border-red-team bg-red-50'}`}>
          <b>{status.text}</b>
          {status.list && (
            <ul className="mt-1 list-disc pl-5">
              {status.list.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {collection === 'assets' && isSculpted(doc) && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-ink bg-gold/30 px-3 py-2 text-sm">
          <span>
            🧪 Asset đang dùng model img2threejs <b>{doc.sculpt.spec.name}</b> (v{doc.sculpt.version}). Các tham số procedural bên dưới chỉ có tác dụng khi hoàn tác.
          </span>
          <Link className="underline" href={`/models?asset=${String(doc.id)}`}>
            Mở trong Xưởng mô hình
          </Link>
          <button className="btn ml-auto px-2 py-0.5 text-xs" onClick={() => change({ ...doc, sculpt: null })}>
            Hoàn tác về procedural
          </button>
        </div>
      )}
      {!doc ? (
        <p>Đang tải…</p>
      ) : (
        <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_440px]">
          <div className="panel p-4">
            <DocForm fields={spec.fields(doc)} doc={doc} onChange={change} bundle={bundle} errors={errors} isNew={isNew} />
          </div>
          <div className="xl:sticky xl:top-3">{bundle && <Preview collection={collection} doc={doc} bundle={bundle} />}</div>
        </div>
      )}
    </div>
  );
}

function Preview({ collection, doc, bundle }: { collection: CollectionName; doc: Doc; bundle: ConfigBundle }) {
  switch (collection) {
    case 'units':
      return <UnitPreview doc={doc} bundle={bundle} />;
    case 'assets':
      return <AssetPreview doc={doc} />;
    case 'particles':
      return <ParticlePreview doc={doc} />;
    case 'maps':
      return <MapPreview doc={doc} bundle={bundle} />;
    case 'bots':
      return <BotTester doc={doc} bundle={bundle} />;
    case 'weapons':
      return <WeaponPreview doc={doc} bundle={bundle} />;
    case 'projectiles':
      return <ProjectilePreview doc={doc} />;
    case 'factions':
      return <FactionPreview doc={doc} bundle={bundle} />;
  }
}
