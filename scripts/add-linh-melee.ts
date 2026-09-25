// Swaps Chiến binh gậy (unit clubber, renamed Lính cận chiến) and Người ném đá (unit stoner)
// onto the skeletal linh-melee.glb. Clubber punches (Attack_Punch) and gets the chuong palm
// skill (Attack_Palm); stoner's throw-stone gets castStyle throw, which plays Attack_Slash
// (the file has no throw clip). Keeps every other field of the live docs.
//   npx tsx scripts/add-linh-melee.ts
import { loadEnvConfig } from '@next/env';

const GLB = { url: '/models/linh-melee.glb', fileName: 'linh-melee.glb' };

async function main() {
  loadEnvConfig(process.cwd());
  const { getDoc, putDoc } = await import('../src/server/content');
  const { SEED } = await import('../src/shared/seed');

  for (const id of ['dam', 'chuong']) {
    if (await getDoc('weapons', id)) console.log(`giữ nguyên weapons/${id} (đã có)`);
    else {
      await putDoc('weapons', SEED.weapons.find((w) => w.id === id)!);
      console.log(`đã ghi weapons/${id}`);
    }
  }
  const stone = await getDoc('weapons', 'throw-stone');
  if (stone) {
    await putDoc('weapons', { ...stone, castStyle: 'throw' });
    console.log('đã đặt weapons/throw-stone castStyle = throw');
  } else console.log('bỏ qua weapons/throw-stone (không có)');

  // Skinned files normalise to 2 m at scale 1: 1.8 m soldier -> 0.9.
  for (const id of ['m-clubber', 'm-stoner']) {
    const asset = await getDoc('assets', id);
    if (!asset) {
      console.log(`bỏ qua assets/${id} (không có)`);
      continue;
    }
    const name = id === 'm-clubber' ? 'Lính cận chiến' : asset.name;
    await putDoc('assets', { ...asset, name, scale: 0.9, glb: { ...GLB, uploadedAt: Date.now(), tint: {}, hide: [] } });
    console.log(`đã trỏ assets/${id} -> ${GLB.url}`);
  }

  const unit = await getDoc('units', 'clubber');
  if (unit) {
    const seed = SEED.units.find((u) => u.id === 'clubber')!;
    await putDoc('units', { ...unit, name: seed.name, description: seed.description, weaponId: 'dam', skillIds: ['chuong'] });
    console.log('đã đổi units/clubber -> Lính cận chiến (dam + chuong)');
  } else console.log('bỏ qua units/clubber (không có)');
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
