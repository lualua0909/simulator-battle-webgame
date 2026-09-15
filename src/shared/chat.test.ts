import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendMessage, CHAT_KEEP, CHAT_LIMIT, CHAT_MAX_CHARS, chatPostSchema, parseMessages, type ChatMessage } from './chat';

const msg = (i: number): ChatMessage => ({ id: String(i), uid: 'u', name: 'n', photoURL: null, text: `m${i}`, at: i });

test('the 100th message cuts the log to the newest 10, and the cycle repeats', () => {
  let log: ChatMessage[] = [];
  for (let i = 1; i < CHAT_LIMIT; i++) log = appendMessage(log, msg(i));
  assert.equal(log.length, CHAT_LIMIT - 1);
  log = appendMessage(log, msg(CHAT_LIMIT));
  assert.deepEqual(log.map((m) => m.at), [91, 92, 93, 94, 95, 96, 97, 98, 99, 100]);
  for (let i = CHAT_LIMIT + 1; i <= CHAT_LIMIT + (CHAT_LIMIT - CHAT_KEEP) - 1; i++) log = appendMessage(log, msg(i));
  assert.equal(log.length, CHAT_LIMIT - 1);
  log = appendMessage(log, msg(1000));
  assert.equal(log.length, CHAT_KEEP);
  assert.equal(log.at(-1)!.at, 1000);
});

test('posts are trimmed, non-empty and at most 500 characters', () => {
  assert.equal(chatPostSchema.safeParse({ text: '   ' }).success, false);
  assert.equal(chatPostSchema.safeParse({ text: 'x'.repeat(CHAT_MAX_CHARS) }).success, true);
  assert.equal(chatPostSchema.safeParse({ text: 'x'.repeat(CHAT_MAX_CHARS + 1) }).success, false);
  assert.equal(chatPostSchema.parse({ text: '  hi ' }).text, 'hi');
});

test('parseMessages drops malformed entries', () => {
  assert.deepEqual(parseMessages(undefined), []);
  assert.deepEqual(parseMessages({ messages: [msg(1), { text: 1 }] }), [msg(1)]);
});
