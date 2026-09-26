// Points the fire dragon asset at its committed skeletal GLB. Rồng lửa is now
// GLB-only: the old procedural western builder was deleted (no fallback).
//   npx tsx scripts/add-rong-lua.ts
import { loadEnvConfig } from '@next/env';

// Skinned files normalise to 2 m at scale 1, so scale = unit height / 2
// (dragon unit height is 3 m).
const TARGET = { id: 'm-dragon', scale: 1.5, url: '/models/rong-lua.glb', fileName: 'rong-lua.glb' } as const;

async function main() {
  loadEnvConfig(process.cwd());
  const { getDoc, putDoc } = await import('../src/server/content');
  const doc = await getDoc('assets', TARGET.id);
  if (!doc) {
    console.log(`bỏ qua assets/${TARGET.id} (không có)`);
    return;
  }
  if (doc.glb?.url === TARGET.url && doc.scale === TARGET.scale) {
    console.log(`giữ nguyên assets/${TARGET.id} (đã có)`);
    return;
  }
  await putDoc('assets', { ...doc, scale: TARGET.scale, glb: { url: TARGET.url, fileName: TARGET.fileName, uploadedAt: Date.now(), tint: {}, hide: [] } });
  console.log(`đã trỏ assets/${TARGET.id} -> ${TARGET.url} (scale ${TARGET.scale})`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
