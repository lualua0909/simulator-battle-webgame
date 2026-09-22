import GameClient, { type Mode } from '@/components/game/GameClient';
import { IS_VERCEL } from '@/shared/deploy';

export const metadata = { title: 'Battlefield' };

// Vercel has no Socket.IO server: online/ranked links (old invites included) fall back to bot.
const MODES: Mode[] = IS_VERCEL ? ['bot', 'local'] : ['bot', 'local', 'online', 'ranked'];

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
