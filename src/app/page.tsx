import Link from 'next/link';
import WorldChat from '@/components/chat/WorldChat';
import PlayerHud from '@/components/player/PlayerHud';
import WorkshopButton from './WorkshopButton';

const MODES = [
  { href: '/play?mode=ai', title: 'Đấu với máy', desc: 'Chọn đối thủ AI — từ Tân binh tới Bạo chúa biết khắc chế đội hình của bạn.', icon: '🤖', cls: 'btn-gold' },
  { href: '/play?mode=local', title: '2 người 1 máy', desc: 'Lần lượt xếp quân bí mật rồi xem hai đạo quân lao vào nhau.', icon: '🎮', cls: 'btn-blue' },
  { href: '/play?mode=online', title: 'Đấu online', desc: 'Tạo phòng, gửi mã cho bạn bè, trận đấu mô phỏng đồng bộ trên hai máy.', icon: '🌐', cls: 'btn-red' },
];

export default function Home() {
  return (
    <main className="game-ui relative min-h-screen overflow-hidden bg-gradient-to-b from-[#5aa8f0] via-[#bfe0fb] to-[#f6eedb]">
      <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-[42vh] w-full" viewBox="0 0 1200 400" preserveAspectRatio="none" aria-hidden>
        <path d="M0 250 L150 170 L300 230 L470 120 L640 220 L820 140 L1000 230 L1200 160 L1200 400 L0 400Z" fill="#8fbf6a" />
        <path d="M0 310 L200 250 L380 300 L560 240 L760 305 L950 255 L1200 300 L1200 400 L0 400Z" fill="#6fae4b" />
        <path d="M0 360 L300 330 L620 365 L900 335 L1200 360 L1200 400 L0 400Z" fill="#5a9440" />
      </svg>
      <div className="absolute right-3 top-3 z-20">
        <PlayerHud />
      </div>
      <div className="relative mx-auto flex max-w-5xl flex-col items-center gap-8 px-4 pb-8 pt-24 sm:pt-16">
        <div className="text-center">
          <h1 className="text-outline text-5xl leading-none sm:text-7xl">MINI BATTLE</h1>
          <h1 className="text-outline text-5xl leading-none sm:text-7xl" style={{ color: 'var(--color-gold)' }}>
            SIMULATOR
          </h1>
          <p className="mt-3">Mô phỏng đại chiến low-poly: xếp quân, bấm bắt đầu, xem hỗn loạn.</p>
        </div>
        <div className="grid w-full gap-4 sm:grid-cols-3">
          {MODES.map((m) => (
            <Link key={m.href} href={m.href} className={`btn ${m.cls} flex-col items-start gap-1 p-5 text-left`}>
              <span className="text-3xl">{m.icon}</span>
              <span className="text-xl">{m.title}</span>
              <span className="opacity-90">{m.desc}</span>
            </Link>
          ))}
        </div>
        <WorkshopButton />
      </div>
      <WorldChat />
    </main>
  );
}
