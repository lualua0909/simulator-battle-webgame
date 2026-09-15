// World chat writes: one transaction per message on `chat/world` (Admin SDK; clients only read it).
import { randomUUID } from 'node:crypto';
import { appendMessage, CHAT_COLLECTION, parseMessages, WORLD_CHAT_DOC, type ChatMessage } from '@/shared/chat';
import type { AppUser } from '@/shared/users';
import { firestore } from './firebase';

export async function postWorldMessage(user: AppUser, text: string): Promise<ChatMessage> {
  // The doc is public: never expose the email, not even its prefix.
  const message: ChatMessage = { id: randomUUID(), uid: user.uid, name: user.displayName || `Tướng quân ${user.uid.slice(0, 4)}`, photoURL: user.photoURL, text, at: Date.now() };
  const ref = firestore().collection(CHAT_COLLECTION).doc(WORLD_CHAT_DOC);
  await firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    tx.set(ref, { messages: appendMessage(parseMessages(snap.data()), message) });
  });
  return message;
}
