'use client';

// World chat state shared by the home-page panel and the in-game overlay: follows the Firestore doc
// `chat/world` live while `active`, and posts through /api/chat (the server owns the log).
import { doc, getFirestore, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { CHAT_COLLECTION, parseMessages, WORLD_CHAT_DOC, type ChatMessage } from '@/shared/chat';
import { firebaseApp } from '@/lib/firebase';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export const chatTime = (at: number, locale: string) => new Date(at).toLocaleTimeString(locale === 'vi' ? 'vi-VN' : 'en-US', { hour: '2-digit', minute: '2-digit' });

export function useWorldChat(active: boolean) {
  const { locale } = useLanguage();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    return onSnapshot(
      doc(getFirestore(firebaseApp()), CHAT_COLLECTION, WORLD_CHAT_DOC),
      (snap) => setMessages(parseMessages(snap.data())),
      (e) => setError(`${locale === 'vi' ? 'Không tải được phòng chat' : 'Could not load chat'}: ${e.message}`),
    );
  }, [active, locale]);

  /** Posts `text`; resolves true once the server accepted it. */
  async function send(text: string): Promise<boolean> {
    const body = text.trim();
    if (!body || sending) return false;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: body }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? (locale === 'vi' ? 'Chưa gửi được tin nhắn' : 'Could not send message'));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSending(false);
    }
  }

  return { messages, sending, error, send };
}
