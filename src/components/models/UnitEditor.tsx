'use client';

// Admin side panel of the model workshop for one unit: stats, abilities, price and model.
// Every edit is a draft previewed live in the workshop viewer; "Lưu" writes the changed
// abilities first (the unit references them), then the unit.
import { useCallback, useEffect, useState } from 'react';
import { unitPower } from '@/game/bot/generate';
import { COLLECTION_SPECS, ENUM_LABELS } from '@/shared/fields';
import type { ConfigBundle, UnitDef, WeaponDef } from '@/shared/schema';
import { api, ApiError, detailsToErrors } from '../admin/api';
import DocForm from '../admin/DocForm';
import AbilityForm from './AbilityForm';
import ModelTab, { type Candidate } from './ModelTools';

type Doc = Record<string, unknown>;
type Tab = 'stats' | 'skills' | 'price' | 'model';

const TABS: Array<[Tab, string]> = [
  ['stats', '📊 Thông số'],
  ['skills', '⚡ Kỹ năng'],
  ['price', '💰 Giá'],
  ['model', '🧱 Mô hình'],
];

/** Fields owned by other tabs. */
const ELSEWHERE = new Set(['cost', 'weaponId', 'skillIds', 'modelId', 'riderModelId']);

interface Props {
  bundle: ConfigBundle;
  reload(): Promise<void>;
  /** Saved document; null while creating a unit. */
  saved: UnitDef | null;
  draft: UnitDef;
  setDraft(unit: UnitDef | null): void;
  skillDrafts: Record<string, WeaponDef>;
  setSkillDrafts(drafts: Record<string, WeaponDef>): void;
  candidate: Candidate | null;
  setCandidate(c: Candidate | null): void;
  onSaved(id: string): void;
  onDuplicate(): void;
  onDeleted(): void;
}

