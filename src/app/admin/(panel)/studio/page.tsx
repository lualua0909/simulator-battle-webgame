import Studio from '@/components/admin/studio/Studio';

export const metadata = { title: 'Xưởng img2threejs — CMS' };

export default async function StudioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { job } = await searchParams;
  return <Studio initialJob={typeof job === 'string' ? job : undefined} />;
}
