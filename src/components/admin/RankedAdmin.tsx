'use client';

// CMS: ranked battles the server flagged as possible win-trading (two accounts of one person, thrown
// games, repeat pairings, disputed results). Review each one; lift a dispute lock when it was unfair.
import { Check, RefreshCw, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { RANK_FLAG_LABELS, seasonName, type RankFlagDoc } from '@/shared/ranked';
import { api, ApiError } from './api';

const fmt = (ms: number | null) => (ms ? new Date(ms).toLocaleString('vi-VN') : '—');
const SIDE_LABEL: Record<string, string> = { blue: 'Xanh', red: 'Đỏ', green: 'Lục', yellow: 'Vàng' };

export default function RankedAdmin() {
  const [reviewed, setReviewed] = useState(false);
  const [flags, setFlags] = useState<RankFlagDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async (done: boolean) => {
    setLoading(true);
    setError(null);
    try {
      setFlags((await api<{ flags: RankFlagDoc[] }>(`/api/admin/ranked?reviewed=${done ? 1 : 0}`)).flags);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(reviewed);
  }, [load, reviewed]);

  const run = async (key: string, body: object, done: string) => {
    setBusy(key);
    setMsg(null);
    try {
      await api('/api/admin/ranked', { method: 'POST', body: JSON.stringify(body) });
      setMsg(done);
      await load(reviewed);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl"><Trophy /> Xếp hạng: trận nghi gian lận</h1>
        <button className="btn ml-auto px-3 py-1 text-sm" onClick={() => void load(reviewed)}>
          <RefreshCw /> Tải lại
        </button>
      </div>
      <p className="text-sm opacity-70">
        Máy chủ không tự chạy lại trận, nên không phân biệt được trận thật với trận nhường. Các trận dưới đây đã bị chặn cộng kim cương cho bên thắng (trừ cờ “cùng IP”, chỉ để xem) — hãy xem cặp tài khoản nào lặp lại nhiều lần.
      </p>

      <div className="flex flex-wrap gap-2">
        {[false, true].map((r) => (
          <button key={String(r)} onClick={() => setReviewed(r)} className={`rounded-full border-2 px-4 py-1 text-sm font-bold ${reviewed === r ? 'border-ink bg-gold' : 'border-ink/20 bg-white'}`}>
            {r ? 'Đã xem' : 'Chưa xem'}
          </button>
        ))}
      </div>

      {msg && <p className="rounded-lg border-2 border-ink/20 bg-white px-3 py-2 text-sm font-bold">{msg}</p>}
      {error && <p className="text-sm text-red-team">{error}</p>}
      {loading ? (
        <p className="text-sm opacity-60">Đang tải…</p>
      ) : flags.length === 0 ? (
        <p className="panel p-6 text-center text-sm opacity-60">Không có trận nào {reviewed ? 'đã xem' : 'cần xem'}.</p>
      ) : (
        <div className="panel overflow-x-auto p-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left opacity-60">
                <th className="px-2 py-1">Thời gian</th>
                <th className="px-2 py-1">Cờ</th>
                <th className="px-2 py-1">Người chơi</th>
                <th className="px-2 py-1">Trận</th>
                <th className="px-2 py-1 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((f) => (
                <tr key={f.id} className="border-t border-ink/10 align-top">
                  <td className="whitespace-nowrap px-2 py-1 text-xs">
                    {fmt(f.at)}
                    <div className="opacity-60">
                      {seasonName(f.season)} · phòng {f.room}
                    </div>
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex flex-col gap-0.5">
                      {f.flags.map((flag) => (
                        <span key={flag} className={`w-fit rounded px-1.5 text-xs font-bold ${flag === 'same-ip' ? 'bg-ink/10' : 'bg-red-team text-white'}`}>
                          {RANK_FLAG_LABELS[flag]}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-1">
                    {Object.entries(f.players).map(([side, p]) => (
                      <div key={side} className="mb-1 flex flex-wrap items-center gap-x-2">
                        <span className={f.winner === side ? 'font-bold text-green-700' : ''}>
                          {f.winner === side && <><Trophy />{' '}</>}
                          {p!.name}
                        </span>
                        <span className="text-xs opacity-60">({SIDE_LABEL[side] ?? side})</span>
                        <Link href={`/admin/users/${p!.uid}`} className="font-mono text-[11px] underline opacity-60">
                          {p!.uid.slice(0, 10)}
                        </Link>
                        <span className="font-mono text-[11px] opacity-60">{p!.ip ?? '—'}</span>
                        <span className="text-xs">
                          đội {p!.armyCost}/{f.budget}
                        </span>
                        {f.flags.includes('dispute') && (
                          <button className="btn px-1.5 py-0 text-[11px]" disabled={busy !== null} onClick={() => void run(`clear-${p!.uid}`, { action: 'clear-disputes', uid: p!.uid }, `Đã mở khóa xếp hạng cho ${p!.name}.`)}>
                            Mở khóa rank
                          </button>
                        )}
                      </div>
                    ))}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-xs">
                    {f.winner === null ? 'Kết quả bị hủy' : f.winner === 'draw' ? 'Hòa' : `${SIDE_LABEL[f.winner] ?? f.winner} thắng`}
                    <div className="opacity-60">
                      {f.ended === 'forfeit' ? 'đầu hàng/thoát' : 'báo cáo'} · {Math.round(f.durationMs / 1000)}s
                    </div>
                    <div className="opacity-60">cặp này trận thứ {f.pairCount + 1} hôm nay</div>
                  </td>
                  <td className="px-2 py-1 text-right">
                    {!f.reviewed ? (
                      <button className="btn btn-gold px-2 py-0.5 text-xs" disabled={busy !== null} onClick={() => void run(f.id, { action: 'review', id: f.id }, 'Đã đánh dấu đã xem.')}>
                        <Check /> Đã xem
                      </button>
                    ) : (
                      <span className="text-xs opacity-60">bởi {f.reviewedBy?.slice(0, 8) ?? '—'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
