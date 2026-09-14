import { notFound, redirect } from 'next/navigation';
import CollectionList from '@/components/admin/CollectionList';
import { isCollection } from '@/shared/schema';

export default async function CollectionPage({ params }: { params: Promise<{ collection: string }> }) {
  const { collection } = await params;
  if (!isCollection(collection)) notFound();
  // Units are edited in the model workshop.
  if (collection === 'units') redirect('/models');
  return <CollectionList collection={collection} />;
}
