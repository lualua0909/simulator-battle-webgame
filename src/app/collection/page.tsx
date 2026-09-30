import { Suspense } from 'react';
import CollectionPage from '@/components/player/CollectionPage';

export const metadata = { title: 'Card collection' };

export default function CollectionRoute() {
  // CollectionPage reads ?card= via useSearchParams, which needs a Suspense boundary.
  return (
    <Suspense>
      <CollectionPage />
    </Suspense>
  );
}
