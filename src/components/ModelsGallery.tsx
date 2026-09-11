'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { bakeModel } from '@/game/models/bake';
import { createAssetModel, getUnitTemplate } from '@/game/models';
import { useConfig } from '@/game/useConfig';
import ModelViewer, { type PreviewAnim } from './ModelViewer';

interface Props {
  initialUnit?: string;
  initialAsset?: string;
  yaw?: number;
  explode: boolean;
  anim: PreviewAnim;
  bare: boolean;
}

export default function ModelsGallery(props: Props) {
  const { bundle, error } = useConfig();
  const [sel, setSel] = useState<{ unit?: string; asset?: string }>({ unit: props.initialUnit, asset: props.initialAsset });
  const [anim, setAnim] = useState<PreviewAnim>(props.anim);
  const [explode, setExplode] = useState(props.explode);
  const [picked, setPicked] = useState<string | null>(null);

  const assets = useMemo(() => new Map((bundle?.assets ?? []).map((a) => [a.id, a])), [bundle]);
  const unit = bundle?.units.find((u) => u.id === (sel.unit ?? (!sel.asset ? bundle.units[0]?.id : undefined)));
  const asset = sel.asset ? assets.get(sel.asset) : undefined;
  const weapon = unit ? bundle?.weapons.find((w) => w.id === unit.weaponId) : undefined;

  const template = useMemo(() => {
    if (!bundle) return null;
    if (asset) return bakeModel(createAssetModel(asset));
    if (unit) return getUnitTemplate(unit, assets);
    return null;
  }, [bundle, asset, unit, assets]);

  if (error) return <p className="p-6 text-red-700">Lỗi tải cấu hình: {error}</p>;
  if (!bundle) return <p className="p-6">Đang tải…</p>;

  const viewer = <ModelViewer template={template} weapon={weapon} anim={anim} yaw={props.yaw} explode={explode} onPick={setPicked} />;
  if (props.bare) return <div className="h-screen w-screen">{viewer}</div>;

  return (
    <div className="flex h-screen">
      <aside className="w-72 shrink-0 overflow-y-auto border-r-2 border-ink bg-parch p-3">
        <Link href="/" className="font-display text-lg">
          ← Đại Chiến Lô Nhô
        </Link>
        <h2 className="mt-3 font-display text-sm">Lính</h2>
        <ul className="mt-1 space-y-0.5 text-sm">
          {bundle.units.map((u) => (
            <li key={u.id}>
              <button className={`w-full rounded px-2 py-1 text-left hover:bg-white ${unit?.id === u.id && !asset ? 'bg-white font-bold' : ''}`} onClick={() => setSel({ unit: u.id })}>
                {u.name}
              </button>
            </li>
          ))}
        </ul>
        <h2 className="mt-3 font-display text-sm">Asset</h2>
        <ul className="mt-1 space-y-0.5 text-sm">
          {bundle.assets.map((a) => (
            <li key={a.id}>
              <button className={`w-full rounded px-2 py-1 text-left hover:bg-white ${asset?.id === a.id ? 'bg-white font-bold' : ''}`} onClick={() => setSel({ asset: a.id })}>
                {a.name} <span className="text-xs opacity-60">({a.kind})</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <main className="relative flex-1">
        {viewer}
        <div className="panel absolute left-3 top-3 flex flex-wrap items-center gap-2 p-2 text-sm">
          {(['idle', 'walk', 'attack'] as const).map((a) => (
            <button key={a} className={`btn px-2 py-1 text-xs ${anim === a ? 'btn-gold' : ''}`} onClick={() => setAnim(a)}>
              {a === 'idle' ? 'Đứng' : a === 'walk' ? 'Đi' : 'Đánh'}
            </button>
          ))}
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={explode} onChange={(e) => setExplode(e.target.checked)} /> Tách rời
          </label>
          <span className="opacity-70">{template ? `${template.parts.length} part` : ''}</span>
          {picked && <span className="rounded bg-white px-2 py-0.5 font-mono text-xs">{picked}</span>}
        </div>
      </main>
    </div>
  );
}
