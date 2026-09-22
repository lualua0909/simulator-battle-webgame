import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Mini Battle Simulator',
    short_name: 'Mini Battle',
    description: 'Low-poly epic battles: fight AI, 2 players on 1 PC or online.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f6eedb',
    theme_color: '#1a1446',
    lang: 'en',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
