// Swaps Người khổng lồ (unit giant) onto the skeletal giant-golem.glb and gives it
// its two attacks: the club/hammer (Attack_Hammer) plus the golem-nhay leap skill
// (Attack_Leap). Keeps every other field of the live docs.
//   npx tsx scripts/add-golem.ts
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { getDoc, putDoc } = await import('../src/server/content');
  const { SEED } = await import('../src/shared/seed');

  const leap = SEED.weapons.find((w) => w.id === 'golem-nhay')!;
  const liveLeap = await getDoc('weapons', leap.id);
  // Landing quake: splash radius + dust ring (keeps any other live tweaks).
  const { splashRadius, areaParticleId, vfxColor } = leap;
  await putDoc('weapons', liveLeap ? { ...liveLeap, splashRadius, areaParticleId, vfxColor } : leap);
  console.log(`đã ghi weapons/${leap.id} (splashRadius ${splashRadius})`);

  const asset = await getDoc('assets', 'm-giant');
  if (asset) {
    // Skinned files normalise to 2 m at scale 1: 9.2 m giant -> 4.6.
    await putDoc('assets', { ...asset, scale: 4.6, glb: { url: '/models/giant-golem.glb', fileName: 'giant-golem.glb', uploadedAt: Date.now(), tint: {}, hide: [] } });
    console.log('đã trỏ assets/m-giant -> /models/giant-golem.glb');
  } else console.log('bỏ qua assets/m-giant (không có)');

  const unit = await getDoc('units', 'giant');
  if (unit) {
    await putDoc('units', { ...unit, height: 9.2, skillIds: ['golem-nhay'], description: 'Nhảy tới đập xuống, một búa bay cả hàng.' });
    console.log('đã đặt units/giant skillIds = [golem-nhay]');
  } else console.log('bỏ qua units/giant (không có)');
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
