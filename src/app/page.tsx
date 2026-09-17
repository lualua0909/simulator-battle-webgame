import Link from 'next/link';
import WorldChat from '@/components/chat/WorldChat';
import GameTitle from '@/components/home/GameTitle';
import HeroBanner from '@/components/home/HeroBanner';
import Reveal from '@/components/home/Reveal';
import PlayerHud from '@/components/player/PlayerHud';

// Bố cục giữ như cũ: nav (PlayerHud góc phải) + 3 nút chế độ + Xưởng + chat.
// Chỉ khoác áo mới kiểu Unite: hero tím rực, dải zigzag, thẻ chế độ nổi khối.
const MODES = [
  {
    href: '/play?mode=bot',
    title: 'Đấu với máy',
    desc: 'Chọn đối thủ AI — từ Dễ tới Huyền thoại biết khắc chế đội hình của bạn.',
    icon: '🤖',
    ribbon: 'PHỔ BIẾN NHẤT',
    ribbonCls: 'bg-[#ffc233] text-[#2d3232]',
    ring: 'hover:shadow-[#ffc233]/40',
    iconBg: 'bg-gradient-to-b from-[#ffd76a] to-[#f59e0b]',
    cta: 'text-[#b25b00]',
  },
  {
    href: '/play?mode=local',
    title: '2 người 1 máy',
    desc: 'Lần lượt xếp quân bí mật rồi xem hai đạo quân lao vào nhau.',
    icon: '🎮',
    ribbon: 'VUI CÙNG BẠN BÈ',
    ribbonCls: 'bg-[#2f6fe0] text-white',
    ring: 'hover:shadow-[#2f6fe0]/40',
    iconBg: 'bg-gradient-to-b from-[#6aa6ff] to-[#2f6fe0]',
    cta: 'text-[#2f6fe0]',
  },
  {
    href: '/play?mode=online',
    title: 'Đấu online',
    desc: 'Tạo phòng, gửi mã cho bạn bè, trận đấu mô phỏng đồng bộ trên hai máy.',
    icon: '🌐',
    ribbon: 'THỬ THÁCH THẬT',
    ribbonCls: 'bg-[#d8373a] text-white',
    ring: 'hover:shadow-[#d8373a]/40',
    iconBg: 'bg-gradient-to-b from-[#ff7a7a] to-[#d8373a]',
    cta: 'text-[#d8373a]',
  },
];

const STEPS = [
  { n: '01', icon: '🛡️', title: 'Xếp quân', desc: 'Kéo thả tướng low-poly lên bàn cờ, xoay đội hình theo ý bạn.' },
  { n: '02', icon: '⚔️', title: 'Bấm bắt đầu', desc: 'AI điều khiển cả hai phe — không cần micro, chỉ cần chiến thuật.' },
  { n: '03', icon: '🏆', title: 'Xem hỗn loạn', desc: 'Wobbly ragdoll lao vào nhau, phe còn đứng vững thắng trận.' },
];

const TICKER = ['⚔️ XẾP QUÂN', '🤖 AI 4 CẤP ĐỘ', '🌐 ONLINE REAL-TIME', '🎨 XƯỞNG MÔ HÌNH', '🎁 QUÀ HẰNG NGÀY', '🏆 BẢNG XẾP HẠNG'];

