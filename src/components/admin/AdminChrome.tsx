'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { COLLECTIONS } from '@/shared/schema';
import { COLLECTION_SPECS } from '@/shared/fields';
import { api, ApiError } from './api';

export function AdminNav() {
  const path = usePathname();
  const router = useRouter();
  const item = (href: string, label: string, exact = false) => {
    const active = exact ? path === href : path.startsWith(href);
    return (
      <Link key={href} href={href} className={`block rounded-lg px-2 py-1.5 text-sm font-bold ${active ? 'bg-ink text-white' : 'hover:bg-white'}`}>
        {label}
      </Link>
    );
  };
  return (
    <nav className="flex flex-col gap-0.5">
      {item('/admin', '🏠 Tổng quan', true)}
      <div className="mt-2 px-2 text-[11px] font-extrabold uppercase opacity-50">Nội dung game</div>
      {COLLECTIONS.map((c) => item(`/admin/c/${c}`, `${COLLECTION_SPECS[c].icon} ${COLLECTION_SPECS[c].label}`))}
      {item('/admin/settings', '⚙️ Cài đặt & khắc chế')}
      <div className="mt-2 px-2 text-[11px] font-extrabold uppercase opacity-50">Khác</div>
      {item('/admin/studio', '🧪 Xưởng img2threejs')}
      {item('/models', '🧱 Xưởng mô hình')}
      {item('/play?mode=ai', '⚔️ Mở game')}
      <button
        className="mt-2 rounded-lg px-2 py-1.5 text-left text-sm font-bold hover:bg-white"
        onClick={async () => {
          await api('/api/admin/logout', { method: 'POST' });
          router.push('/admin/login');
        }}
      >
        ⎋ Đăng xuất
      </button>
    </nav>
  );
}

export function DashboardActions() {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMsg(ok);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof ApiError ? `${e.message}${Array.isArray(e.details) ? `: ${JSON.stringify(e.details.slice(0, 3))}` : ''}` : String(e));
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <a className="btn" href="/api/admin/bundle">
          ⬇ Xuất JSON
        </a>
        <button className="btn" onClick={() => file.current?.click()}>
          ⬆ Nhập JSON
        </button>
        <button
          className="btn"
          onClick={() => {
            if (confirm('Khôi phục toàn bộ nội dung về mặc định? Mọi chỉnh sửa sẽ mất.')) void run(() => api('/api/admin/bundle', { method: 'POST', body: JSON.stringify({ action: 'reset' }) }), 'Đã khôi phục dữ liệu mặc định.');
          }}
        >
          ↺ Khôi phục mặc định
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            let data: unknown;
            try {
              data = JSON.parse(await f.text());
            } catch {
              setMsg('File không phải JSON hợp lệ');
              return;
            }
            if (confirm('Thay toàn bộ nội dung bằng file này?')) void run(() => api('/api/admin/bundle', { method: 'PUT', body: JSON.stringify(data) }), 'Đã nhập dữ liệu.');
          }}
        />
      </div>
      {msg && <p className="text-sm">{msg}</p>}
    </div>
  );
}
