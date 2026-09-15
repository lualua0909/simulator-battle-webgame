import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isOnline, ONLINE_WINDOW_MS } from './users';

test('online only within 5 minutes of the last ping, by the server clock', () => {
  const now = 1_000_000_000;
  assert.equal(isOnline({ lastActiveAt: null }, now), false);
  assert.equal(isOnline({ lastActiveAt: now - 60_000 }, now), true);
  assert.equal(isOnline({ lastActiveAt: now - ONLINE_WINDOW_MS }, now), true);
  assert.equal(isOnline({ lastActiveAt: now - ONLINE_WINDOW_MS - 1 }, now), false);
});
