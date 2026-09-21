import type { Metadata } from 'next';
import { Paytone_One } from 'next/font/google';
import { SpeedInsights } from '@vercel/speed-insights/next';
import AuthProvider from '@/components/auth/AuthProvider';
import PlayerProvider from '@/components/player/PlayerProvider';
import './globals.css';

const paytone = Paytone_One({ weight: '400', subsets: ['latin', 'vietnamese'], variable: '--font-paytone' });

export const metadata: Metadata = {
  title: 'Mini Battle Simulator',
  description: 'Mô phỏng đại chiến low-poly: đấu với máy, 2 người 1 máy hoặc online.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" className={paytone.variable}>
      <body>
        <AuthProvider>
          <PlayerProvider>{children}</PlayerProvider>
        </AuthProvider>
        <SpeedInsights />
      </body>
    </html>
  );
}
