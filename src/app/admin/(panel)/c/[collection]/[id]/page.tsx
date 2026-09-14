import { notFound, redirect } from 'next/navigation';
import DocEditor from '@/components/admin/DocEditor';
import { isCollection } from '@/shared/schema';

export default async function EditPage({
  params,
  searchParams,
}: {
  params: Promise<{ collection: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { collection, id } = await params;
  const sp = await searchParams;
  if (!isCollection(collection)) notFound();
  const from = typeof sp.from === 'string' ? sp.from : undefined;
  const modelId = typeof sp.modelId === 'string' ? sp.modelId : undefined;
  // Units are edited in the model workshop.
  if (collection === 'units') redirect(`/models?${new URLSearchParams({ unit: id, ...(from && { from }), ...(modelId && { modelId }) })}`);
  return <DocEditor key={`${collection}/${id}/${from ?? ''}/${modelId ?? ''}`} collection={collection} id={id} from={from} modelId={modelId} />;
}
