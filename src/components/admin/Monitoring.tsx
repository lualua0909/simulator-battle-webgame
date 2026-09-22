'use client';

import { Check, Pause, Play, TrendingUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SIDE_TEXT } from '@/components/game/panels';
import type { MetricsSnapshot, StoredStats } from '@/server/metrics';
import { api } from './api';

interface Data {
  live: MetricsSnapshot;
  stored: StoredStats | null;
  storedError: string | null;
}

const REFRESH_MS = 5000;
const time = (ms: number) => new Date(ms).toLocaleTimeString('vi-VN');
const pct = (part: number, total: number) => (total ? `${Math.round((part / total) * 100)}%` : '—');

function duration(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d}n ${h}g ${m}p` : h ? `${h}g ${m}p` : `${m}p ${sec % 60}s`;
}

function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: 'bad' | 'good' }) {
  return (
    <div className="panel p-3">
      <div className="text-xs font-bold opacity-60">{label}</div>
      <div className={`font-display text-2xl ${tone === 'bad' ? 'text-red-team' : tone === 'good' ? 'text-green-700' : ''}`}>{value}</div>
      {hint && <div className="text-xs opacity-60">{hint}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display text-sm">{title}</h2>
      {children}
    </section>
  );
}

export function Monitoring() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    let alive = true;
    const load = () =>
      api<Data>('/api/admin/monitoring')
        .then((d) => {
          if (!alive) return;
          setData(d);
          setError(null);
        })
        .catch((e: Error) => alive && setError(e.message));
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [paused]);

  const live = data?.live;
  const stored = data?.stored;
  const sessionResults = live ? live.battles.results.blue + live.battles.results.red + live.battles.results.draw : 0;
  const sessionVoided = live ? live.battles.voided.reduce((n, v) => n + v.count, 0) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl"><TrendingUp /> Giám sát máy chủ</h1>
        {live && <span className="text-xs opacity-60">cập nhật {time(live.now)} · tự làm mới mỗi {REFRESH_MS / 1000}s</span>}
        <button className="btn ml-auto px-3 py-1 text-sm" onClick={() => setPaused((p) => !p)}>
          {paused ? <><Play /> Tiếp tục</> : <><Pause /> Tạm dừng</>}
        </button>
      </div>
      {error && <p className="text-red-team">{error}</p>}
      {!live ? (
        !error && <p className="opacity-60">Đang tải…</p>
      ) : (
        <>
          <Section title="Người chơi">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Đang kết nối game (socket)" value={live.rooms?.sockets ?? '—'} hint={live.rooms ? undefined : 'Socket.IO chưa chạy trong tiến trình này'} />
              <Stat label="Hoạt động 5 phút qua" value={live.activeUsers} hint="request/socket có phiên đăng nhập" />
              <Stat label="Đăng nhập trong 24h" value={stored?.users.loggedIn24h ?? '—'} hint={stored ? `trên ${stored.users.total} tài khoản` : undefined} />
              <Stat label="Lượt đăng nhập mới" value={live.logins} hint="từ lúc máy chủ khởi động" />
            </div>
          </Section>

          <Section title="Trận đấu online">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Đang diễn ra" value={live.rooms?.battles.length ?? '—'} hint={live.rooms ? `${live.rooms.rooms} phòng, ${live.rooms.lobbies} đang chờ` : undefined} />
              <Stat label="Tổng trận đã lưu" value={stored?.matches.total ?? '—'} hint={stored ? `${stored.matches.last24h} trận trong 24h · ${stored.matches.siege} thủ thành` : undefined} />
              <Stat label="Thắng / thua (phân định)" value={stored ? stored.matches.blue + stored.matches.red : '—'} hint={stored ? `Xanh thắng ${stored.matches.blue} (${pct(stored.matches.blue, stored.matches.total)}) · Đỏ thắng ${stored.matches.red} (${pct(stored.matches.red, stored.matches.total)})` : undefined} />
              <Stat label="Hòa" value={stored?.matches.draw ?? '—'} hint={stored ? pct(stored.matches.draw, stored.matches.total) : undefined} />
            </div>
            {data.storedError && <p className="text-sm text-red-team">Không đọc được thống kê Firestore: {data.storedError}</p>}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Trận bắt đầu (phiên này)" value={live.battles.started} />
              <Stat label="Kết quả đã lưu (phiên này)" value={sessionResults} hint={`Xanh ${live.battles.results.blue} · Đỏ ${live.battles.results.red} · Hòa ${live.battles.results.draw}`} tone="good" />
              <Stat label="Trận bị hủy (phiên này)" value={sessionVoided} tone={sessionVoided ? 'bad' : undefined} />
              <Stat label="Lỗi lưu kết quả" value={live.battles.saveFailed} tone={live.battles.saveFailed ? 'bad' : undefined} />
            </div>
            {live.battles.voided.length > 0 && (
              <div className="panel p-3 text-sm">
                <div className="mb-1 font-bold">Lý do hủy trận</div>
                <ul className="list-disc pl-5">
                  {live.battles.voided.map((v) => (
                    <li key={v.reason}>
                      {v.reason}: <b>{v.count}</b>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {live.rooms && live.rooms.battles.length > 0 && (
              <div className="panel overflow-x-auto p-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="px-2 py-1">Phòng</th>
                      <th className="px-2 py-1">Người chơi</th>
                      <th className="px-2 py-1">Bản đồ</th>
                      <th className="px-2 py-1">Chế độ</th>
                      <th className="px-2 py-1">Thời gian</th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.rooms.battles.map((b) => (
                      <tr key={b.code} className="border-t border-ink/10">
                        <td className="px-2 py-1 font-mono">{b.code}</td>
                        <td className="px-2 py-1">
                          {b.players.map((p, i) => (
                            <span key={p.side} className={SIDE_TEXT[p.side]}>
                              {i > 0 && ' · '}
                              {p.name}
                            </span>
                          ))}
                        </td>
                        <td className="px-2 py-1">{b.mapId}</td>
                        <td className="px-2 py-1">{b.siege ? 'Thủ thành' : 'Dã chiến'}</td>
                        <td className="px-2 py-1">{duration(Math.round((live.now - b.startedAt) / 1000))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="API">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Request /api" value={live.http.total} hint="từ lúc máy chủ khởi động" />
              <Stat label="Request lỗi (≥ 400)" value={live.http.failed} hint={pct(live.http.failed, live.http.total)} tone={live.http.failed ? 'bad' : undefined} />
              <Stat label="Lỗi máy chủ (5xx)" value={live.http.routes.filter((r) => r.status >= 500).reduce((n, r) => n + r.count, 0)} tone={live.http.routes.some((r) => r.status >= 500) ? 'bad' : undefined} />
              <Stat label="API lỗi khác nhau" value={live.http.routes.length} />
            </div>
            <div className="panel overflow-x-auto p-2">
              {live.http.routes.length === 0 ? (
                <p className="p-2 text-sm text-green-700"><Check /> Chưa có API nào lỗi.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="px-2 py-1">API</th>
                      <th className="px-2 py-1">Mã</th>
                      <th className="px-2 py-1">Số lần</th>
                      <th className="px-2 py-1">Lần cuối</th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.http.routes.map((r) => (
                      <tr key={`${r.method} ${r.path} ${r.status}`} className="border-t border-ink/10">
                        <td className="px-2 py-1 font-mono text-xs">
                          {r.method} {r.path}
                        </td>
                        <td className={`px-2 py-1 font-bold ${r.status >= 500 ? 'text-red-team' : ''}`}>{r.status}</td>
                        <td className="px-2 py-1">{r.count}</td>
                        <td className="px-2 py-1">{time(r.lastAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Section>

          <Section title="Máy chủ">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Uptime" value={duration(live.process.uptimeSec)} hint={`khởi động ${new Date(live.startedAt).toLocaleString('vi-VN')}`} />
              <Stat label="RAM (RSS)" value={`${live.process.rssMb} MB`} hint={`heap ${live.process.heapUsedMb}/${live.process.heapTotalMb} MB`} />
              <Stat label="Độ trễ event loop (p99)" value={`${live.process.eventLoopP99Ms} ms`} tone={live.process.eventLoopP99Ms > 100 ? 'bad' : undefined} />
              <Stat label="Node.js" value={live.process.node} />
            </div>
            <p className="text-xs opacity-60">Số liệu “phiên này” nằm trong bộ nhớ, reset khi máy chủ khởi động lại. Trận đấu với máy (AI) chạy hoàn toàn trên trình duyệt nên không được thống kê.</p>
          </Section>
        </>
      )}
    </div>
  );
}
