'use client';

import { CreditCard, Download, HardHat, House, LogOut, Plus, RotateCcw, Settings, Swords, TrendingUp, Trophy, Upload, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';
import { NamedIcon } from '@/components/ui/NamedIcon';
import { COLLECTIONS } from '@/shared/schema';
import { COLLECTION_SPECS, SETTINGS_FIELDS } from '@/shared/fields';
import { IS_VERCEL } from '@/shared/deploy';
import type { MissingDefaults } from '@/shared/merge';
import { useAuth } from '@/components/auth/AuthProvider';
import { api, ApiError } from './api';

export function AdminNav() {
  const path = usePathname();
  const router = useRouter();
  const { signOut } = useAuth();
  const item = (href: string, icon: ReactNode, label: string, exact = false) => {
    const active = exact ? path === href : path.startsWith(href);
    return (
      <Link key={href} href={href} className={`block rounded-lg px-2 py-1.5 text-sm font-bold ${active ? 'bg-ink text-white' : 'hover:bg-white'}`}>
        {icon} {label}
      </Link>
    );
  };
  return (
    <nav className="flex flex-col gap-0.5">
      {item('/admin', <House />, 'Tổng quan', true)}
      {!IS_VERCEL && item('/admin/monitoring', <TrendingUp />, 'Giám sát máy chủ')}
      <div className="mt-2 px-2 text-[11px] font-extrabold uppercase opacity-50">Nội dung game</div>
      {item('/models', <HardHat />, 'Nhân vật & mô hình')}
      {COLLECTIONS.filter((c) => c !== 'units').map((c) => item(`/admin/c/${c}`, <NamedIcon name={COLLECTION_SPECS[c].icon} />, COLLECTION_SPECS[c].label))}
      {item('/admin/settings', <Settings />, 'Cài đặt & khắc chế')}
      {item('/admin/users', <Users />, 'Người dùng')}
      {item('/admin/topups', <CreditCard />, 'Nạp xu')}
      {!IS_VERCEL && item('/admin/ranked', <Trophy />, 'Xếp hạng & gian lận')}
      <div className="mt-2 px-2 text-[11px] font-extrabold uppercase opacity-50">Khác</div>
      {item('/play?mode=bot', <Swords />, 'Mở game')}
      <button
        className="mt-2 rounded-lg px-2 py-1.5 text-left text-sm font-bold hover:bg-white"
        onClick={async () => {
          await signOut();
          router.push('/admin/login');
        }}
      >
        <LogOut /> Đăng xuất
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
          <Download /> Xuất JSON
        </a>
        <button className="btn" onClick={() => file.current?.click()}>
          <Upload /> Nhập JSON
        </button>
        <button
          className="btn"
          onClick={() => {
            if (confirm('Khôi phục toàn bộ nội dung về mặc định? Mọi chỉnh sửa sẽ mất.')) void run(() => api('/api/admin/bundle', { method: 'POST', body: JSON.stringify({ action: 'reset' }) }), 'Đã khôi phục dữ liệu mặc định.');
          }}
        >
          <RotateCcw /> Khôi phục mặc định
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

/** Pick default documents (new skills, units, particles…) to add without touching existing content. */
export function DefaultsMerge({ missing }: { missing: MissingDefaults }) {
  const router = useRouter();
  const [picked, setPicked] = useState(() => new Set(missing.docs.map((d) => `${d.collection}/${d.id}`)));
  const [skills, setSkills] = useState(true);
  const [prices, setPrices] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const toggle = (key: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api<{ added: number; skilled: number; priced: number; settings: boolean; skipped: string[] }>('/api/admin/bundle', { method: 'POST', body: JSON.stringify({ action: 'merge', docs: [...picked], skills, prices }) });
      setMsg(`Đã thêm ${r.added} mục, gán kỹ năng cho ${r.skilled} lính, đặt giá cho ${r.priced} lính${r.settings ? ', cập nhật cài đặt' : ''}.${r.skipped.length ? ` Bỏ qua (thiếu tham chiếu): ${r.skipped.join(', ')}` : ''}`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="opacity-70">Bản cập nhật có thêm nội dung mặc định (kỹ năng, lính, particle…) mà dữ liệu hiện tại chưa có. Chọn mục muốn thêm: mục đang có không bị sửa hay xóa. Mục mặc định bạn từng xóa cũng nằm trong danh sách, hãy bỏ chọn nếu không muốn thêm lại.</p>
      {COLLECTIONS.map((c) => {
        const docs = missing.docs.filter((d) => d.collection === c);
        if (docs.length === 0) return null;
        return (
          <div key={c}>
            <div className="font-bold">
              <NamedIcon name={COLLECTION_SPECS[c].icon} /> {COLLECTION_SPECS[c].label}
            </div>
            <div className="flex flex-wrap gap-1">
              {docs.map((d) => {
                const key = `${c}/${d.id}`;
                const on = picked.has(key);
                return (
                  <button type="button" key={key} onClick={() => toggle(key)} className={`rounded-full border-2 px-2 py-0.5 text-xs font-bold ${on ? 'border-ink bg-gold' : 'border-ink/30 bg-white opacity-60'}`}>
                    {d.name}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {missing.unskilled.length > 0 && (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={skills} onChange={(e) => setSkills(e.target.checked)} />
          Gán kỹ năng mặc định cho lính chưa có kỹ năng: {missing.unskilled.map((u) => u.name).join(', ')}
        </label>
      )}
      {missing.unpriced.length > 0 && (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={prices} onChange={(e) => setPrices(e.target.checked)} />
          Đặt giá mở khóa, giá thẻ và giá nâng sao mặc định cho {missing.unpriced.length} lính chưa có giá: {missing.unpriced.map((u) => u.name).join(', ')}
        </label>
      )}
      {missing.settings.length > 0 && <p className="text-xs opacity-70">Cài đặt còn trống sẽ được điền: {missing.settings.map((k) => SETTINGS_FIELDS.find((f) => 'key' in f && f.key === k)?.label ?? k).join(', ')}</p>}
      <div>
        <button className="btn btn-gold" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Đang thêm…' : <><Plus /> Thêm nội dung đã chọn</>}
        </button>
      </div>
      {msg && <p>{msg}</p>}
    </div>
  );
}
