'use client';

// World chat: a floating button in the bottom-right corner opening a panel that follows the
// Firestore doc `chat/world` live. Sending goes through /api/chat (the server owns the log).
import { Earth, MessageCircle, User, X } from 'lucide-react';
import { doc, getFirestore, onSnapshot } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import { CHAT_COLLECTION, CHAT_MAX_CHARS, parseMessages, WORLD_CHAT_DOC, type ChatMessage } from '@/shared/chat';
import { useAuth } from '@/components/auth/AuthProvider';
import PlayerAvatar from '@/components/player/PlayerAvatar';
import { firebaseApp } from '@/lib/firebase';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const time = (at: number, locale: string) => new Date(at).toLocaleTimeString(locale === 'vi' ? 'vi-VN' : 'en-US', { hour: '2-digit', minute: '2-digit' });

export default function WorldChat() {
  const { t, locale } = useLanguage();
  const { user, openAuth } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    return onSnapshot(
      doc(getFirestore(firebaseApp()), CHAT_COLLECTION, WORLD_CHAT_DOC),
      (snap) => setMessages(parseMessages(snap.data())),
      (e) => setError(`${locale === 'vi' ? 'Không tải được phòng chat' : 'Could not load chat'}: ${e.message}`),
    );
  }, [open, locale]);

  // New messages (and opening the panel) scroll to the bottom.
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: body }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? (locale === 'vi' ? 'Chưa gửi được tin nhắn' : 'Could not send message'));
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-[max(0.75rem,env(safe-area-inset-right))] z-30 flex flex-col items-end gap-3">
      {open && (
        <div className="panel flex bg-paper h-[min(32rem,70dvh)] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b-2 border-ink/20 px-3 py-2">
            <span className="text-outline min-w-0 truncate text-xl"><Earth /> {t('chat.title')}</span>
            <button className="btn min-h-[40px] min-w-[40px] shrink-0 px-2 py-0" onClick={() => setOpen(false)} aria-label={t('common.close')}>
              <X />
            </button>
          </div>
          <div ref={list} className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">
            {messages.length === 0 && <p className="m-auto opacity-60">{locale === 'vi' ? 'Chưa có tin nhắn nào.' : 'No messages yet.'}</p>}
            {messages.map((m) => {
              const mine = m.uid === user?.uid;
              return (
                <div key={m.id} className={`flex items-end gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
                  <PlayerAvatar user={m} size={32} className="shrink-0 rounded-full border-2 border-ink bg-[#bfe3ff]" />
                  <div className={`max-w-[75%] rounded-xl border-2 border-ink/70 px-2 py-1 ${mine ? 'bg-[#cfe8ff]' : 'bg-white'}`}>
                    <div className="flex min-w-0 items-baseline gap-2 text-sm opacity-70">
                      <span className="truncate" title={m.name}>{m.name}</span>
                      <span className="shrink-0">{time(m.at, locale)}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  </div>
                </div>
              );
            })}
          </div>
          {error && <p className="px-3 text-red-team">{error}</p>}
          {user ? (
            <form onSubmit={send} className="flex items-center gap-2 border-t-2 border-ink/20 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              <div className="relative min-w-0 flex-1">
                <input className="field pr-14" value={text} maxLength={CHAT_MAX_CHARS} onChange={(e) => setText(e.target.value)} placeholder={t('chat.placeholder')} enterKeyHint="send" autoComplete="off" />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm opacity-50">
                  {text.length}/{CHAT_MAX_CHARS}
                </span>
              </div>
              <button className="btn btn-gold min-h-[40px] shrink-0 px-3 py-1" disabled={sending || !text.trim()}>
                {t('chat.send')}
              </button>
            </form>
          ) : (
            <div className="border-t-2 border-ink/20 p-2">
              <button className="btn btn-gold w-full" onClick={() => openAuth('signin')}>
                <User /> {t('chat.signinToChat')}
              </button>
            </div>
          )}
        </div>
      )}
      <button className="btn btn-blue h-14 w-14 rounded-full p-0 text-2xl" onClick={() => setOpen((o) => !o)} aria-label={t('chat.title')} title={t('chat.title')}>
        <MessageCircle />
      </button>
    </div>
  );
}
