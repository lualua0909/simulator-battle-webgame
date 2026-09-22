import type { Metadata, Viewport } from 'next';
import { Paytone_One } from 'next/font/google';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Analytics } from '@vercel/analytics/next';
import AuthProvider from '@/components/auth/AuthProvider';
import PlayerProvider from '@/components/player/PlayerProvider';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import './globals.css';

const paytone = Paytone_One({ weight: '400', subsets: ['latin', 'vietnamese'], variable: '--font-paytone' });

const SITE_URL = 'https://mini-game-01.vercel.app';
const SITE_NAME = 'Mini Battle Simulator';
const DESCRIPTION =
  'Low-poly epic battles: deploy your army, fight AI, 2 players on 1 PC or online. Watch joyful wobbly ragdoll chaos — free in your browser.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Mini Battle Simulator — Low-poly epic battle sandbox',
    template: '%s — Mini Battle Simulator',
  },
  description: DESCRIPTION,
  keywords: [
    'mini battle simulator',
    'battle simulator game',
    'army placement tactics game',
    'low-poly game',
    'wobbly battle',
    '2 players 1 pc game',
    'online battle game',
    'free browser game',
  ],
  authors: [{ name: 'Mini Battle Simulator' }],
  creator: 'Mini Battle Simulator',
  publisher: 'Mini Battle Simulator',
  category: 'games',
  alternates: { canonical: '/' },
  robots: { index: true, follow: true },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32' },
      { url: '/icons/icon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icons/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/favicon.ico',
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  manifest: '/manifest.webmanifest',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: '/',
    siteName: SITE_NAME,
    title: 'Mini Battle Simulator — Low-poly epic battle sandbox',
    description: DESCRIPTION,
    images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'Mini Battle Simulator — low-poly epic battle sandbox' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mini Battle Simulator — Low-poly epic battle sandbox',
    description: DESCRIPTION,
    images: ['/twitter-image'],
  },
};

export const viewport: Viewport = {
  themeColor: '#1a1446',
  width: 'device-width',
  initialScale: 1,
};

// Schema VideoGame giúp Google hiểu đây là game (rich result tiềm năng).
const GAME_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'VideoGame',
  name: SITE_NAME,
  url: SITE_URL,
  description: DESCRIPTION,
  inLanguage: 'en',
  applicationCategory: 'GameApplication',
  operatingSystem: 'Web browser',
  genre: ['Strategy', 'Simulation'],
  playMode: ['SinglePlayer', 'MultiPlayer', 'CoOp'],
  isAccessibleForFree: true,
  image: `${SITE_URL}/opengraph-image`,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={paytone.variable}>
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(GAME_JSON_LD) }} />
        <LanguageProvider>
          <AuthProvider>
            <PlayerProvider>{children}</PlayerProvider>
          </AuthProvider>
        </LanguageProvider>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
