'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { formatCoins, type BoxStatus, type LedgerEntry, type LedgerType, type PlayerState } from '@/shared/economy';
import { assignableRoles, canManage, isOnline, ROLE, ROLE_LABELS, type AppUser, type Role } from '@/shared/users';
import { api, ApiError, detailsToErrors } from './api';

const fmt = (ms: number | null) => (ms ? new Date(ms).toLocaleString('vi-VN') : '—');

function RoleBadge({ role }: { role: Role }) {
  const cls = role === ROLE.root ? 'bg-red-team text-white' : role === ROLE.admin ? 'bg-gold' : 'bg-white';
  return <span className={`rounded-md border border-ink px-1.5 py-0.5 text-xs font-bold ${cls}`}>{ROLE_LABELS[role]}</span>;
}

export function UserList() {
  const router = useRouter();
  const [data, setData] = useState<{ me: AppUser; users: AppUser[]; now: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [role, setRole] = useState<'' | Role>('');

  useEffect(() => {
    api<{ me: AppUser; users: AppUser[]; now: number }>('/api/admin/users')
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  const shown = (data?.users ?? []).filter(
    (u) => (role === '' || u.role === role) && (!q || `${u.email ?? ''} ${u.displayName ?? ''} ${u.uid}`.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl">👥 Người dùng</h1>
        <span className="text-sm opacity-60">{data ? `${data.users.length} tài khoản` : ''}</span>
        <select className="field ml-auto w-36" value={role} onChange={(e) => setRole(e.target.value === '' ? '' : (Number(e.target.value) as Role))}>
          <option value="">Mọi quyền</option>
          {([0, 1, 2] as Role[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <input className="field w-56" placeholder="Tìm email / tên / uid…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Link href="/admin/users/new" className="btn btn-gold px-3 py-1">
          + Tạo mới
        </Link>
      </div>
      {error && <p className="text-red-team">{error}</p>}
      <div className="panel overflow-x-auto p-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="px-2 py-1">Email</th>
              <th className="px-2 py-1">Tên</th>
              <th className="px-2 py-1">Quyền</th>
              <th className="px-2 py-1">Đăng nhập bằng</th>
              <th className="px-2 py-1">FCM</th>
              <th className="px-2 py-1">Trạng thái</th>
              <th className="px-2 py-1">Online</th>
              <th className="px-2 py-1">Đăng nhập gần nhất</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.uid} className="cursor-pointer border-t border-ink/10 hover:bg-white" onClick={() => router.push(`/admin/users/${u.uid}`)}>
                <td className="px-2 py-1">
                  {u.email ?? <span className="opacity-40">—</span>}
                  {data?.me.uid === u.uid && <span className="ml-1 text-xs opacity-60">(bạn)</span>}
                </td>
                <td className="px-2 py-1">{u.displayName ?? <span className="opacity-40">—</span>}</td>
                <td className="px-2 py-1">
                  <RoleBadge role={u.role} />
                </td>
                <td className="px-2 py-1 text-xs">{u.providers.join(', ') || '—'}</td>
                <td className="px-2 py-1">{u.fcmTokens.length}</td>
                <td className="px-2 py-1">{u.disabled ? <span className="font-bold text-red-team">Khoá</span> : 'Hoạt động'}</td>
                <td className="px-2 py-1 text-xs" title={`Hoạt động gần nhất: ${fmt(u.lastActiveAt)}`}>
                  {isOnline(u, data!.now) ? <span className="font-bold text-green-700">● Online</span> : <span className="opacity-60">○ Offline</span>}
                </td>
                <td className="px-2 py-1 text-xs">{fmt(u.lastLoginAt)}</td>
              </tr>
            ))}
            {data && shown.length === 0 && (
              <tr>
                <td colSpan={8} className="px-2 py-4 text-center opacity-60">
                  Không có người dùng
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type Form = { email: string; password: string; displayName: string; role: Role; disabled: boolean };

export function UserEditor({ uid }: { uid: string }) {
  const router = useRouter();
  const isNew = uid === 'new';
  const [me, setMe] = useState<AppUser | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [form, setForm] = useState<Form>({ email: '', password: '', displayName: '', role: ROLE.user, disabled: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [push, setPush] = useState({ title: '', body: '' });

  useEffect(() => {
    if (isNew) {
      api<{ me: AppUser }>('/api/admin/users')
        .then((d) => setMe(d.me))
        .catch((e: Error) => setStatus({ ok: false, text: e.message }));
      return;
    }
    api<{ me: AppUser; user: AppUser }>(`/api/admin/users/${uid}`)
      .then((d) => {
        setMe(d.me);
        setUser(d.user);
        setForm({ email: d.user.email ?? '', password: '', displayName: d.user.displayName ?? '', role: d.user.role, disabled: d.user.disabled });
      })
      .catch((e: Error) => setStatus({ ok: false, text: e.message }));
  }, [uid, isNew]);

  const editable = Boolean(me && (isNew || (user && canManage(me, user))));
  const roles = me ? assignableRoles(me) : [];
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const call = async (fn: () => Promise<void>) => {
    setBusy(true);
    setStatus(null);
    setErrors({});
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(detailsToErrors(e.details));
        setStatus({ ok: false, text: e.message });
      } else setStatus({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    call(async () => {
      if (isNew) {
        const created = await api<AppUser>('/api/admin/users', { method: 'POST', body: JSON.stringify(form) });
        router.replace(`/admin/users/${created.uid}`);
        return;
      }
      const { password, ...rest } = form;
      const updated = await api<AppUser>(`/api/admin/users/${uid}`, { method: 'PATCH', body: JSON.stringify(password ? form : rest) });
      setUser(updated);
      set('password', '');
      setStatus({ ok: true, text: 'Đã lưu.' });
    });

  const remove = () => {
    if (!confirm(`Xoá vĩnh viễn tài khoản ${user?.email ?? uid}? Không thể hoàn tác.`)) return;
    void call(async () => {
      await api(`/api/admin/users/${uid}`, { method: 'DELETE' });
      router.push('/admin/users');
    });
  };

  const notify = () =>
    call(async () => {
      const r = await api<{ sent: number; failed: number; removed: number }>(`/api/admin/users/${uid}/notify`, { method: 'POST', body: JSON.stringify(push) });
      setStatus({ ok: r.sent > 0, text: `Đã gửi ${r.sent} thiết bị, lỗi ${r.failed}${r.removed ? `, dọn ${r.removed} token hỏng` : ''}.` });
      if (r.removed) setUser((await api<{ user: AppUser }>(`/api/admin/users/${uid}`)).user);
    });

  const field = (label: string, key: 'email' | 'password' | 'displayName', props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="flex flex-col gap-1 text-sm font-bold">
      {label}
      <input className="field" disabled={!editable} value={form[key]} onChange={(e) => set(key, e.target.value)} {...props} />
      {errors[key] && <span className="text-xs text-red-team">{errors[key]}</span>}
    </label>
  );

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/admin/users" className="text-sm underline">
          ← Người dùng
        </Link>
        <h1 className="font-display text-2xl">{isNew ? 'Tạo người dùng' : (user?.email ?? uid)}</h1>
        {user && <RoleBadge role={user.role} />}
      </div>

      {me && !editable && user && (
        <p className="rounded-lg border-2 border-amber-600 bg-amber-50 px-3 py-2 text-sm">
          {me.uid === user.uid ? 'Đây là tài khoản của bạn — không tự sửa trong CMS.' : 'Bạn không đủ quyền sửa người dùng này.'}
        </p>
      )}

      <section className="panel flex flex-col gap-3 p-4">
        {field('Email', 'email', { type: 'email', required: true })}
        {field('Tên hiển thị', 'displayName', { maxLength: 64 })}
        {field(isNew ? 'Mật khẩu' : 'Mật khẩu mới (bỏ trống = giữ nguyên)', 'password', { type: 'password', autoComplete: 'new-password' })}
        <label className="flex flex-col gap-1 text-sm font-bold">
          Quyền
          <select className="field" disabled={!editable} value={form.role} onChange={(e) => set('role', Number(e.target.value) as Role)}>
            {([0, 1, 2] as Role[]).map((r) => (
              <option key={r} value={r} disabled={!roles.includes(r)}>
                {r} — {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          {errors.role && <span className="text-xs text-red-team">{errors.role}</span>}
        </label>
        <label className="flex items-center gap-2 text-sm font-bold">
          <input type="checkbox" disabled={!editable} checked={form.disabled} onChange={(e) => set('disabled', e.target.checked)} />
          Khoá tài khoản
        </label>
        {user && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            <dt className="opacity-60">UID</dt>
            <dd className="font-mono">{user.uid}</dd>
            <dt className="opacity-60">Đăng nhập bằng</dt>
            <dd>{user.providers.join(', ') || '—'}</dd>
            <dt className="opacity-60">Tạo lúc</dt>
            <dd>{fmt(user.createdAt)}</dd>
            <dt className="opacity-60">Đăng nhập gần nhất</dt>
            <dd>{fmt(user.lastLoginAt)}</dd>
          </dl>
        )}
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-gold" disabled={!editable || busy} onClick={() => void save()}>
            {busy ? 'Đang lưu…' : isNew ? 'Tạo' : 'Lưu'}
          </button>
          {!isNew && (
            <button className="btn btn-red ml-auto" disabled={!editable || busy} onClick={remove}>
              Xoá
            </button>
          )}
        </div>
        {status && <p className={`text-sm font-bold ${status.ok ? 'text-green-700' : 'text-red-team'}`}>{status.text}</p>}
      </section>

      {user && <WalletPanel uid={user.uid} editable={editable} />}

      {user && (
        <section className="panel flex flex-col gap-2 p-4">
          <h2 className="font-display text-sm">🔔 Gửi thông báo FCM ({user.fcmTokens.length} thiết bị)</h2>
          <input className="field" placeholder="Tiêu đề" maxLength={120} value={push.title} onChange={(e) => setPush((p) => ({ ...p, title: e.target.value }))} />
          <textarea className="field" rows={3} placeholder="Nội dung" maxLength={1000} value={push.body} onChange={(e) => setPush((p) => ({ ...p, body: e.target.value }))} />
          <button className="btn self-start" disabled={busy || !push.title.trim() || !user.fcmTokens.length} onClick={() => void notify()}>
            Gửi
          </button>
        </section>
      )}
    </div>
  );
}

type Wallet = { player: PlayerState; boxes: BoxStatus; ledger: Array<LedgerEntry & { id: string; at: number | null }> };

const LEDGER_LABELS: Record<LedgerType, string> = {
  'daily-box': 'Hộp hằng ngày',
  'hourly-box': 'Hộp x giờ',
  'bot-win': 'Thắng bot',
  'rank-win': 'Thắng xếp hạng',
  'rank-season': 'Thưởng mùa xếp hạng',
  unlock: 'Mở khóa lính',
  upgrade: 'Nâng sao',
  'buy-cards': 'Mua thẻ',
  admin: 'Admin cộng/trừ',
  topup: 'Nạp xu (duyệt đơn)',
};

/** Coins, collection summary and ledger of one player; root/admin who manage the user can add or remove coins. */
function WalletPanel({ uid, editable }: { uid: string; editable: boolean }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [delta, setDelta] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    api<Wallet>(`/api/admin/users/${uid}/wallet`)
      .then(setWallet)
      .catch((e: Error) => setStatus({ ok: false, text: e.message }));
  }, [uid]);
  useEffect(load, [load]);

  const submit = async () => {
    const amount = Number(delta);
    if (!Number.isInteger(amount) || amount === 0) return setErrors({ delta: 'nhập số nguyên khác 0 (âm = trừ)' });
    if (!confirm(`${amount > 0 ? 'Cộng' : 'Trừ'} ${formatCoins(Math.abs(amount))} coin cho người dùng này?`)) return;
    setBusy(true);
    setStatus(null);
    setErrors({});
    try {
      setWallet(await api<Wallet>(`/api/admin/users/${uid}/wallet`, { method: 'POST', body: JSON.stringify({ delta: amount, note }) }));
      setDelta('');
      setNote('');
      setStatus({ ok: true, text: 'Đã cập nhật ví.' });
    } catch (e) {
      if (e instanceof ApiError) setErrors(detailsToErrors(e.details));
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const p = wallet?.player;
  return (
    <section className="panel flex flex-col gap-2 p-4">
      <h2 className="font-display text-sm">💰 Ví coin & bộ sưu tập</h2>
      {p ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
          <dt className="opacity-60">Coin</dt>
          <dd className="font-bold">{formatCoins(p.coins)}</dd>
          <dt className="opacity-60">Lính đã mua</dt>
          <dd>{p.unlocked.length ? p.unlocked.join(', ') : '—'}</dd>
          <dt className="opacity-60">Sao</dt>
          <dd>{Object.entries(p.stars).map(([id, star]) => `${id} ${star}★`).join(', ') || '—'}</dd>
          <dt className="opacity-60">Thẻ</dt>
          <dd>{Object.values(p.cards).reduce((a, b) => a + b, 0)} thẻ / {Object.keys(p.cards).length} loại</dd>
          <dt className="opacity-60">Hộp hằng ngày gần nhất</dt>
          <dd>{p.dailyDay ?? '—'}</dd>
          <dt className="opacity-60">Tuần điểm danh</dt>
          <dd>
            {p.weekStart ?? '—'} {p.weekClaims.map((c) => (c ? '✔' : '✕')).join(' ')}
          </dd>
        </dl>
      ) : (
        !status && <p className="text-sm opacity-60">Đang tải…</p>
      )}
      {editable && (
        <div className="flex flex-wrap items-start gap-2">
          <label className="flex flex-col gap-1 text-sm font-bold">
            Cộng / trừ coin
            <input className="field w-40" type="number" step={1000} placeholder="vd. 50000 hoặc -2000" value={delta} onChange={(e) => setDelta(e.target.value)} />
            {errors.delta && <span className="text-xs text-red-team">{errors.delta}</span>}
          </label>
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-bold">
            Lý do (lưu vào sổ giao dịch)
            <input className="field" maxLength={200} placeholder="vd. nạp chuyển khoản 50.000đ, mã GD…" value={note} onChange={(e) => setNote(e.target.value)} />
            {errors.note && <span className="text-xs text-red-team">{errors.note}</span>}
          </label>
          <button className="btn btn-gold mt-6" disabled={busy || !delta || !note.trim()} onClick={() => void submit()}>
            {busy ? 'Đang lưu…' : 'Áp dụng'}
          </button>
        </div>
      )}
      {status && <p className={`text-sm font-bold ${status.ok ? 'text-green-700' : 'text-red-team'}`}>{status.text}</p>}
      {wallet && wallet.ledger.length > 0 && (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left opacity-60">
                <th>Thời gian</th>
                <th>Loại</th>
                <th className="text-right">Coin</th>
                <th className="text-right">Số dư</th>
                <th>Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {wallet.ledger.map((l) => (
                <tr key={l.id} className="border-t border-ink/10 align-top">
                  <td>{fmt(l.at)}</td>
                  <td>{LEDGER_LABELS[l.type] ?? l.type}</td>
                  <td className={`text-right font-bold ${l.coins < 0 ? 'text-red-team' : 'text-green-700'}`}>{l.coins > 0 ? '+' : ''}{formatCoins(l.coins)}</td>
                  <td className="text-right">{formatCoins(l.balance)}</td>
                  <td>
                    {[l.unitId && `${l.unitId}${l.star ? ` → ${l.star}★` : ''}`, l.cards && Object.entries(l.cards).map(([id, n]) => `${id} ${n > 0 ? '+' : ''}${n} thẻ`).join(', '), l.note, l.by && `bởi ${l.by}`].filter(Boolean).join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
