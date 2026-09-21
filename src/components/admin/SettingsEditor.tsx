'use client';

import { useEffect, useState } from 'react';
import { ARMOR_CLASSES, DAMAGE_TYPES, type Settings } from '@/shared/schema';
import { IS_VERCEL } from '@/shared/deploy';
import { ENUM_LABELS, SETTINGS_FIELDS, type Field } from '@/shared/fields';
import { useConfig } from '@/game/useConfig';
import { api, ApiError, detailsToErrors } from './api';
import DocForm from './DocForm';

/** Vercel has no ranked mode: drop its `ranked.*` fields, then the section headers left with no field under them. */
function visibleFields(): Field[] {
  if (!IS_VERCEL) return SETTINGS_FIELDS;
  const kept = SETTINGS_FIELDS.filter((f) => !('key' in f && f.key.startsWith('ranked.')));
  return kept.filter((f, i) => f.type !== 'section' || (i + 1 < kept.length && kept[i + 1].type !== 'section'));
}

const FIELDS = visibleFields();

export default function SettingsEditor() {
  const { bundle, reload } = useConfig();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api<Settings>('/api/admin/settings')
      .then(setSettings)
      .catch((e: Error) => setStatus({ ok: false, text: e.message }));
  }, []);

  const save = async () => {
    if (!settings) return;
    try {
      setErrors({});
      setSettings(await api<Settings>('/api/admin/settings', { method: 'PUT', body: JSON.stringify(settings) }));
      setStatus({ ok: true, text: 'Đã lưu ✓' });
      await reload();
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(detailsToErrors(e.details));
        setStatus({ ok: false, text: e.message });
      }
    }
  };

  if (!settings) return <p>{status?.text ?? 'Đang tải…'}</p>;
  const setCell = (d: (typeof DAMAGE_TYPES)[number], a: (typeof ARMOR_CLASSES)[number], v: number) =>
    setSettings({ ...settings, damageMatrix: { ...settings.damageMatrix, [d]: { ...settings.damageMatrix[d], [a]: v } } });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h1 className="font-display text-2xl">⚙️ Cài đặt chung</h1>
        <button className="btn btn-gold ml-auto px-4 py-1" onClick={() => void save()}>
          Lưu
        </button>
      </div>
      {status && <div className={`rounded-lg border-2 px-3 py-2 text-sm ${status.ok ? 'border-green-700 bg-green-50' : 'border-red-team bg-red-50'}`}>{status.text}</div>}
      <div className="grid items-start gap-3 xl:grid-cols-2">
        <div className="panel p-4">
          <DocForm fields={FIELDS} doc={settings as unknown as Record<string, unknown>} onChange={(d) => setSettings(d as unknown as Settings)} bundle={bundle} errors={errors} />
        </div>
        <div className="panel p-4">
          <h2 className="font-display text-sm">Bảng khắc chế sát thương × giáp</h2>
          <p className="mb-2 text-xs opacity-70">Sát thương thực = sát thương vũ khí × hệ số ô tương ứng. &gt;1 khắc chế, &lt;1 bị kháng.</p>
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr>
                  <th />
                  {ARMOR_CLASSES.map((a) => (
                    <th key={a} className="px-1 text-xs">
                      {ENUM_LABELS[a]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DAMAGE_TYPES.map((d) => (
                  <tr key={d}>
                    <th className="pr-2 text-left text-xs">{ENUM_LABELS[d]}</th>
                    {ARMOR_CLASSES.map((a) => {
                      const v = settings.damageMatrix[d][a];
                      const tint = v > 1 ? `rgba(47,168,79,${Math.min(0.5, (v - 1) * 0.8)})` : v < 1 ? `rgba(216,55,58,${Math.min(0.5, (1 - v) * 0.8)})` : 'transparent';
                      return (
                        <td key={a} className="p-0.5">
                          <input className="field w-16 text-center" style={{ background: tint }} type="number" step={0.05} min={0} max={10} value={v} onChange={(e) => setCell(d, a, Number(e.target.value))} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
