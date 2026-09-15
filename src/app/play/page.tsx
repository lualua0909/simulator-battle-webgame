import GameClient, { type Mode } from '@/components/game/GameClient';

export const metadata = { title: 'Chiến trường — Mini Battle Simulator' };

const MODES: Mode[] = ['ai', 'local', 'online'];

export default async function PlayPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const mode = MODES.includes(sp.mode as Mode) ? (sp.mode as Mode) : 'ai';
  const room = typeof sp.room === 'string' ? sp.room.toUpperCase() : undefined;
  return <GameClient key={mode} mode={mode} initialRoom={room} />;
}
