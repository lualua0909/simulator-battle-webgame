'use client';

// Inline editor for one ability document (basic attack or skill). Abilities are shared: an
// edit applies to every unit that uses the ability once saved.
import { abilityDps } from '@/game/bot/generate';
import { COLLECTION_SPECS, ENUM_LABELS } from '@/shared/fields';
import { weaponSchema, type ConfigBundle, type WeaponDef } from '@/shared/schema';
import DocForm from '../admin/DocForm';

type Doc = Record<string, unknown>;

interface Props {
  bundle: ConfigBundle;
  saved: WeaponDef;
  draft: WeaponDef | undefined;
  onChange(draft: WeaponDef | undefined): void;
  errors?: Record<string, string>;
}

export default function AbilityForm({ bundle, saved, draft, onChange, errors = {} }: Props) {
  const doc = (draft ?? saved) as unknown as Doc;
  const parsed = weaponSchema.safeParse(doc);
  const users = bundle.units.filter((u) => u.weaponId === saved.id || u.skillIds.includes(saved.id));
  return (
    <div className="flex flex-col gap-2 rounded-lg border-2 border-ink/20 bg-white/60 p-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <b className="text-sm">{String(doc.name)}</b>
        <span className="opacity-60">{ENUM_LABELS[String(doc.attack)] ?? String(doc.attack)}</span>
        {parsed.success && <span className="opacity-60">≈ {abilityDps(parsed.data).toFixed(1)} sát thương/giây</span>}
        {draft && (
          <button type="button" className="btn ml-auto px-2 py-0 text-xs" onClick={() => onChange(undefined)}>
            Bỏ thay đổi
          </button>
        )}
      </div>
      {users.length > 1 && <p className="rounded bg-gold/40 px-2 py-1 text-xs">Dùng chung cho {users.length} lính: {users.map((u) => u.name).join(', ')} — sửa ở đây đổi cho tất cả khi lưu.</p>}
      <DocForm fields={COLLECTION_SPECS.weapons.fields(doc)} doc={doc} onChange={(next) => onChange(next as unknown as WeaponDef)} bundle={bundle} errors={errors} isNew={false} compact />
    </div>
  );
}
