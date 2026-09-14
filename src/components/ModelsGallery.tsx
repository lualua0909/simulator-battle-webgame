'use client';

// Model workshop (/models): everyone can browse units, abilities and assets in the turntable
// or the practice arena. Root/admin also get the editing panel — unit stats, abilities, price,
// model download and Claude img2threejs regeneration — previewed live from unsaved drafts.
import Link from 'next/link';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { Object3D } from 'three';
import { COLLECTION_SPECS, ENUM_LABELS } from '@/shared/fields';
import { CHEST_VARIANTS, unitSchema, weaponSchema, type ChestVariant, type UnitDef, type WeaponDef } from '@/shared/schema';
import { canAccessCms } from '@/shared/users';
import { abilityCaster } from '@/game/arena';
import { bakeModel, type ModelTemplate } from '@/game/models/bake';
import { createAssetModel, createUnitModel } from '@/game/models';
import { useConfig } from '@/game/useConfig';
import { useAuth } from './auth/AuthProvider';
import AbilityForm from './models/AbilityForm';
import { AssetModelTools, withCandidate, type Candidate } from './models/ModelTools';
import UnitEditor from './models/UnitEditor';
import { api, ApiError } from './admin/api';
import ModelViewer, { type PreviewAnim } from './ModelViewer';
import ChestStage from './player/ChestStage';
import SkillArena from './SkillArena';

interface Props {
  /** Unit id, or "new" to create one (optionally copying `from` / using `modelId`). */
  initialUnit?: string;
  initialAsset?: string;
  /** Ability id: show it in the practice arena. */
  initialSkill?: string;
  /** Reward chest look to preview; `chestOpen` starts it open. */
  initialChest?: ChestVariant;
  chestOpen?: boolean;
  from?: string;
  modelId?: string;
  /** Show the selected unit fighting training dummies instead of the turntable. */
  arena?: boolean;
  yaw?: number;
  explode: boolean;
  anim: PreviewAnim;
  bare: boolean;
}

type Selection = { unit?: string; asset?: string; skill?: string; chest?: ChestVariant };

function tryBake(build: () => Object3D): ModelTemplate | null {
  try {
    return bakeModel(build());
  } catch (e) {
    console.warn('preview failed', e);
    return null;
  }
}

/** `value` once it has stopped changing for `ms` (the arena restarts a whole battle engine). */
function useSettled<T>(value: T, ms = 700): T {
  const [settled, setSettled] = useState(value);
  const key = JSON.stringify(value);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(JSON.parse(key) as T), ms);
    return () => window.clearTimeout(t);
  }, [key, ms]);
  return settled;
}

