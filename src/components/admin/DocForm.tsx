'use client';

import type { ConfigBundle } from '@/shared/schema';
import { ENUM_LABELS, getPath, setPath, type Field } from '@/shared/fields';

type Doc = Record<string, unknown>;

interface Props {
  fields: Field[];
  doc: Doc;
  onChange(doc: Doc): void;
  bundle: ConfigBundle | null;
  errors: Record<string, string>;
  isNew?: boolean;
}

export default function DocForm({ fields, doc, onChange, bundle, errors, isNew = true }: Props) {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-2.5 md:grid-cols-2">
      {fields.map((f, i) =>
        f.type === 'section' ? (
          <h3 key={`s${i}`} className="col-span-full mt-3 border-b-2 border-ink/15 pb-1 font-display text-sm first:mt-0">
            {f.label}
          </h3>
        ) : (
          <label key={f.key} className={`flex flex-col gap-1 text-sm ${f.type === 'textarea' || f.type === 'refs' ? 'col-span-full' : ''}`}>
            <span className="font-bold">{f.label}</span>
            <FieldInput field={f} value={getPath(doc, f.key)} onChange={(v) => onChange(setPath(doc, f.key, v))} bundle={bundle} disabled={'readOnlyOnEdit' in f && f.readOnlyOnEdit && !isNew} />
            {f.help && <span className="text-xs opacity-60">{f.help}</span>}
            {errors[f.key] && <span className="text-xs font-bold text-red-team">{errors[f.key]}</span>}
          </label>
        ),
      )}
    </div>
  );
}

function FieldInput({ field, value, onChange, bundle, disabled }: { field: Exclude<Field, { type: 'section' }>; value: unknown; onChange(v: unknown): void; bundle: ConfigBundle | null; disabled?: boolean }) {
  switch (field.type) {
    case 'text':
      return <input className="field" value={String(value ?? '')} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
    case 'textarea':
      return <textarea className="field min-h-16" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <input className="field" type="number" min={field.min} max={field.max} step={field.step ?? 'any'} value={value === undefined || value === null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
    case 'slider': {
      const n = typeof value === 'number' ? value : field.min;
      return (
        <div className="flex items-center gap-2">
          <input className="flex-1 accent-amber-500" type="range" min={field.min} max={field.max} step={field.step} value={n} onChange={(e) => onChange(Number(e.target.value))} />
          <input className="field w-20" type="number" step={field.step} value={String(value ?? '')} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
        </div>
      );
    }
    case 'range2': {
      const pair = Array.isArray(value) ? (value as number[]) : [field.min, field.max];
      return (
        <div className="flex items-center gap-2">
          {[0, 1].map((i) => (
            <input
              key={i}
              className="field"
              type="number"
              min={field.min}
              max={field.max}
              step={field.step}
              value={pair[i] ?? ''}
              onChange={(e) => {
                const next = [...pair];
                next[i] = Number(e.target.value);
                onChange(next);
              }}
            />
          ))}
        </div>
      );
    }
    case 'bool':
      return (
        <span className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-amber-500" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          <span className="text-xs opacity-60">{value ? 'Bật' : 'Tắt'}</span>
        </span>
      );
    case 'color': {
      const hex = typeof value === 'string' ? value : '#000000';
      return (
        <div className="flex items-center gap-2">
          <input type="color" className="h-8 w-10 cursor-pointer rounded border-2 border-ink/40" value={/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#000000'} onChange={(e) => onChange(e.target.value)} />
          <input className="field font-mono" value={hex} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    }
    case 'select':
      return (
        <select className="field" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {ENUM_LABELS[o] ? `${ENUM_LABELS[o]} (${o})` : o}
            </option>
          ))}
        </select>
      );
    case 'ref': {
      const options = refOptions(bundle, field);
      return (
        <select className="field" value={value == null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? (field.nullable ? null : '') : e.target.value)}>
          {(field.nullable || value == null || value === '') && <option value="">{field.nullable ? '— không —' : '— chọn —'}</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    case 'refs': {
      const selected = new Set(Array.isArray(value) ? (value as string[]) : []);
      const options = refOptions(bundle, field);
      return (
        <div className="flex flex-wrap gap-1">
          {options.map((o) => {
            const on = selected.has(o.id);
            return (
              <button
                type="button"
                key={o.id}
                onClick={() => {
                  const next = new Set(selected);
                  if (on) next.delete(o.id);
                  else next.add(o.id);
                  onChange([...next]);
                }}
                className={`rounded-full border-2 px-2 py-0.5 text-xs font-bold ${on ? 'border-ink bg-gold' : 'border-ink/30 bg-white opacity-70'}`}
              >
                {o.label}
              </button>
            );
          })}
          {options.length === 0 && <span className="text-xs opacity-60">Chưa có mục nào phù hợp</span>}
        </div>
      );
    }
  }
}

function refOptions(bundle: ConfigBundle | null, field: Extract<Field, { type: 'ref' | 'refs' }>): Array<{ id: string; label: string }> {
  if (!bundle) return [];
  const list = bundle[field.collection] as Array<{ id: string; name: string; kind?: string }>;
  return list.filter((d) => !field.kinds || field.kinds.includes(d.kind as never)).map((d) => ({ id: d.id, label: `${d.name} (${d.id})` }));
}
