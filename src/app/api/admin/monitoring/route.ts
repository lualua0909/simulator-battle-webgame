import { Timestamp, type Query } from 'firebase-admin/firestore';
import { USERS_COLLECTION } from '@/shared/users';
import { guard } from '@/server/admin';
import { firestore } from '@/server/firebase';
import { MATCHES_COLLECTION } from '@/server/matches';
import { metricsSnapshot, type StoredStats } from '@/server/metrics';

export const dynamic = 'force-dynamic';

const CACHE_MS = 30_000;
const DAY_MS = 24 * 3600_000;

const cache = globalThis as unknown as { __monitoringStats?: StoredStats };

/** Totals from Firestore (count aggregations), cached so polling the screen stays cheap. */
async function storedStats(): Promise<StoredStats> {
  const hit = cache.__monitoringStats;
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const db = firestore();
  const since = Timestamp.fromMillis(Date.now() - DAY_MS);
  const users = db.collection(USERS_COLLECTION);
  const matches = db.collection(MATCHES_COLLECTION);
  const count = async (q: Query) => (await q.count().get()).data().count;
  const [total, loggedIn24h, matchTotal, last24h, blue, red, draw, siege] = await Promise.all([
    count(users),
    count(users.where('lastLoginAt', '>=', since)),
    count(matches),
    count(matches.where('endedAt', '>=', since)),
    count(matches.where('winner', '==', 'blue')),
    count(matches.where('winner', '==', 'red')),
    count(matches.where('winner', '==', 'draw')),
    count(matches.where('defense', 'in', ['blue', 'red'])),
  ]);
  return (cache.__monitoringStats = { at: Date.now(), users: { total, loggedIn24h }, matches: { total: matchTotal, last24h, blue, red, draw, siege } });
}

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  let stored: StoredStats | null = null;
  let storedError: string | null = null;
  try {
    stored = await storedStats();
  } catch (e) {
    storedError = e instanceof Error ? e.message : String(e);
  }
  return Response.json({ live: metricsSnapshot(), stored, storedError });
}
