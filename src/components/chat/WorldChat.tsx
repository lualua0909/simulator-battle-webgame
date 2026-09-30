'use client';

// World chat: a floating button in the bottom-right corner opening a panel that follows the
// Firestore doc `chat/world` live. Sending goes through /api/chat (the server owns the log).
import { Earth, MessageCircle, Send, User, X } from 'lucide-react';
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
        <div className="panel world-chat flex h-[min(32rem,70dvh)] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden p-0">
          <div className="world-chat-header flex items-center justify-between gap-2 px-3 py-2">
            <span className="text-outline flex min-w-0 items-center gap-2 truncate text-xl"><Earth className="world-chat-globe" /> {t('chat.title')}</span>
            <button className="btn btn-red btn-icon h-9 w-9" onClick={() => setOpen(false)} aria-label={t('common.close')}>
              <X />
            </button>
          </div>
          <div ref={list} className="world-chat-list flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
            {messages.length === 0 && <p className="world-chat-empty m-auto">{locale === 'vi' ? 'Chưa có tin nhắn nào.' : 'No messages yet.'}</p>}
            {messages.map((m) => {
              const mine = m.uid === user?.uid;
              return (
                <div key={m.id} className={`flex items-end gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
                  <PlayerAvatar user={m} size={32} className="world-chat-avatar shrink-0 rounded-full" />
                  <div className={`world-chat-bubble max-w-[75%] ${mine ? 'world-chat-mine' : ''}`}>
                    <div className={`flex min-w-0 items-baseline gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
                      <span className="world-chat-name truncate" title={m.name}>{m.name}</span>
                      <span className="world-chat-time shrink-0">{time(m.at, locale)}</span>
                    </div>
                    <p className="world-chat-text whitespace-pre-wrap break-words">{m.text}</p>
                  </div>
                </div>
              );
            })}
          </div>
          {error && <p className="world-chat-error mx-3 mb-2">{error}</p>}
          {user ? (
            <form onSubmit={send} className="world-chat-footer flex items-center gap-2 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              <div className="relative min-w-0 flex-1">
                <input className="field world-chat-input w-full pr-14" value={text} maxLength={CHAT_MAX_CHARS} onChange={(e) => setText(e.target.value)} placeholder={t('chat.placeholder')} enterKeyHint="send" autoComplete="off" />
                <span className="world-chat-count pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                  {text.length}/{CHAT_MAX_CHARS}
                </span>
              </div>
              <button className="btn btn-gold min-h-[42px] shrink-0 px-3 py-1" disabled={sending || !text.trim()} aria-label={t('chat.send')}>
                <Send />
              </button>
            </form>
          ) : (
            <div className="world-chat-footer p-2">
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
