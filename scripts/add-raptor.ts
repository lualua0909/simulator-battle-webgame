// Adds the dinosaur weapon + asset + unit docs from SEED to Firestore.
// Existing documents are left untouched (never overwrites admin edits).
//   npx tsx scripts/add-raptor.ts
import { loadEnvConfig } from '@next/env';
import { SEED } from '../src/shared/seed';

const WEAPONS = ['raptor-bite', 'rex-bite', 'stego-tail', 'para-tail', 'tri-horns'];
const ASSETS = ['m-raptor', 'm-t-rex', 'm-stegosaurus', 'm-parasaurolophus', 'm-triceratops'];
const UNITS = ['raptor', 't-rex', 'stegosaurus', 'parasaurolophus', 'triceratops'];

async function main() {
  loadEnvConfig(process.cwd());
  const { getDoc, putDoc } = await import('../src/server/content');

  for (const id of WEAPONS) {
    const doc = SEED.weapons.find((w) => w.id === id)!;
    if (await getDoc('weapons', id)) console.log(`giữ nguyên weapons/${id} (đã có)`);
    else {
      await putDoc('weapons', doc);
      console.log(`đã thêm weapons/${id}`);
    }
  }
  for (const id of ASSETS) {
    const doc = SEED.assets.find((a) => a.id === id)!;
    if (await getDoc('assets', id)) console.log(`giữ nguyên assets/${id} (đã có)`);
    else {
      await putDoc('assets', doc);
      console.log(`đã thêm assets/${id}`);
    }
  }
  for (const id of UNITS) {
    const doc = SEED.units.find((u) => u.id === id)!;
    if (await getDoc('units', id)) console.log(`giữ nguyên units/${id} (đã có)`);
    else {
      await putDoc('units', doc);
      console.log(`đã thêm units/${id}`);
    }
  }
}

main().then(
  // The Firestore listeners would keep the process alive.
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
