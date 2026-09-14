import ModelsGallery from '@/components/ModelsGallery';

export const metadata = { title: 'Xưởng mô hình — Đại Chiến Lô Nhô' };

type Search = Record<string, string | string[] | undefined>;

export default async function ModelsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const yaw = one('yaw');
  return (
    <ModelsGallery
      initialUnit={one('unit')}
      initialAsset={one('asset')}
      initialSkill={one('skill')}
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
