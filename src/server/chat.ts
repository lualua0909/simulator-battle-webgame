// World chat writes: one transaction per message on `chat/world` (Admin SDK; clients only read it).
import { randomUUID } from 'node:crypto';
import { appendMessage, CHAT_COLLECTION, parseMessages, WORLD_CHAT_DOC, type ChatMessage } from '@/shared/chat';
import type { AppUser } from '@/shared/users';
import { firestore } from './firebase';

const RATE_WINDOW_MS = 10_000;
const RATE_MAX_MESSAGES = 5;
const lastWindow = new Map<string, { start: number; count: number }>();

export class ChatRateLimitError extends Error {}

function checkRateLimit(uid: string) {
  const now = Date.now();
  const w = lastWindow.get(uid);
  if (!w || now - w.start >= RATE_WINDOW_MS) {
    lastWindow.set(uid, { start: now, count: 1 });
    return;
  }
  if (++w.count > RATE_MAX_MESSAGES) throw new ChatRateLimitError('Gửi tin nhắn quá nhanh, thử lại sau');
}

export async function postWorldMessage(user: AppUser, text: string): Promise<ChatMessage> {
  checkRateLimit(user.uid);
  // The doc is public: never expose the email, not even its prefix.
  const message: ChatMessage = { id: randomUUID(), uid: user.uid, name: user.displayName || `Tướng quân ${user.uid.slice(0, 4)}`, photoURL: user.photoURL, text, at: Date.now() };
  const ref = firestore().collection(CHAT_COLLECTION).doc(WORLD_CHAT_DOC);
  await firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    tx.set(ref, { messages: appendMessage(parseMessages(snap.data()), message) });
  });
  return message;
}
