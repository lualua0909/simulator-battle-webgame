import { notFound } from 'next/navigation';
import RankedAdmin from '@/components/admin/RankedAdmin';
import { IS_VERCEL } from '@/shared/deploy';

export default function RankedPage() {
  if (IS_VERCEL) notFound();
  return <RankedAdmin />;
}
