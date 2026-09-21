import GameClient, { type Mode } from '@/components/game/GameClient';

export const metadata = { title: 'Chiến trường — Mini Battle Simulator' };

const MODES: Mode[] = ['bot', 'local', 'online', 'ranked'];

export default async function PlayPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const raw = typeof sp.mode === 'string' ? sp.mode : 'bot';
  // Tương thích link cũ ?mode=ai → bot.
  const mode = raw === 'ai' ? 'bot' : MODES.includes(raw as Mode) ? (raw as Mode) : 'bot';
  const room = typeof sp.room === 'string' ? sp.room.toUpperCase() : undefined;
  // Keying by room too: navigating to a different room's invite link while already on this page
  // must fully remount (fresh socket, fresh room/seat/opponent state), not reuse the old instance.
  return <GameClient key={`${mode}:${room ?? ''}`} mode={mode} initialRoom={room} />;
}
