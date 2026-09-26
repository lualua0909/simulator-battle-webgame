// Removes the retired "Dòng sông" (River) and "Thành sa mạc" (Desert Castle) maps from the live content.
//   npx tsx scripts/remove-retired-maps.ts
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { deleteDoc } = await import('../src/server/content');
  for (const id of ['song-xanh', 'thanh-sa-mac']) {
    console.log((await deleteDoc('maps', id)) ? `đã xoá maps/${id}` : `maps/${id} không tồn tại`);
  }
}

main().then(() => process.exit(0), (e) => {
  console.error(e);
  process.exit(1);
});
