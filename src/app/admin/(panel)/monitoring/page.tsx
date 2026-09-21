import { notFound } from 'next/navigation';
import { Monitoring } from '@/components/admin/Monitoring';
import { IS_VERCEL } from '@/shared/deploy';

export default function MonitoringPage() {
  if (IS_VERCEL) notFound();
  return <Monitoring />;
}
