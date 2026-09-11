import { notFound } from 'next/navigation';
import CollectionList from '@/components/admin/CollectionList';
import { isCollection } from '@/shared/schema';

export default async function CollectionPage({ params }: { params: Promise<{ collection: string }> }) {
  const { collection } = await params;
  if (!isCollection(collection)) notFound();
  return <CollectionList collection={collection} />;
}
