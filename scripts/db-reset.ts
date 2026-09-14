// Restore the CMS content in Firestore to the built-in defaults.
//   npm run db:reset
import { loadEnvConfig } from '@next/env';
import { SEED } from '../src/shared/seed';

async function main() {
  loadEnvConfig(process.cwd());
  const { getContent, replaceContent } = await import('../src/server/content');
  await replaceContent(SEED);
  const content = await getContent();
  console.log(`Đã khôi phục dữ liệu mặc định: ${content.units.length} lính, ${content.maps.length} bản đồ, ${content.bots.length} bot.`);
}

main().then(
  // The Firestore listeners would keep the process alive.
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
