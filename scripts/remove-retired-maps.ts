// Removes the retired "Dòng sông" (River), "Thành sa mạc" (Desert Castle) and "Đồng cỏ" (Meadow) maps from the live content.
//   npx tsx scripts/remove-retired-maps.ts
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { deleteDoc } = await import('../src/server/content');
  for (const id of ['song-xanh', 'thanh-sa-mac', 'dong-co']) {
    console.log((await deleteDoc('maps', id)) ? `đã xoá maps/${id}` : `maps/${id} không tồn tại`);
  }
}

main().then(() => process.exit(0), (e) => {
  console.error(e);
  process.exit(1);
});
