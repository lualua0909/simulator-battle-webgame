// Migrate Firestore units saved with the old starCards default (100/200/300/400/500)
// to the new scale (10/20/30/40/50, i.e. -90%).
//   npm run db:migrate-star-cards
import { loadEnvConfig } from '@next/env';

const OLD = [100, 200, 300, 400, 500];
const NEW = [10, 20, 30, 40, 50];

async function main() {
  loadEnvConfig(process.cwd());
  const { firestore } = await import('../src/server/firebase');
  const db = firestore();
  const snap = await db.collection('units').get();
  let migrated = 0;
  let skipped = 0;
  // NOTE: firebase-admin batches are single-use after commit; recreate per chunk.
  let b = db.batch();
  let n = 0;
  for (const d of snap.docs) {
    const data = d.data() as { starCards?: unknown };
    if (Array.isArray(data.starCards) && data.starCards.length === 5 && data.starCards.every((v, i) => v === OLD[i])) {
      b.set(d.ref, { starCards: NEW }, { merge: true });
      n++;
      migrated++;
      if (n >= 400) {
        await b.commit();
        b = db.batch();
        n = 0;
      }
    } else {
      skipped++;
    }
  }
  if (n > 0) await b.commit();
  console.log(`Xong: ${migrated} lính đổi 100/200/300/400/500 → 10/20/30/40/50, ${skipped} lính giữ nguyên (đã đúng hoặc custom).`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
