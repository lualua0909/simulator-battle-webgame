'use client';

// CMS quản lý giao dịch nạp xu: 3 tab Đang chờ / Đã xác nhận / Đã huỷ.
// Duyệt = cộng xu cho user ngay trong transaction (chống bấm 2 lần); huỷ = không cộng xu.
import { useCallback, useEffect, useState } from 'react';
import { formatTopupCoins, formatVnd, TOPUP_STATUS_LABELS, type TopupOrder, type TopupStatus } from '@/shared/topup';
import { api, ApiError } from './api';

type Tab = TopupStatus | 'all';

const TABS: Array<{ key: TopupStatus; label: string }> = [
  { key: 'pending', label: 'Đang chờ' },
  { key: 'confirmed', label: 'Đã xác nhận' },
  { key: 'cancelled', label: 'Đã huỷ' },
];

const fmt = (ms: number | null) => (ms ? new Date(ms).toLocaleString('vi-VN') : '—');

export default function TopupsAdmin() {
  const [tab, setTab] = useState<TopupStatus>('pending');
  const [orders, setOrders] = useState<TopupOrder[]>([]);
  const [counts, setCounts] = useState<Record<TopupStatus, number>>({ pending: 0, confirmed: 0, cancelled: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async (status: Tab) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ orders: TopupOrder[]; counts: Record<TopupStatus, number> }>(`/api/admin/topups?status=${status}`);
      setOrders(data.orders);
      setCounts(data.counts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(tab);
  }, [load, tab]);

  const decide = async (order: TopupOrder, action: 'confirm' | 'cancel') => {
    const verb = action === 'confirm' ? `duyệt đơn ${order.content} và CỘNG ${formatTopupCoins(order.coins)} cho ${order.email ?? order.uid}` : `huỷ đơn ${order.content} (không cộng xu)`;
    const note = window.prompt(`Xác nhận ${verb}?\nNhập ghi chú (tuỳ chọn, lưu vào sổ):`, action === 'confirm' ? `${order.content} ${formatVnd(order.amountVnd)}` : '');
    if (note === null) return;
    setBusyId(order.id);
    setMsg(null);
    try {
      await api(`/api/admin/topups/${order.id}`, { method: 'POST', body: JSON.stringify({ action, note }) });
      setMsg(action === 'confirm' ? `Đã duyệt ${order.content}, cộng ${formatTopupCoins(order.coins)}. ✓` : `Đã huỷ ${order.content}.`);
      await load(tab);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl">💳 Giao dịch nạp xu</h1>
        <span className="text-sm opacity-60">duyệt = tự động cộng xu cho user</span>
        <button className="btn ml-auto px-3 py-1 text-sm" onClick={() => void load(tab)}>
          ↻ Tải lại
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full border-2 px-4 py-1 text-sm font-bold ${tab === t.key ? 'border-ink bg-gold' : 'border-ink/20 bg-white'}`}
          >
            {t.label} ({counts[t.key]})
          </button>
        ))}
      </div>

      {msg && <p className="rounded-lg border-2 border-ink/20 bg-white px-3 py-2 text-sm font-bold">{msg}</p>}
      {error && <p className="text-sm text-red-team">{error}</p>}
      {loading ? (
        <p className="text-sm opacity-60">Đang tải…</p>
      ) : orders.length === 0 ? (
        <p className="panel p-6 text-center text-sm opacity-60">Không có đơn {TOPUP_STATUS_LABELS[tab].toLowerCase()}.</p>
      ) : (
        <div className="panel overflow-x-auto p-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left opacity-60">
                <th className="px-2 py-1">Thời gian</th>
                <th className="px-2 py-1">Người nạp</th>
                <th className="px-2 py-1 text-right">Số tiền</th>
                <th className="px-2 py-1 text-right">Xu</th>
                <th className="px-2 py-1">Nội dung CK</th>
                <th className="px-2 py-1">Xử lý</th>
                {tab !== 'pending' && <th className="px-2 py-1">Ghi chú</th>}
                {tab === 'pending' && <th className="px-2 py-1 text-right">Thao tác</th>}
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t border-ink/10 align-top">
                  <td className="whitespace-nowrap px-2 py-1 text-xs">{fmt(o.createdAt)}</td>
                  <td className="px-2 py-1">
                    <div className="font-bold">{o.displayName || o.email || o.uid.slice(0, 8)}</div>
                    {o.email && o.displayName && <div className="text-xs opacity-60">{o.email}</div>}
                    <div className="font-mono text-[11px] opacity-50">{o.uid}</div>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-right font-bold">{formatVnd(o.amountVnd)}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right font-bold text-green-700">+{formatTopupCoins(o.coins)}</td>
                  <td className="px-2 py-1 font-mono font-bold">{o.content}</td>
                  <td className="px-2 py-1 text-xs">
                    {o.decidedBy ? (
                      <span>
                        {o.status === 'confirmed' ? '✓' : '✕'} bởi <span className="font-mono">{o.decidedBy.slice(0, 8)}</span>
                        <br />
                        {fmt(o.decidedAt)}
                      </span>
                    ) : (
                      <span className="opacity-50">—</span>
                    )}
                  </td>
                  {tab !== 'pending' && <td className="max-w-48 px-2 py-1 text-xs">{o.note ?? '—'}</td>}
                  {tab === 'pending' && (
                    <td className="px-2 py-1">
                      <div className="flex justify-end gap-1">
                        <button className="btn btn-gold px-2 py-0.5 text-xs" disabled={busyId === o.id} onClick={() => void decide(o, 'confirm')}>
                          {busyId === o.id ? '…' : '✓ Duyệt + cộng xu'}
                        </button>
                        <button className="btn btn-red px-2 py-0.5 text-xs" disabled={busyId === o.id} onClick={() => void decide(o, 'cancel')}>
                          ✕ Huỷ
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs opacity-60">Đối chiếu: số tiền + nội dung chuyển khoản của user phải khớp đơn trước khi bấm Duyệt. Đơn đã duyệt/huỷ không thể thao tác lại.</p>
    </div>
  );
}
