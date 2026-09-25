// Pushes the halved map sizes (from SEED) to the live content; the mini map is left alone.
//   npx tsx scripts/halve-maps.ts
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { getDoc, putDoc } = await import('../src/server/content');
  const { SEED } = await import('../src/shared/seed');
  for (const seed of SEED.maps) {
    if (seed.id === 'mini-map') continue;
    const live = await getDoc('maps', seed.id);
    if (!live) continue;
    await putDoc('maps', { ...live, size: seed.size, deployDepth: seed.deployDepth, defenseDepth: seed.defenseDepth });
    console.log(`maps/${seed.id}: size ${live.size} → ${seed.size}`);
  }
}

main().then(() => process.exit(0), (e) => {
  console.error(e);
  process.exit(1);
});
