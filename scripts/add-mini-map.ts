// Adds the "Mini map" floating island (from SEED) to the live content, if it is not there yet.
//   npx tsx scripts/add-mini-map.ts
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { getDoc, putDoc } = await import('../src/server/content');
  const { SEED } = await import('../src/shared/seed');
  const map = SEED.maps.find((m) => m.id === 'mini-map')!;
  if (await getDoc('maps', map.id)) {
    console.log(`giữ nguyên maps/${map.id} (đã có)`);
    return;
  }
  await putDoc('maps', map);
  console.log(`đã thêm maps/${map.id}`);
}

main().then(() => process.exit(0), (e) => {
  console.error(e);
  process.exit(1);
});
