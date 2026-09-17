// Migrate tất cả giá coin về /100 (2026-09):
// units: unlockCost, cardPrice, starCoins ; settings/global: dailyBox.coins, hourlyBox.coins.
//   npm run db:migrate-coins-100x
import { loadEnvConfig } from '@next/env';

const div100 = (v: number) => Math.round(v / 100);

async function main() {
  loadEnvConfig(process.cwd());
  const { firestore } = await import('../src/server/firebase');
  const db = firestore();

  // ---- units
  const snap = await db.collection('units').get();
  let b = db.batch();
  let n = 0;
  let migratedUnits = 0;
  const samples: string[] = [];
  for (const d of snap.docs) {
    const data = d.data() as { unlockCost?: unknown; cardPrice?: unknown; starCoins?: unknown; name?: unknown };
    const patch: Record<string, unknown> = {};
    if (typeof data.unlockCost === 'number' && data.unlockCost > 0) {
      const v = div100(data.unlockCost);
      if (v !== data.unlockCost) patch.unlockCost = v;
    }
    if (typeof data.cardPrice === 'number' && data.cardPrice > 0) {
      // 0 = không bán, giữ nguyên. Còn lại /100 nhưng tối thiểu 1 để không thành "không bán".
      const v = Math.max(1, div100(data.cardPrice));
      if (v !== data.cardPrice) patch.cardPrice = v;
    }
    if (Array.isArray(data.starCoins) && data.starCoins.length === 5 && data.starCoins.every((v) => typeof v === 'number')) {
      const v = (data.starCoins as number[]).map(div100);
      if (v.some((x, i) => x !== (data.starCoins as number[])[i])) patch.starCoins = v;
    }
    if (Object.keys(patch).length > 0) {
      b.set(d.ref, patch, { merge: true });
      n++;
      migratedUnits++;
      if (samples.length < 5) samples.push(`${d.id}: ${JSON.stringify(patch)}`);
      if (n >= 400) {
        await b.commit();
        b = db.batch();
        n = 0;
      }
    }
  }
  if (n > 0) await b.commit();

  // ---- settings/global economy
  let settingsMsg = 'settings/global: không đổi';
  const ref = db.doc('settings/global');
  const settingsSnap = await ref.get();
  if (settingsSnap.exists) {
    const s = settingsSnap.data() as { economy?: { dailyBox?: { coins?: unknown }; hourlyBox?: { coins?: unknown } } };
    const patch: Record<string, unknown> = {};
    const daily = s.economy?.dailyBox?.coins;
    if (Array.isArray(daily) && daily.length === 2 && daily.every((v) => typeof v === 'number')) {
      const v = (daily as number[]).map(div100);
      if (v.some((x, i) => x !== (daily as number[])[i])) patch['economy.dailyBox.coins'] = v;
    }
    const hourly = s.economy?.hourlyBox?.coins;
    if (Array.isArray(hourly) && hourly.length === 2 && hourly.every((v) => typeof v === 'number')) {
      const v = (hourly as number[]).map((x) => Math.max(1, div100(x)));
      if (v.some((x, i) => x !== (hourly as number[])[i])) patch['economy.hourlyBox.coins'] = v;
    }
    if (Object.keys(patch).length > 0) {
      // Dùng update() cho dotted paths; set(..., {merge:true}) sẽ tạo field tên chứa dấu chấm.
      await ref.update(patch);
      settingsMsg = `settings/global: ${JSON.stringify(patch)}`;
    }
  } else {
    settingsMsg = 'settings/global: chưa có document (sẽ dùng SEED mới)';
  }

  console.log(`Xong: ${migratedUnits}/${snap.size} lính đã /100.`);
  for (const s of samples) console.log('  ' + s);
  console.log(settingsMsg);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
