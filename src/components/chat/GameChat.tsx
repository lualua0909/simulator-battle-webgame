'use client';

// In-game world chat overlay (deploy screen, right side). Idle it is a faint, background-less log that
// stays readable over the map; clicking it focuses the panel into a glass card with the reply box.
// Guests read along but get a sign-in button instead of the input. A Hide button folds it to an icon.
import { EyeOff, MessageCircle, Send, User } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CHAT_MAX_CHARS } from '@/shared/chat';
import { useAuth } from '@/components/auth/AuthProvider';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { chatTime, useWorldChat } from './useWorldChat';

const HIDDEN_KEY = 'sb-game-chat-hidden';

export default function GameChat({ className = '' }: { className?: string }) {
  const { t, locale } = useLanguage();
  const { user, openAuth } = useAuth();
  const [hidden, setHidden] = useState(false);
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState('');
  const { messages, sending, error, send } = useWorldChat(!hidden);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      setHidden(localStorage.getItem(HIDDEN_KEY) === '1');
    } catch {}
  }, []);
  function toggleHidden(next: boolean) {
    setHidden(next);
    setFocused(false);
    try {
      localStorage.setItem(HIDDEN_KEY, next ? '1' : '0');
    } catch {}
  }

  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, focused, hidden]);

  // Focusing the panel goes straight to the reply box.
  useEffect(() => {
    if (focused) input.current?.focus();
  }, [focused]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (await send(text)) setText('');
  }

  if (hidden) {
    return (
      <button className={`btn btn-icon pointer-events-auto h-10 w-10 ${className}`} onClick={() => toggleHidden(false)} aria-label={t('chat.show')} title={t('chat.show')}>
        <MessageCircle />
      </button>
    );
  }

  return (
    <div
      tabIndex={-1}
      className={`game-chat pointer-events-auto flex max-h-full min-h-0 w-[min(20rem,42vw)] flex-col outline-none ${focused ? 'is-focused' : ''} ${className}`}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
      // Typing here must not reach the deploy/battle shortcuts on window (X, Ctrl+Z, Space…).
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') (document.activeElement as HTMLElement | null)?.blur();
      }}
    >
      <div className="game-chat-header flex items-center justify-between gap-2 px-2 py-1">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-sm font-extrabold"><MessageCircle className="game-chat-icon" /> {t('chat.title')}</span>
        {/* No focus on press: focusing grows the panel upward and the release would miss the button. */}
        <button className="game-chat-hide flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-bold" onMouseDown={(e) => e.preventDefault()} onClick={() => toggleHidden(true)} title={t('chat.hide')} aria-label={t('chat.hide')}>
          <EyeOff /> <span className="hidden sm:inline">{t('chat.hide')}</span>
        </button>
      </div>
      <div ref={list} className="game-chat-list flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-1">
        {messages.length === 0 && <p className="game-chat-empty">{locale === 'vi' ? 'Chưa có tin nhắn nào.' : 'No messages yet.'}</p>}
        {messages.map((m) => (
          <p key={m.id} className="game-chat-line whitespace-pre-wrap break-words">
            <span className="game-chat-time">{chatTime(m.at, locale)} </span>
            <span className={`game-chat-name ${m.uid === user?.uid ? 'is-mine' : ''}`}>{m.name}:</span> {m.text}
          </p>
        ))}
      </div>
      {focused && error && <p className="world-chat-error mx-2 mb-1">{error}</p>}
      {focused &&
        (user ? (
          <form onSubmit={submit} className="flex items-center gap-1.5 p-2">
            <input ref={input} className="field game-chat-input min-w-0 flex-1" value={text} maxLength={CHAT_MAX_CHARS} onChange={(e) => setText(e.target.value)} placeholder={t('chat.placeholder')} enterKeyHint="send" autoComplete="off" />
            <button className="btn btn-gold shrink-0 px-2.5 py-1" disabled={sending || !text.trim()} aria-label={t('chat.send')}>
              <Send />
            </button>
          </form>
        ) : (
          <div className="p-2">
            <button className="btn btn-gold w-full py-1 text-sm" onClick={() => openAuth('signin')}>
              <User /> {t('chat.signinToChat')}
            </button>
          </div>
        ))}
    </div>
  );
}
