// Points the fire-archer asset (m-fire-archer, used by Hỏa tiễn thủ) at the committed
// GLB file, hiding the pack's spare weapon arsenal. Keeps scale/params and all else.
//   npx tsx scripts/add-hoa-tien-thu.ts
import { loadEnvConfig } from '@next/env';
import { SEED } from '../src/shared/seed';

const ASSET_ID = 'm-fire-archer';

async function main() {
  loadEnvConfig(process.cwd());
  const { getDoc, putDoc } = await import('../src/server/content');
  const doc = await getDoc('assets', ASSET_ID);
  if (!doc) {
    console.log(`bỏ qua assets/${ASSET_ID} (không có)`);
    return;
  }
  const want = SEED.assets.find((a) => a.id === ASSET_ID)!;
  const wantGlb = want.glb!;
  const same = (xs: readonly string[] | undefined, ys: readonly string[]) => JSON.stringify([...(xs ?? [])].sort()) === JSON.stringify([...ys].sort());
  if (doc.glb?.url === wantGlb.url && same(doc.glb.hide, wantGlb.hide)) {
    console.log(`giữ nguyên assets/${ASSET_ID} (đã có)`);
    return;
  }
  await putDoc('assets', { ...doc, sculpt: null, glb: { url: wantGlb.url, fileName: wantGlb.fileName, uploadedAt: Date.now(), tint: {}, hide: wantGlb.hide } });
  console.log(`đã trỏ assets/${ASSET_ID} -> ${wantGlb.url} (ẩn ${wantGlb.hide.length} vũ khí thừa)`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
