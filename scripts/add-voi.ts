// Points the elephant assets (m-mammoth + m-war-elephant, the latter is the mount of
// tượng binh / Chiến tượng) at the committed GLB file, keeping riders and all other fields.
//   npx tsx scripts/add-voi.ts
import { loadEnvConfig } from '@next/env';

const URL = '/models/voi.glb';
const FILE_NAME = 'voi.glb';

// Authored height of voi.glb is ~8.29 m; scale down to the units' ~4 m body height
// (mammoth stays slightly bigger, as with the procedural presets).
const TARGETS = [
  { id: 'm-mammoth', scale: 0.55 },
  { id: 'm-war-elephant', scale: 0.5 },
] as const;

async function main() {
  loadEnvConfig(process.cwd());
  const { getDoc, putDoc } = await import('../src/server/content');
  for (const t of TARGETS) {
    const doc = await getDoc('assets', t.id);
    if (!doc) {
      console.log(`bỏ qua assets/${t.id} (không có)`);
      continue;
    }
    if (doc.glb?.url === URL && doc.scale === t.scale) {
      console.log(`giữ nguyên assets/${t.id} (đã có)`);
      continue;
    }
    await putDoc('assets', { ...doc, scale: t.scale, sculpt: null, glb: { url: URL, fileName: FILE_NAME, uploadedAt: Date.now(), tint: {}, hide: [] } });
    console.log(`đã trỏ assets/${t.id} -> ${URL} (scale ${t.scale})`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
