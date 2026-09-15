// World chat: one Firestore document `chat/world` holding the recent messages. Only the server
// writes it (POST /api/chat); every client listens to it read-only.
import { z } from 'zod';

export const CHAT_COLLECTION = 'chat';
export const WORLD_CHAT_DOC = 'world';
export const CHAT_MAX_CHARS = 500;
/** When the log reaches this many messages, only the newest CHAT_KEEP survive. */
export const CHAT_LIMIT = 100;
export const CHAT_KEEP = 10;

export const chatMessageSchema = z.object({
  id: z.string(),
  uid: z.string(),
  name: z.string(),
  photoURL: z.string().nullable(),
  text: z.string(),
  /** epoch ms, server clock */
  at: z.number(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatPostSchema = z.object({
  text: z.string().trim().min(1, 'Tin nhắn trống').max(CHAT_MAX_CHARS, `Tối đa ${CHAT_MAX_CHARS} ký tự`),
});

/** Messages stored in the document; malformed entries are dropped. */
export function parseMessages(data: unknown): ChatMessage[] {
  const list = (data as { messages?: unknown } | undefined)?.messages;
  if (!Array.isArray(list)) return [];
  return list.flatMap((m) => {
    const parsed = chatMessageSchema.safeParse(m);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Appends a message; once the log reaches CHAT_LIMIT it is cut to the newest CHAT_KEEP. */
export function appendMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const next = [...messages, message];
  return next.length >= CHAT_LIMIT ? next.slice(-CHAT_KEEP) : next;
}