export default function UnitEditor(props: Props) {
  const { bundle, reload, saved, draft, setDraft, skillDrafts, setSkillDrafts } = props;
  const [tab, setTab] = useState<Tab>('stats');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ ok: boolean; text: string; list?: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const isNew = !saved;
  const unitDirty = isNew || JSON.stringify(saved) !== JSON.stringify(draft);
  const dirty = unitDirty || Object.keys(skillDrafts).length > 0;
  const change = (doc: Doc) => setDraft(doc as unknown as UnitDef);

  const save = useCallback(async () => {
    setSaving(true);
    setErrors({});
    setStatus(null);
    let step = '';
    try {
      for (const w of Object.values(skillDrafts)) {
        step = `Kỹ năng "${w.name}"`;
        await api(`/api/admin/weapons/${w.id}`, { method: 'PUT', body: JSON.stringify(w) });
      }
      step = '';
      const out = unitDirty ? await api<UnitDef>(isNew ? '/api/admin/units' : `/api/admin/units/${saved.id}`, { method: isNew ? 'POST' : 'PUT', body: JSON.stringify(draft) }) : saved!;
      await reload();
      setSkillDrafts({});
      setDraft(null);
      setStatus({ ok: true, text: 'Đã lưu ✓ — game dùng dữ liệu mới từ trận tiếp theo.' });
      props.onSaved(out.id);
    } catch (e) {
      if (e instanceof ApiError) {
        const errs = detailsToErrors(e.details);
        if (!step) setErrors(errs);
        setStatus({ ok: false, text: step ? `${step}: ${e.message}` : e.message, list: Object.entries(errs).map(([k, v]) => `${k}: ${v}`) });
      } else setStatus({ ok: false, text: String(e) });
    } finally {
      setSaving(false);
    }
  }, [skillDrafts, unitDirty, isNew, saved, draft, reload, setSkillDrafts, setDraft, props]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (dirty) void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, dirty]);

  const remove = async () => {
    if (!saved || !confirm(`Xóa lính "${saved.name}"?`)) return;
    try {
      await api(`/api/admin/units/${saved.id}`, { method: 'DELETE' });
      await reload();
      props.onDeleted();
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e), list: e instanceof ApiError && Array.isArray(e.details) ? e.details.map(String) : undefined });
    }
  };

  const fields = COLLECTION_SPECS.units.fields(draft as unknown as Doc).filter((f) => !('key' in f) || !ELSEWHERE.has(f.key));
  // Drop section headers left without fields.
  const statFields = fields.filter((f, i) => f.type !== 'section' || (fields[i + 1] && fields[i + 1].type !== 'section'));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg leading-tight">{isNew ? 'Lính mới' : draft.name}</h2>
        {dirty && !isNew && <span className="rounded bg-gold px-1.5 text-xs font-bold">chưa lưu</span>}
        <div className="ml-auto flex gap-1.5">
          {!isNew && (
            <>
              <button className="btn px-2 py-0.5 text-xs" onClick={props.onDuplicate}>
                Nhân bản
              </button>
              <button className="btn px-2 py-0.5 text-xs" onClick={() => void remove()}>
                Xóa
              </button>
            </>
          )}
          <button className="btn btn-gold px-3 py-0.5 text-sm" disabled={!dirty || saving} onClick={() => void save()} title="Ctrl/⌘ + S">
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </div>
      {status && (
        <div className={`rounded-lg border-2 px-3 py-2 text-sm ${status.ok ? 'border-green-700 bg-green-50' : 'border-red-team bg-red-50'}`}>
          <b>{status.text}</b>
          {status.list && status.list.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {status.list.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex gap-1 border-b-2 border-ink/15">
        {TABS.map(([id, label]) => (
          <button key={id} className={`-mb-0.5 rounded-t-lg border-2 px-2 py-1 text-xs font-bold ${tab === id ? 'border-ink/15 border-b-parch bg-parch' : 'border-transparent opacity-70 hover:opacity-100'}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'stats' && <DocForm fields={statFields} doc={draft as unknown as Doc} onChange={change} bundle={bundle} errors={errors} isNew={isNew} compact />}
      {tab === 'skills' && <SkillsTab bundle={bundle} draft={draft} setDraft={setDraft} skillDrafts={skillDrafts} setSkillDrafts={setSkillDrafts} errors={errors} />}
      {tab === 'price' && <PriceTab bundle={bundle} draft={draft} setDraft={setDraft} skillDrafts={skillDrafts} errors={errors} />}
      {tab === 'model' && <ModelTab bundle={bundle} reload={reload} unit={draft} setUnit={setDraft} errors={errors} candidate={props.candidate} setCandidate={props.setCandidate} />}
    </div>
  );
}

function SkillsTab({ bundle, draft, setDraft, skillDrafts, setSkillDrafts, errors }: Pick<Props, 'bundle' | 'draft' | 'setDraft' | 'skillDrafts' | 'setSkillDrafts'> & { errors: Record<string, string> }) {
  const [open, setOpen] = useState<string | null>(null);
  const weapons = new Map(bundle.weapons.map((w) => [w.id, w]));
  const setSkill = (id: string, w: WeaponDef | undefined) => {
    const next = { ...skillDrafts };
    if (w) next[id] = w;
    else delete next[id];
    setSkillDrafts(next);
  };
  const setSkills = (skillIds: string[]) => setDraft({ ...draft, skillIds });
  const label = (w: WeaponDef) => `${skillDrafts[w.id]?.name ?? w.name} (${ENUM_LABELS[w.attack] ?? w.attack})`;

  const row = (id: string, tools: React.ReactNode) => {
    const w = weapons.get(id);
    if (!w) return <p className="text-xs text-red-team">Không có kỹ năng "{id}"</p>;
    return (
      <>
        <div className="flex items-center gap-1.5 text-sm">
          <span className="min-w-0 flex-1 truncate">
            {label(w)}
            {skillDrafts[id] && <span className="ml-1 rounded bg-gold px-1 text-[10px] font-bold">đã sửa</span>}
          </span>
          {tools}
          <button className={`btn px-2 py-0 text-xs ${open === id ? 'btn-gold' : ''}`} onClick={() => setOpen(open === id ? null : id)}>
            Sửa chỉ số
          </button>
        </div>
        {open === id && <AbilityForm bundle={bundle} saved={w} draft={skillDrafts[id]} onChange={(next) => setSkill(id, next)} />}
      </>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <section className="flex flex-col gap-1.5">
        <h3 className="font-display text-sm">Đòn đánh cơ bản</h3>
        <select className="field" value={draft.weaponId} onChange={(e) => setDraft({ ...draft, weaponId: e.target.value })}>
          {bundle.weapons.map((w) => (
            <option key={w.id} value={w.id}>
              {label(w)}
            </option>
          ))}
        </select>
        {errors.weaponId && <span className="text-xs font-bold text-red-team">{errors.weaponId}</span>}
        {row(draft.weaponId, null)}
      </section>
      <section className="flex flex-col gap-1.5">
        <h3 className="font-display text-sm">Kỹ năng ({draft.skillIds.length}/6)</h3>
        <p className="text-xs opacity-60">Tự tung theo thứ tự khi hồi xong và đủ mục tiêu.</p>
        {draft.skillIds.map((id, i) => (
          <div key={id} className="flex flex-col gap-1.5">
            {row(
              id,
              <>
                <button className="btn px-1.5 py-0 text-xs" disabled={i === 0} title="Lên" onClick={() => setSkills(draft.skillIds.map((s, j) => (j === i - 1 ? id : j === i ? draft.skillIds[i - 1] : s)))}>
                  ▲
                </button>
                <button className="btn px-1.5 py-0 text-xs" disabled={i === draft.skillIds.length - 1} title="Xuống" onClick={() => setSkills(draft.skillIds.map((s, j) => (j === i + 1 ? id : j === i ? draft.skillIds[i + 1] : s)))}>
                  ▼
                </button>
                <button className="btn px-1.5 py-0 text-xs" title="Bỏ kỹ năng" onClick={() => setSkills(draft.skillIds.filter((s) => s !== id))}>
                  ✕
                </button>
              </>,
            )}
          </div>
        ))}
        {errors.skillIds && <span className="text-xs font-bold text-red-team">{errors.skillIds}</span>}
        {draft.skillIds.length < 6 && (
          <select className="field" value="" onChange={(e) => e.target.value && setSkills([...draft.skillIds, e.target.value])}>
            <option value="">＋ Thêm kỹ năng…</option>
            {bundle.weapons
              .filter((w) => !draft.skillIds.includes(w.id))
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {label(w)}
                </option>
              ))}
          </select>
        )}
      </section>
    </div>
  );
}

function PriceTab({ bundle, draft, setDraft, skillDrafts, errors }: Pick<Props, 'bundle' | 'draft' | 'setDraft' | 'skillDrafts'> & { errors: Record<string, string> }) {
  const content = { ...bundle, weapons: bundle.weapons.map((w) => skillDrafts[w.id] ?? w) };
  const safe: UnitDef = { ...draft, hp: Number(draft.hp) || 1, cost: Number(draft.cost) || 1, attackSpeed: Number(draft.attackSpeed) || 1, castSpeed: Number(draft.castSpeed) || 1 };
  const rows = [...bundle.units.filter((u) => u.id !== draft.id), safe].map((u) => {
    const p = unitPower(u, content);
    const strength = Math.sqrt(Math.max(0.001, p.dps) * p.ehp);
    return { unit: u, ...p, strength, eff: strength / u.cost, mine: u === safe };
  });
  rows.sort((a, b) => b.eff - a.eff);
  const others = rows.filter((r) => !r.mine).map((r) => r.eff).sort((a, b) => a - b);
  const median = others.length ? others[Math.floor(others.length / 2)] : null;
  const mine = rows.find((r) => r.mine)!;
  const suggested = median ? Math.max(1, Math.round(mine.strength / median / 5) * 5) : null;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <label className="flex flex-col gap-1">
        <span className="font-bold">Giá</span>
        <input className="field" type="number" min={1} step={10} value={String(draft.cost ?? '')} onChange={(e) => setDraft({ ...draft, cost: e.target.value === '' ? ('' as unknown as number) : Number(e.target.value) })} />
        {errors.cost && <span className="text-xs font-bold text-red-team">{errors.cost}</span>}
      </label>
      <dl className="grid grid-cols-2 gap-x-3">
        <dt>Sát thương / giây</dt>
        <dd className="text-right font-bold">{mine.dps.toFixed(1)}</dd>
        <dt>Máu hiệu dụng</dt>
        <dd className="text-right font-bold">{mine.ehp.toFixed(0)}</dd>
        <dt>Hiệu quả / giá</dt>
        <dd className="text-right font-bold">
          {(mine.eff * 100).toFixed(2)} <span className="text-xs font-normal opacity-60">(hạng {rows.indexOf(mine) + 1}/{rows.length})</span>
        </dd>
      </dl>
      {suggested !== null && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg bg-white/70 p-2 text-xs">
          <span>
            Giá cân bằng (hiệu quả bằng trung vị các lính khác): <b>{suggested}</b>
          </span>
          <button className="btn ml-auto px-2 py-0 text-xs" disabled={suggested === safe.cost} onClick={() => setDraft({ ...draft, cost: suggested })}>
            Dùng giá này
          </button>
        </p>
      )}
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left opacity-60">
            <th>Lính</th>
            <th className="text-right">Giá</th>
            <th className="text-right">DPS</th>
            <th className="text-right">Máu HD</th>
            <th className="text-right">Hiệu quả</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.mine ? '__draft' : r.unit.id} className={`border-t border-ink/10 ${r.mine ? 'bg-gold/40 font-bold' : ''}`}>
              <td className="truncate">{r.unit.name}</td>
              <td className="text-right">{r.unit.cost}</td>
              <td className="text-right">{r.dps.toFixed(0)}</td>
              <td className="text-right">{r.ehp.toFixed(0)}</td>
              <td className="text-right">{(r.eff * 100).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs opacity-60">Hiệu quả = √(DPS × máu hiệu dụng) / giá, tính cả kỹ năng, tốc độ đánh và bảng khắc chế giáp. Bot dùng giá để chọn đội hình.</p>
    </div>
  );
}
