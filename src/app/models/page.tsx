import ModelsGallery from '@/components/ModelsGallery';
import { CHEST_VARIANTS, type ChestVariant } from '@/shared/schema';

export const metadata = { title: 'Xưởng mô hình — Mini Battle Simulator' };

type Search = Record<string, string | string[] | undefined>;

export default async function ModelsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const yaw = one('yaw');
  const chest = one('chest');
  return (
    <ModelsGallery
      initialUnit={one('unit')}
      initialAsset={one('asset')}
      initialSkill={one('skill')}
      initialChest={CHEST_VARIANTS.includes(chest as ChestVariant) ? (chest as ChestVariant) : undefined}
      chestOpen={one('open') === '1'}
      from={one('from')}
      modelId={one('modelId')}
      arena={one('arena') === '1'}
      yaw={yaw !== undefined ? Number(yaw) : undefined}
      explode={one('explode') === '1'}
      anim={(one('anim') as 'idle' | 'walk' | 'attack' | undefined) ?? 'idle'}
      bare={one('bare') === '1'}
    />
  );
}
