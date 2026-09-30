import type { MetadataRoute } from 'next';

const SITE = 'https://mini-game-01.vercel.app';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE}/play`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE}/models`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE}/collection`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE}/topup`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
  ];
}
