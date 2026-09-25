'use client';

// Trang nạp xu: chọn gói → tạo đơn → quét QR VietQR động (số tiền + nội dung CK của đơn).
// Giao diện bám ảnh mẫu: nền tối, 2 thẻ (trái: gói + thông tin CK, phải: hướng dẫn + QR).
import { ArrowRight, Bot, Check, Diamond, Gift, Palette, Swords, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import PlayerHud from '@/components/player/PlayerHud';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { formatTopupCoins, formatVnd, vietqrImageUrl, type TopupOrder, type TopupPackage } from '@/shared/topup';

interface Config {
  bank: { bankId: string; bankName: string; accountNo: string; accountName: string };
  packages: TopupPackage[];
  pending: TopupOrder | null;
  orders: TopupOrder[];
}

const STATUS_CLS: Record<string, string> = {
  pending: 'bg-amber-400/15 text-amber-300 border-amber-300/30',
  confirmed: 'bg-emerald-400/15 text-emerald-300 border-emerald-300/30',
  cancelled: 'bg-white/5 text-white/40 border-white/15',
};

const TICKER_EN: Array<[LucideIcon, string]> = [
  [Swords, 'DEPLOY ARMY'],
  [Bot, 'AI 5 LEVELS'],
  [Palette, 'MODEL WORKSHOP'],
  [Gift, 'DAILY GIFTS'],
];
const TICKER_VI: Array<[LucideIcon, string]> = [
  [Swords, 'XẾP QUÂN'],
  [Bot, 'AI 5 CẤP ĐỘ'],
  [Palette, 'XƯỞNG MÔ HÌNH'],
  [Gift, 'QUÀ HẰNG NGÀY'],
];

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function TopupClient() {
  const { t, locale } = useLanguage();
  const STATUS_TXT: Record<string, string> = { pending: t('topup.pending'), confirmed: t('topup.approved'), cancelled: t('topup.rejected') };
  const { user, loading: authLoading, openAuth } = useAuth();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [pkg, setPkg] = useState(0);
  const [order, setOrder] = useState<TopupOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [qrOk, setQrOk] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/topup', { cache: 'no-store' });
      const data = (await res.json()) as Config & { error?: string };
      if (!res.ok) throw new Error(data.error ?? t('topup.loadError'));
      setCfg(data);
      if (data.pending) {
        setOrder(data.pending);
        const idx = data.packages.findIndex((p) => p.vnd === data.pending!.amountVnd && p.coins === data.pending!.coins);
        if (idx >= 0) setPkg(idx);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => setQrOk(true), [order?.id]);

  const create = async () => {
    if (!user) return openAuth('signin');
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/topup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ packageIndex: pkg }) });
      const data = (await res.json()) as { order?: TopupOrder; error?: string };
      if (!res.ok || !data.order) throw new Error(data.error ?? t('topup.loadError'));
      setOrder(data.order);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const downloadQr = async () => {
    if (!order) return;
    const url = vietqrImageUrl(order);
    try {
      const r = await fetch(url);
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `nap-xu-${order.content}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch {
      window.open(url, '_blank');
    }
  };

  const onCopy = async (key: string, text: string) => {
    if (await copy(text)) {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    }
  };

  const packages = cfg?.packages ?? [];
  const selected = packages[pkg];
  const bank = order?.bank ?? cfg?.bank;
  const qr = order ? vietqrImageUrl(order) : null;

  return (
    <main className="game-ui relative min-h-screen bg-gradient-to-b from-[#ff8717] to-[#ffbe45]">
      {/* ===== NAV BAR (giống trang chủ) ===== */}
      <header className="sticky top-0 z-20 border-b-[3px] border-[#2d3232] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2">
          <Link href="/" className="flex min-w-0 shrink items-center gap-2">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-[#2d3232] bg-gradient-to-b from-[#ffd76a] to-[#f59e0b] text-2xl">
              <Swords />
            </span>
            <span className="min-w-0 leading-none">
              <span className="block truncate text-base tracking-wide sm:text-lg">MINI BATTLE</span>
              <span className="block truncate text-sm text-[#b25b00]">NẠP XU</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-4 md:flex" aria-label="Điều hướng">
            <Link href="/#choi-ngay" className="rounded-lg px-2 py-1 transition hover:bg-[#ffe9b8]">
              Chơi ngay
            </Link>
            <Link href="/#cach-choi" className="rounded-lg px-2 py-1 transition hover:bg-[#ffe9b8]">
              Cách chơi
            </Link>
            <Link href="/#tinh-nang" className="rounded-lg px-2 py-1 transition hover:bg-[#ffe9b8]">
              Tính năng
            </Link>
          </nav>
          <PlayerHud />
        </div>
      </header>

      {/* ===== NỘI DUNG NẠP (nền đặc, không parallax/kính mờ để dễ đọc trên mobile) ===== */}
      <section className="bg-transparent">
        <div className="mx-auto grid max-w-6xl gap-4 px-4 py-8 lg:grid-cols-2">
        {/* ---------------- trái: gói + đơn ---------------- */}
        <section className="glass-card p-5">
          <h2 className="break-words text-sm font-bold tracking-[0.1em] text-[#c99a4b] sm:tracking-[0.2em]">GÓI NẠP</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            {packages.map((p, i) => (
              <button
                key={p.vnd}
                onClick={() => setPkg(i)}
                className={`min-h-[56px] break-words rounded-xl border px-3 py-3 text-left transition sm:px-4 ${i === pkg ? 'border-[#e8b34a] bg-white/[0.06] shadow-[0_0_0_1px_#e8b34a]' : 'border-white/10 bg-white/[0.02] hover:border-white/25'}`}
              >
                <span className="break-words text-base text-white">{formatVnd(p.vnd)} = {p.coins} xu</span>
              </button>
            ))}
            {packages.length === 0 && <p className="col-span-2 text-white/70">Đang tải gói nạp…</p>}
          </div>

          <h2 className="mt-6 break-words text-sm font-bold tracking-[0.1em] text-[#c99a4b] sm:tracking-[0.2em]">TẠO ĐƠN & QUÉT MÃ QR</h2>
          <p className="mt-1 text-white/75">Giữ nguyên số tiền và nội dung chuyển khoản để hệ thống khớp lệnh nhanh.</p>

          {bank && (
            <div className="mt-4 rounded-xl bg-white/[0.05] p-4">
              <dl className="flex flex-col gap-2 text-[15px]">
                <div className="flex items-center justify-between gap-2">
                  <dt className="shrink-0 text-white/70">Ngân hàng</dt>
                  <dd className="min-w-0 break-words text-right font-bold text-white">{bank.bankName}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="shrink-0 text-white/70">Chủ tài khoản</dt>
                  <dd className="min-w-0 break-words text-right font-bold text-white">{bank.accountName}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="shrink-0 text-white/70">Số tài khoản</dt>
                  <dd className="flex min-w-0 flex-1 items-center justify-end gap-2 break-all text-right font-bold tracking-wider text-white">
                    {bank.accountNo}
                    <button onClick={() => void onCopy('stk', bank.accountNo)} className="min-h-[36px] shrink-0 rounded-md border border-white/15 px-1.5 py-0.5 text-sm text-white/70 hover:bg-white/10" title="Sao chép STK">
                      {copied === 'stk' ? <><Check /> Đã chép</> : 'Chép'}
                    </button>
                  </dd>
                </div>
                {order && (
                  <div className="flex items-center justify-between gap-2 border-t border-white/10 pt-2">
                    <dt className="shrink-0 text-white/70">Nội dung CK</dt>
                    <dd className="flex min-w-0 flex-1 items-center justify-end gap-2 break-all text-right font-bold tracking-widest text-[#ffd76a]">
                      {order.content}
                      <button onClick={() => void onCopy('content', order.content)} className="min-h-[36px] shrink-0 rounded-md border border-[#e8b34a]/40 px-1.5 py-0.5 text-sm text-[#ffd76a] hover:bg-[#e8b34a]/10" title="Sao chép nội dung">
                        {copied === 'content' ? <><Check /> Đã chép</> : 'Chép'}
                      </button>
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          <div className="mt-3 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 sm:px-4">
              <div className="text-sm text-white/70">Số tiền</div>
              <div className="break-words text-right text-lg text-white">{selected ? formatVnd(selected.vnd) : '—'}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 sm:px-4">
              <div className="text-sm text-white/70">Xu nhận được</div>
              <div className="break-words text-right text-lg text-white">{selected ? formatTopupCoins(selected.coins) : '—'}</div>
            </div>
          </div>

          {error && <p className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}

          {!user && !authLoading && (
            <button onClick={() => openAuth('signin')} className="mt-4 w-full rounded-xl bg-gradient-to-b from-[#f5c86a] to-[#d99a2b] px-4 py-3 font-bold text-[#3a2500]">
              Đăng nhập để nạp xu
            </button>
          )}

          <Link href="/" className="mt-4 block text-center font-bold text-[#d9a441] hover:underline">
            Quay lại trang chính
          </Link>

          {cfg && cfg.orders.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-bold tracking-wider text-white/75">ĐƠN GẦN ĐÂY</h3>
              <ul className="mt-2 flex flex-col gap-1.5">
                {cfg.orders.slice(0, 5).map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-sm">
                    <span className="break-words font-bold text-white">{formatVnd(o.amountVnd)}</span>
                    <span className="text-white/70"><ArrowRight /> {formatTopupCoins(o.coins)}</span>
                    <span className="max-w-full truncate font-mono text-sm text-white/70" title={o.content}>{o.content}</span>
                    <span className={`ml-auto shrink-0 rounded-full border px-2 py-0.5 text-sm ${STATUS_CLS[o.status]}`}>{STATUS_TXT[o.status]}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* ---------------- phải: hướng dẫn + QR ---------------- */}
        <section className="glass-card flex flex-col p-5">
          <h2 className="break-words text-sm font-bold tracking-[0.1em] text-[#c99a4b] sm:tracking-[0.2em]">HƯỚNG DẪN NHANH</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-white/75">
            <li>Nhấn “Tạo đơn”, mở app ngân hàng và quét QR.</li>
            <li>Hệ thống đối chiếu & admin duyệt chỉ vài phút.</li>
          </ol>
          <p className="mt-2 text-white/70">Bạn có thể tải QR hoặc chuyển khoản thủ công, miễn giữ đúng nội dung.</p>

          <div className="mt-4 flex-1 rounded-xl bg-[#f2f2f4] p-3 text-center text-[#222]">
            {order && qr ? (
              <div className="flex h-full flex-col">
                <div className="text-4xl font-black tracking-tight">
                  <span className="text-[#d11f2d]">V</span>
                  <span className="text-[#d11f2d]">IET</span>
                  <span className="text-[#1e3a8a]">QR</span>
                </div>
                {qrOk ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qr} alt={`QR nạp ${order.content}`} onError={() => setQrOk(false)} className="mx-auto mt-2 max-h-80 w-full max-w-80 rounded-lg border border-[#1e3a8a]/40 bg-white object-contain" />
                ) : (
                  <div className="mx-auto mt-2 max-w-80 rounded-lg border border-dashed border-[#1e3a8a]/40 bg-white p-6 text-sm">
                    Không tải được ảnh QR tự động. Hãy chuyển khoản thủ công theo thông tin bên trái, giữ đúng số tiền và nội dung <b>{order.content}</b>.
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2 break-words text-sm font-bold">
                  <span className="italic text-[#1e3a8a]">napas 247</span>
                  <span className="text-gray-300">|</span>
                  <span className="max-w-full break-words text-xs uppercase tracking-wide text-[#d11f2d]">{order.bank.bankName} <Diamond className="fill-current" /></span>
                </div>
                <div className="mt-1 break-words text-sm font-bold uppercase">{order.bank.accountName}</div>
                <div className="break-words text-sm tracking-widest">{order.bank.accountNo}</div>
                <div className="break-words text-sm">Số tiền: {formatVnd(order.amountVnd).replace(' đ', '')} VND</div>
                <div className="break-words text-sm font-bold">Nội dung: {order.content}</div>
                <button onClick={() => void downloadQr()} className="mx-auto mt-2 min-h-[44px] rounded-lg border border-[#d9a441]/60 bg-white px-4 py-1.5 text-sm font-bold text-[#8a5a00] hover:bg-[#fff7e6]">
                  Tải QR
                </button>
              </div>
            ) : (
              <div className="flex h-full min-h-72 flex-col items-center justify-center gap-2 p-6 text-[#666]">
                <div className="text-4xl font-black tracking-tight">
                  <span className="text-[#d11f2d]">V</span>
                  <span className="text-[#d11f2d]">IET</span>
                  <span className="text-[#1e3a8a]">QR</span>
                </div>
                <p className="w-full max-w-full break-words text-sm sm:max-w-72">Chưa có đơn nạp. Chọn gói bên trái rồi nhấn “Tạo đơn và hiển thị QR” — mã QR động theo đúng số tiền và nội dung của bạn sẽ hiện ở đây.</p>
              </div>
            )}
          </div>

          <button
            onClick={() => void create()}
            disabled={busy || (!user && !!authLoading)}
            className="mt-4 w-full rounded-xl bg-gradient-to-b from-[#f5c86a] to-[#d99a2b] px-4 py-3 font-bold text-[#3a2500] shadow-[0_4px_0_0_#7a5200] transition active:translate-y-[2px] active:shadow-none disabled:opacity-60"
          >
            {busy ? 'Đang tạo đơn…' : order ? 'Tạo đơn mới và hiển thị QR' : 'Tạo đơn và hiển thị QR'}
          </button>
          {order && <p className="mt-2 break-words text-center text-sm text-white/70">Đơn {order.content} đang chờ duyệt — sau khi chuyển khoản, admin sẽ cộng {formatTopupCoins(order.coins)} trong vài phút.</p>}
        </section>
        </div>
      </section>

      {/* ===== TICKER (same as home) ===== */}
      <div className="overflow-hidden border-y-[3px] border-[#2d3232] bg-[#ffc233] py-2" aria-hidden>
        <div className="marquee-track gap-8 pr-8">
          {[...(locale === 'vi' ? TICKER_VI : TICKER_EN), ...(locale === 'vi' ? TICKER_VI : TICKER_EN)].map(([Icon, txt], i) => (
            <span key={i} className="whitespace-nowrap text-base text-[#2d3232] sm:text-xl">
              <Icon /> {txt} <span className="ml-6">•</span>
            </span>
          ))}
        </div>
      </div>
      <footer className="border-t-[3px] border-[#2d3232] bg-[#14102e] py-5 text-center text-white/80">
        <p><Swords /> {t('home.footer')}</p>
      </footer>
    </main>
  );
}