export default function Home() {
  return (
    <main className="game-ui relative min-h-screen bg-[#1a1446]">
      {/* ===== NAV BAR (giữ nguyên vị trí: logo trái, PlayerHud phải) ===== */}
      <header className="sticky top-0 z-20 border-b-[3px] border-[#2d3232] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2">
          <Link href="/" className="flex items-center gap-2">
            <span className="bounce-soft inline-flex h-10 w-10 items-center justify-center rounded-xl border-2 border-[#2d3232] bg-gradient-to-b from-[#ffd76a] to-[#f59e0b] text-2xl shadow-[0_3px_0_0_#2d3232]">
              ⚔️
            </span>
            <span className="leading-none">
              <span className="block text-lg tracking-wide">MINI BATTLE</span>
              <span className="block text-sm text-[#b25b00]">SIMULATOR</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-4 md:flex" aria-label="Điều hướng">
            <a href="#choi-ngay" className="rounded-lg px-2 py-1 transition hover:bg-[#ffe9b8]">
              Chơi ngay
            </a>
            <a href="#cach-choi" className="rounded-lg px-2 py-1 transition hover:bg-[#ffe9b8]">
              Cách chơi
            </a>
            <a href="#tinh-nang" className="rounded-lg px-2 py-1 transition hover:bg-[#ffe9b8]">
              Tính năng
            </a>
          </nav>
          <PlayerHud />
        </div>
      </header>

      {/* ===== HERO (Unite: nền tím rực + chấm bi + mây trôi) =====
          Banner ảnh (nếu có file public/images/hero-banner.png) do HeroBanner
          tự nhận — xem HERO_BANNER_MODE trong HeroBanner.tsx để chọn làm nền
          hay thay toàn bộ hero. */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#241a6e] via-[#5b2ee5] to-[#8b5cf6]">
        <HeroBanner>
          <div className="relative mx-auto flex max-w-5xl flex-col items-center px-4 pb-40 pt-10 text-center sm:pb-48">
            <span className="reward-pop inline-flex items-center gap-2 rounded-full border-2 border-[#2d3232] bg-[#ffc233] px-4 py-1 shadow-[0_4px_0_0_#2d3232]">
              ⭐ MÙA GIẢI MỚI — TƯỚNG WOBBLY ĐÃ SẴN SÀNG ⭐
            </span>
            <GameTitle />
            <p className="mt-2 max-w-xl rounded-2xl border-2 border-white/40 bg-black/25 px-4 py-2 text-lg text-white">
              Mô phỏng đại chiến low-poly: xếp quân, bấm bắt đầu, xem hỗn loạn.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[#2d3232]">
              {['⚔️ 3 chế độ chơi', '🤖 AI 4 cấp độ', '🌐 Online real-time'].map((b) => (
                <span key={b} className="rounded-full border-2 border-[#2d3232] bg-white px-3 py-1 shadow-[0_3px_0_0_#2d3232]">
                  {b}
                </span>
              ))}
            </div>
          </div>
        </HeroBanner>
      </section>

      {/* ===== DẢI TICKER ===== */}
      <div className="overflow-hidden border-y-[3px] border-[#2d3232] bg-[#ffc233] py-2" id="tinh-nang" aria-hidden>
        <div className="marquee-track gap-8 pr-8">
          {[...TICKER, ...TICKER].map((t, i) => (
            <span key={i} className="whitespace-nowrap text-xl text-[#2d3232]">
              {t} <span className="ml-6">•</span>
            </span>
          ))}
        </div>
      </div>

      {/* ===== 3 CHẾ ĐỘ (giữ nguyên bố cục grid + href) ===== */}
      <section id="choi-ngay" className="relative bg-gradient-to-b from-[#ff8a1e] via-[#ff9d2e] to-[#ffb300] pb-14 pt-10">
        <div className="mx-auto max-w-6xl px-4">
          <Reveal>
            <h2 className="text-outline text-center text-4xl sm:text-5xl">CHỌN CHẾ ĐỘ CHIẾN ĐẤU</h2>
            <p className="mx-auto mt-2 max-w-xl text-center text-lg text-white drop-shadow-[0_2px_0_#2d3232]">
              Ba đấu trường, một mục tiêu: đội quân cuối cùng còn đứng vững!
            </p>
          </Reveal>
          <div className="mt-8 grid w-full gap-6 sm:grid-cols-3">
            {MODES.map((m, i) => (
              <Reveal key={m.href} variant="up" delay={(i % 3) * 110} className="h-full">
              <Link
                href={m.href}
                className={`mode-card group relative flex h-full flex-col overflow-hidden rounded-3xl border-[3px] border-[#2d3232] bg-white shadow-[0_8px_0_0_#2d3232] hover:shadow-[0_14px_0_0_#2d3232] ${m.ring}`}
              >
                <span className={`absolute left-3 top-3 z-10 rounded-full border-2 border-[#2d3232] px-3 py-0.5 text-sm ${m.ribbonCls}`}>
                  {m.ribbon}
                </span>
                <span className={`flex items-center justify-center pb-6 pt-12 ${m.iconBg}`}>
                  <span className="bounce-soft inline-flex h-24 w-24 items-center justify-center rounded-full border-[3px] border-[#2d3232] bg-white text-6xl shadow-[0_5px_0_0_#2d3232]">
                    {m.icon}
                  </span>
                </span>
                <span className="flex flex-1 flex-col gap-1 p-5 text-left">
                  <span className="text-2xl">{m.title}</span>
                  <span className="opacity-80">{m.desc}</span>
                  <span className={`mode-cta mt-3 inline-flex items-center gap-1 text-xl ${m.cta}`}>
                    CHƠI NGAY <span aria-hidden>→</span>
                  </span>
                </span>
              </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <div className="zigzag bg-[#ffb300]" style={{ ['--zz' as string]: '#fff' }} aria-hidden />

      {/* ===== CÁCH CHƠI ===== */}
      <section id="cach-choi" className="bg-white py-12">
        <div className="mx-auto max-w-6xl px-4">
          <Reveal>
            <h2 className="text-center text-4xl">
              ⚔️ NHẬP CUỘC <span className="text-[#f59e0b]">TRONG 3 BƯỚC</span>
            </h2>
          </Reveal>
          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} variant={i === 1 ? 'zoom' : i === 0 ? 'left' : 'right'} delay={i * 110} className="h-full">
              <div className="relative h-full rounded-3xl border-[3px] border-[#2d3232] bg-[#f6eedb] p-5 pt-8 text-center shadow-[0_6px_0_0_#2d3232]">
                <span className="absolute -top-5 left-1/2 inline-flex h-10 w-16 -translate-x-1/2 items-center justify-center rounded-full border-[3px] border-[#2d3232] bg-[#5b2ee5] text-lg text-white">
                  {s.n}
                </span>
                <div className="text-5xl">{s.icon}</div>
                <h3 className="mt-2 text-2xl">{s.title}</h3>
                <p className="mt-1 opacity-80">{s.desc}</p>
              </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ===== CTA CUỐI + FOOTER ===== */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#5b2ee5] to-[#241a6e] py-12 text-center">
        <div className="hero-dots absolute inset-0 opacity-40" aria-hidden />
        <Reveal variant="zoom" className="relative mx-auto max-w-2xl px-4">
          <h2 className="text-outline text-4xl sm:text-5xl">SẴN SÀNG XUẤT TRẬN?</h2>
          <p className="mt-2 text-lg text-white">Triệu hồi đội quân wobbly của bạn — miễn phí, không cần cài đặt.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link href="/play?mode=bot" className="btn btn-gold px-8 py-3 text-2xl">
              ⚔️ CHƠI NGAY
            </Link>
          </div>
        </Reveal>
      </section>
      <footer className="border-t-[3px] border-[#2d3232] bg-[#14102e] py-5 text-center text-white/80">
        <p>⚔️ MINI BATTLE SIMULATOR — xếp quân • mô phỏng • hỗn loạn vui vẻ</p>
      </footer>

      <WorldChat />
    </main>
  );
}
