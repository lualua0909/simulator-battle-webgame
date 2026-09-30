'use client';

// Standalone /collection page: loads its own config bundle + unit thumbnails and renders the
// card collection full screen. The selected card lives in ?card=<unitId>. Closing goes back to where the player came from (home if opened directly).
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { unitThumbnails } from '@/game/render/thumbnails';
import { useConfig } from '@/game/useConfig';
import Collection from './Collection';

export default function CollectionPage() {
  const router = useRouter();
  const card = useSearchParams().get('card');
  const { bundle, error } = useConfig();
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (bundle) void unitThumbnails(bundle).then(setThumbs);
  }, [bundle]);

  const close = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push('/');
  }, [router]);

  // replace, not push: picking cards must not pile up history the close button walks back through.
  const select = useCallback(
    (id: string | null) => router.replace(id ? `/collection?card=${encodeURIComponent(id)}` : '/collection', { scroll: false }),
    [router],
  );

  if (!bundle) {
    return (
      <div className="game-ui box-backdrop fixed inset-0 flex items-center justify-center">
        <span className="text-outline text-2xl">{error ?? '…'}</span>
      </div>
    );
  }
  return <Collection bundle={bundle} thumbs={thumbs} selectedId={card} onSelect={select} onClose={close} />;
}