export default function ModelsGallery(props: Props) {
  const { bundle, error, reload } = useConfig();
  const { user } = useAuth();
  const admin = canAccessCms(user) && !props.bare;
  const [sel, setSel] = useState<Selection>({ unit: props.initialUnit, asset: props.initialAsset, skill: props.initialSkill, chest: props.initialChest });
  const [chestOpen, setChestOpen] = useState(!!props.chestOpen);
  const [arena, setArena] = useState(!!props.arena);
  const [anim, setAnim] = useState<PreviewAnim>(props.anim);
  const [explode, setExplode] = useState(props.explode);
  const [picked, setPicked] = useState<string | null>(null);
  // Admin drafts (unsaved). A null unit draft means "same as saved".
  const [unitDraft, setUnitDraft] = useState<UnitDef | null>(null);
  const [skillDrafts, setSkillDrafts] = useState<Record<string, WeaponDef>>({});
  const [candidate, setCandidate] = useState<Candidate | null>(null);

  const creating = sel.unit === 'new';
  const savedUnit = bundle?.units.find((u) => u.id === (sel.unit ?? (!sel.asset && !sel.skill && !sel.chest ? bundle.units[0]?.id : undefined))) ?? null;
  const skill = sel.skill ? bundle?.weapons.find((w) => w.id === sel.skill) : undefined;
  const assetDef = sel.asset ? bundle?.assets.find((a) => a.id === sel.asset) : undefined;
  const dirty = unitDraft !== null || Object.keys(skillDrafts).length > 0;

  // A new unit starts from a blank, a copy (`from`) or a given model (`modelId`).
  useEffect(() => {
    if (!bundle || !creating || unitDraft) return;
    const src = props.from ? bundle.units.find((u) => u.id === props.from) : undefined;
    const model = props.modelId ? bundle.assets.find((a) => a.id === props.modelId) : undefined;
    const blank = COLLECTION_SPECS.units.blank(bundle) as unknown as UnitDef;
    setUnitDraft(src ? { ...src, id: `${src.id}-copy`, name: `${src.name} (bản sao)` } : { ...blank, ...(model && { modelId: model.id, name: model.name }) });
  }, [bundle, creating, unitDraft, props.from, props.modelId]);

  const unit = creating ? unitDraft : (unitDraft ?? savedUnit);
  const deferredUnit = useDeferredValue(unit);
  const assetList = useMemo(() => withCandidate(bundle?.assets ?? [], candidate), [bundle, candidate]);
  const assets = useMemo(() => new Map(assetList.map((a) => [a.id, a])), [assetList]);
  const weapons = useMemo(() => (bundle?.weapons ?? []).map((w) => skillDrafts[w.id] ?? w), [bundle, skillDrafts]);
  const skillIds = useMemo(() => new Set((bundle?.units ?? []).flatMap((u) => u.skillIds)), [bundle]);
  const weapon = unit ? weapons.find((w) => w.id === unit.weaponId) : undefined;
  const asset = assetDef ? assets.get(assetDef.id) : undefined;

  const modelKey = JSON.stringify([asset ?? null, deferredUnit && !asset ? [assets.get(deferredUnit.modelId), deferredUnit.riderModelId ? assets.get(deferredUnit.riderModelId) : null] : null]);
  const template = useMemo(() => {
    if (asset) return tryBake(() => createAssetModel(asset));
    if (deferredUnit && !skill) return tryBake(() => createUnitModel(deferredUnit, assets));
    return null;
  }, [modelKey, skill]); // eslint-disable-line react-hooks/exhaustive-deps

  // The arena runs the real engine on the drafts: settle them so typing does not restart it every key.
  const arenaBundle = useMemo(() => (bundle ? { ...bundle, assets: assetList, version: `${bundle.version}|${candidate ? `${candidate.assetId}@${candidate.sculpt.studioId}v${candidate.sculpt.version}` : ''}` } : null), [bundle, assetList, candidate]);
  const parsedUnit = unit ? unitSchema.safeParse({ ...unit, id: unit.id || 'draft' }) : null;
  const fighter = useSettled(parsedUnit?.success ? parsedUnit.data : null);
  const abilities = useSettled(Object.values(skillDrafts).flatMap((w) => (weaponSchema.safeParse(w).success ? [{ ...w, initialCooldown: Math.min(w.initialCooldown, 0.8) }] : [])));
  const skillDraft = skill ? (skillDrafts[skill.id] ?? skill) : undefined;
  const settledSkill = useSettled(skillDraft && weaponSchema.safeParse(skillDraft).success ? skillDraft : null);
  const practice = useMemo(() => (bundle && settledSkill ? abilityCaster(bundle, settledSkill, skillIds.has(settledSkill.id)) : null), [bundle, settledSkill, skillIds]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (error) return <p className="p-6 text-red-700">Lỗi tải cấu hình: {error}</p>;
  if (!bundle || !arenaBundle) return <p className="p-6">Đang tải…</p>;

  const select = (next: Selection) => {
    if (dirty && !confirm('Bỏ các thay đổi chưa lưu?')) return;
    setUnitDraft(null);
    setSkillDrafts({});
    setCandidate(null);
    setPicked(null);
    setChestOpen(false);
    setSel(next);
    const q = next.unit ? `unit=${next.unit}` : next.skill ? `skill=${next.skill}` : next.asset ? `asset=${next.asset}` : next.chest ? `chest=${next.chest}` : '';
    window.history.replaceState(null, '', q ? `/models?${q}` : '/models');
  };

  const viewer = sel.chest ? (
    <ChestStage variant={sel.chest} mode={chestOpen ? 'open' : 'idle'} />
  ) : skill ? (
    practice ? <SkillArena bundle={arenaBundle} caster={practice.caster} abilities={practice.abilities} /> : <p className="p-4 text-sm">Dữ liệu kỹ năng chưa hợp lệ</p>
  ) : arena && unit && !asset ? (
    fighter ? <SkillArena bundle={arenaBundle} caster={fighter} abilities={abilities} /> : <p className="p-4 text-sm">Dữ liệu lính chưa hợp lệ</p>
  ) : (
    <ModelViewer template={template} weapon={weapon} anim={anim} yaw={props.yaw} explode={explode} onPick={setPicked} />
  );
  if (props.bare) return <div className="h-screen w-screen">{viewer}</div>;

  const item = (active: boolean, onClick: () => void, children: React.ReactNode) => (
    <button className={`w-full rounded px-2 py-1 text-left hover:bg-white ${active ? 'bg-white font-bold' : ''}`} onClick={onClick}>
      {children}
    </button>
  );

  return (
    <div className="flex h-screen">
      <aside className="w-64 shrink-0 overflow-y-auto border-r-2 border-ink bg-parch p-3">
        <div className="flex items-baseline justify-between gap-2">
          <Link href="/" className="font-display text-lg">
            ← Đại Chiến Lô Nhô
          </Link>
          {admin && (
            <Link href="/admin" className="text-xs underline">
              CMS
            </Link>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <h2 className="font-display text-sm">Lính</h2>
          {admin && (
            <button className="btn px-2 py-0 text-xs" onClick={() => select({ unit: 'new' })}>
              + Lính mới
            </button>
          )}
        </div>
        <ul className="mt-1 space-y-0.5 text-sm">
          {creating && <li>{item(true, () => undefined, '✏️ Lính mới')}</li>}
          {bundle.units.map((u) => (
            <li key={u.id}>{item(!creating && savedUnit?.id === u.id && !asset && !skill, () => select({ unit: u.id }), u.name)}</li>
          ))}
        </ul>
        <h2 className="mt-3 font-display text-sm">Kỹ năng & đòn đánh</h2>
        <ul className="mt-1 space-y-0.5 text-sm">
          {[...bundle.weapons]
            .sort((a, b) => Number(skillIds.has(b.id)) - Number(skillIds.has(a.id)))
            .map((w) => (
              <li key={w.id}>
                {item(
                  skill?.id === w.id,
                  () => select({ skill: w.id }),
                  <>
                    {skillIds.has(w.id) ? '✨ ' : ''}
                    {w.name} <span className="text-xs opacity-60">({ENUM_LABELS[w.attack] ?? w.attack})</span>
                  </>,
                )}
              </li>
            ))}
        </ul>
        <h2 className="mt-3 font-display text-sm">Hộp quà</h2>
        <ul className="mt-1 space-y-0.5 text-sm">
          {CHEST_VARIANTS.map((v) => (
            <li key={v}>{item(sel.chest === v, () => select({ chest: v }), ENUM_LABELS[v])}</li>
          ))}
        </ul>
        <h2 className="mt-3 font-display text-sm">Asset</h2>
        <ul className="mt-1 space-y-0.5 text-sm">
          {bundle.assets.map((a) => (
            <li key={a.id}>
              {item(
                asset?.id === a.id,
                () => select({ asset: a.id }),
                <>
                  {a.sculpt ? '🧪 ' : ''}
                  {a.name} <span className="text-xs opacity-60">({a.kind})</span>
                </>,
              )}
            </li>
          ))}
        </ul>
      </aside>
      <main className="relative min-w-0 flex-1">
        {viewer}
        <div className="panel absolute left-3 top-3 flex flex-wrap items-center gap-2 p-2 text-sm">
          {sel.chest && (
            <button className={`btn px-2 py-1 text-xs ${chestOpen ? 'btn-gold' : ''}`} onClick={() => setChestOpen((o) => !o)}>
              {chestOpen ? '↺ Đóng lại' : '✨ Mở thử'}
            </button>
          )}
          {unit && !asset && !skill && (
            <button className={`btn px-2 py-1 text-xs ${arena ? 'btn-gold' : ''}`} onClick={() => setArena((a) => !a)}>
              ⚔️ Đấu thử
            </button>
          )}
          {!skill && !sel.chest && !(arena && unit && !asset) && (
            <>
              {(['idle', 'walk', 'attack'] as const).map((a) => (
                <button key={a} className={`btn px-2 py-1 text-xs ${anim === a ? 'btn-gold' : ''}`} onClick={() => setAnim(a)}>
                  {a === 'idle' ? 'Đứng' : a === 'walk' ? 'Đi' : 'Đánh'}
                </button>
              ))}
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={explode} onChange={(e) => setExplode(e.target.checked)} /> Tách rời
              </label>
              <span className="opacity-70">{template ? `${template.parts.length} part` : ''}</span>
            </>
          )}
          {picked && <span className="rounded bg-white px-2 py-0.5 font-mono text-xs">{picked}</span>}
        </div>
        {candidate && <div className="absolute bottom-3 left-3 rounded-lg border-2 border-ink bg-gold px-3 py-1 text-sm font-bold">🧪 Đang xem thử v{candidate.sculpt.version} của Claude — chưa áp dụng</div>}
        {dirty && <div className="absolute right-3 top-3 rounded-lg border-2 border-ink bg-white px-2 py-1 text-xs font-bold">Xem trước bản nháp chưa lưu</div>}
      </main>
      {admin && (
        <aside className="w-[27rem] shrink-0 overflow-y-auto border-l-2 border-ink bg-parch p-3">
          {unit && !asset && !skill ? (
            <UnitEditor
              key={creating ? 'new' : savedUnit?.id}
              bundle={bundle}
              reload={reload}
              saved={creating ? null : savedUnit}
              draft={unit}
              setDraft={setUnitDraft}
              skillDrafts={skillDrafts}
              setSkillDrafts={setSkillDrafts}
              candidate={candidate}
              setCandidate={setCandidate}
              onSaved={(id) => {
                setSel({ unit: id });
                window.history.replaceState(null, '', `/models?unit=${id}`);
              }}
              onDuplicate={() => {
                if (Object.keys(skillDrafts).length && !confirm('Bỏ các thay đổi kỹ năng chưa lưu?')) return;
                setSkillDrafts({});
                setCandidate(null);
                setSel({ unit: 'new' });
                setUnitDraft({ ...unit, id: `${unit.id}-copy`, name: `${unit.name} (bản sao)` });
                window.history.replaceState(null, '', '/models?unit=new');
              }}
              onDeleted={() => {
                setUnitDraft(null);
                setSkillDrafts({});
                setSel({});
                window.history.replaceState(null, '', '/models');
              }}
            />
          ) : skill ? (
            <SkillPanel key={skill.id} skill={skill} draft={skillDrafts[skill.id]} setDraft={(w) => setSkillDrafts(w ? { [skill.id]: w } : {})} bundle={bundle} reload={reload} />
          ) : sel.chest ? (
            <div className="flex flex-col gap-2 text-sm">
              <h2 className="font-display text-lg leading-tight">{ENUM_LABELS[sel.chest]}</h2>
              <p>Rương của hộp quà người chơi mở (mô hình procedural theo chuẩn img2threejs: part `base`, `lid` bản lề sau, socket `glow`). Bấm ✨ Mở thử để xem hiệu ứng mở.</p>
              <p>
                Đang dùng cho:{' '}
                <b>{[bundle.settings.economy.dailyBox.chest === sel.chest && 'hộp hằng ngày', bundle.settings.economy.hourlyBox.chest === sel.chest && `hộp ${bundle.settings.economy.boxHours} giờ`].filter(Boolean).join(', ') || 'chưa dùng'}</b>
                . Đổi rương và phần thưởng trong{' '}
                <Link href="/admin/settings" className="underline">
                  Cài đặt
                </Link>
                .
              </p>
            </div>
          ) : assetDef ? (
            <div className="flex flex-col gap-3">
              <h2 className="font-display text-lg leading-tight">{assetDef.name}</h2>
              <AssetModelTools key={assetDef.id} bundle={bundle} reload={reload} asset={assetDef} candidate={candidate} setCandidate={setCandidate} />
            </div>
          ) : null}
        </aside>
      )}
    </div>
  );
}

function SkillPanel({ skill, draft, setDraft, bundle, reload }: { skill: WeaponDef; draft: WeaponDef | undefined; setDraft(w: WeaponDef | undefined): void; bundle: NonNullable<ReturnType<typeof useConfig>['bundle']>; reload(): Promise<void> }) {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setStatus(null);
    try {
      await api(`/api/admin/weapons/${skill.id}`, { method: 'PUT', body: JSON.stringify(draft) });
      await reload();
      setDraft(undefined);
      setStatus({ ok: true, text: 'Đã lưu ✓' });
    } catch (e) {
      const details = e instanceof ApiError && Array.isArray(e.details) ? `: ${(e.details as Array<{ path?: string; message?: string }>).map((d) => `${d.path ?? ''} ${d.message ?? ''}`).join(', ')}` : '';
      setStatus({ ok: false, text: `${e instanceof Error ? e.message : String(e)}${details}` });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="font-display text-lg leading-tight">{skill.name}</h2>
        <button className="btn btn-gold ml-auto px-3 py-0.5 text-sm" disabled={!draft || saving} onClick={() => void save()}>
          {saving ? 'Đang lưu…' : 'Lưu'}
        </button>
      </div>
      {status && <p className={`text-sm font-bold ${status.ok ? 'text-green-700' : 'text-red-team'}`}>{status.text}</p>}
      <AbilityForm bundle={bundle} saved={skill} draft={draft} onChange={setDraft} />
    </div>
  );
}
