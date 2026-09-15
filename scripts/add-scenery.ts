// Points the scenery assets at the committed GLB files (keeps every other field untouched).
//   npx tsx scripts/add-scenery.ts
import { loadEnvConfig } from '@next/env';

const UPDATES: Array<{ id: string; scale: number; url: string; fileName: string }> = [
  { id: 'tree-pine', scale: 2.7, url: '/models/cay-thong.glb', fileName: 'cay thong.glb' },
  { id: 'tree-oak', scale: 2, url: '/models/cay-soi.glb', fileName: 'cay soi.glb' },
  { id: 'tree-snow', scale: 1.2, url: '/models/thong-phu-tuyet.glb', fileName: 'thong phu tuyet.glb' },
  { id: 'tree-birch', scale: 1.2, url: '/models/cay-bach-duong.glb', fileName: 'cay bach duong.glb' },
  { id: 'tree-dead', scale: 1.7, url: '/models/cay-kho.glb', fileName: 'cay kho.glb' },
  { id: 'tree-palm', scale: 1.75, url: '/models/cay-co.glb', fileName: 'cay co.glb' },
  { id: 'tree-cactus', scale: 4.8, url: '/models/xuong-rong.glb', fileName: 'xuong rong.glb' },
  { id: 'rock-sand', scale: 1.2, url: '/models/da-sa-thach.glb', fileName: 'da sa thach.glb' },
  { id: 'bush-green', scale: 0.4, url: '/models/bui-co.glb', fileName: 'bui co.glb' },
  { id: 'bush-berry', scale: 0.23, url: '/models/bui-qua-mong.glb', fileName: 'bui qua mong.glb' },
  { id: 'bush-dry', scale: 0.5, url: '/models/bui-kho.glb', fileName: 'bui kho.glb' },
];

async function main() {
  loadEnvConfig(process.cwd());
  const { getDoc, putDoc } = await import('../src/server/content');
  for (const u of UPDATES) {
    const doc = (await getDoc('assets', u.id))!;
    if (!doc) {
      console.log(`bỏ qua assets/${u.id} (không có)`);
      continue;
    }
    if (doc.glb?.url === u.url && doc.scale === u.scale) {
      console.log(`giữ nguyên assets/${u.id} (đã có)`);
      continue;
    }
    await putDoc('assets', { ...doc, scale: u.scale, glb: { url: u.url, fileName: u.fileName, uploadedAt: Date.now(), tint: {}, hide: [] } });
    console.log(`đã trỏ assets/${u.id} -> ${u.url} (scale ${u.scale})`);
  }
}

main().then(() => process.exit(0), (e) => {
  console.error(e);
  process.exit(1);
});
