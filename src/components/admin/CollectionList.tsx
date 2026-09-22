'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { CollectionName } from '@/shared/schema';
import { COLLECTION_SPECS, ENUM_LABELS, getPath } from '@/shared/fields';
import { NamedIcon } from '@/components/ui/NamedIcon';
import { api } from './api';

type Doc = Record<string, unknown> & { id: string };

function Cell({ value }: { value: unknown }) {
  if (typeof value === 'boolean') return <span>{value ? <Check /> : '—'}</span>;
  if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-xs">
        <span className="h-3.5 w-3.5 rounded border border-ink/40" style={{ background: value }} />
        {value}
      </span>
    );
  }
  if (Array.isArray(value)) return <span>{value.join(', ')}</span>;
  if (value === null || value === undefined) return <span className="opacity-40">—</span>;
  const s = String(value);
  return <span>{ENUM_LABELS[s] ?? s}</span>;
}

export default function CollectionList({ collection }: { collection: CollectionName }) {
  const spec = COLLECTION_SPECS[collection];
  const router = useRouter();
  const [rows, setRows] = useState<Doc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    api<Doc[]>(`/api/admin/${collection}`)
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, [collection]);

  const shown = (rows ?? []).filter((r) => !q || `${r.id} ${String(r.name ?? '')}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl">
          <NamedIcon name={spec.icon} /> {spec.label}
        </h1>
        <span className="text-sm opacity-60">{rows ? `${rows.length} mục` : ''}</span>
        <input className="field ml-auto w-56" placeholder="Tìm theo tên / id…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Link href={`/admin/c/${collection}/new`} className="btn btn-gold px-3 py-1">
          + Tạo mới
        </Link>
      </div>
      {error && <p className="text-red-team">{error}</p>}
      <div className="panel overflow-x-auto p-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="px-2 py-1">ID</th>
              {spec.columns.map((c) => (
                <th key={c.key} className="px-2 py-1">
                  {c.label}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="cursor-pointer border-t border-ink/10 hover:bg-white" onClick={() => router.push(`/admin/c/${collection}/${r.id}`)}>
                <td className="px-2 py-1 font-mono text-xs">{r.id}</td>
                {spec.columns.map((c) => (
                  <td key={c.key} className="px-2 py-1">
                    {c.key === 'icon' ? <NamedIcon name={String(getPath(r, c.key) ?? '')} /> : <Cell value={getPath(r, c.key)} />}
                  </td>
                ))}
                <td className="px-2 py-1 text-right">
                  <Link className="text-xs underline" href={`/admin/c/${collection}/new?from=${r.id}`} onClick={(e) => e.stopPropagation()}>
                    nhân bản
                  </Link>
                </td>
              </tr>
            ))}
            {rows && shown.length === 0 && (
              <tr>
                <td colSpan={spec.columns.length + 2} className="px-2 py-4 text-center opacity-60">
                  Không có mục nào
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
