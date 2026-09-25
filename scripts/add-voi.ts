// Points each elephant asset at its own committed skeletal GLB, keeping the war elephant rider
// and removing the mammoth rider. Mammoth stays voi-mamut.glb; Chiến tượng (tượng binh)
// uses voi-trang.glb. Do not mix the two files.
//   npx tsx scripts/add-voi.ts
import { loadEnvConfig } from '@next/env';

// Skinned files normalise to 2 m at scale 1, so scale = unit height / 2
// (mammoth 4.2 m stays slightly bigger, as with the procedural presets).
const TARGETS = [
  { id: 'm-mammoth', scale: 2.1, url: '/models/voi-mamut.glb', fileName: 'voi-mamut.glb' },
  { id: 'm-war-elephant', scale: 2, url: '/models/voi-trang.glb', fileName: 'voi-trang.glb' },
] as const;

async function main() {
  loadEnvConfig(process.cwd());
  const { getDoc, putDoc } = await import('../src/server/content');
  const mammoth = await getDoc('units', 'mammoth');
  if (mammoth && mammoth.riderModelId !== null) {
    await putDoc('units', { ...mammoth, riderModelId: null });
    console.log('đã bỏ người cưỡi units/mammoth');
  }
  for (const t of TARGETS) {
    const doc = await getDoc('assets', t.id);
    if (!doc) {
      console.log(`bỏ qua assets/${t.id} (không có)`);
      continue;
    }
    if (doc.glb?.url === t.url && doc.scale === t.scale) {
      console.log(`giữ nguyên assets/${t.id} (đã có)`);
      continue;
    }
    await putDoc('assets', { ...doc, scale: t.scale, glb: { url: t.url, fileName: t.fileName, uploadedAt: Date.now(), tint: {}, hide: [] } });
    console.log(`đã trỏ assets/${t.id} -> ${t.url} (scale ${t.scale})`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
