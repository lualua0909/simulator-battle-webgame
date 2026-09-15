// Points the horse asset (m-warhorse, used by cavalry too) at the committed GLB file.
//   npx tsx scripts/add-horse.ts
import { loadEnvConfig } from '@next/env';

const ASSET_ID = 'm-warhorse';
const URL = '/models/horse.glb';
const FILE_NAME = 'horse.glb';

async function main() {
  loadEnvConfig(process.cwd());
  const { getDoc, putDoc } = await import('../src/server/content');
  const doc = await getDoc('assets', ASSET_ID);
  if (!doc) {
    console.log(`bỏ qua assets/${ASSET_ID} (không có)`);
    return;
  }
  if (doc.glb?.url === URL) {
    console.log(`giữ nguyên assets/${ASSET_ID} (đã có)`);
    return;
  }
  await putDoc('assets', { ...doc, sculpt: null, glb: { url: URL, fileName: FILE_NAME, uploadedAt: Date.now(), tint: {}, hide: [] } });
  console.log(`đã trỏ assets/${ASSET_ID} -> ${URL}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
