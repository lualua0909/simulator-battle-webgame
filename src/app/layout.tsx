import type { Metadata } from 'next';
import { Be_Vietnam_Pro, Bungee } from 'next/font/google';
import AuthProvider from '@/components/auth/AuthProvider';
import './globals.css';

const display = Bungee({ weight: '400', subsets: ['latin', 'vietnamese'], variable: '--font-bungee' });
const body = Be_Vietnam_Pro({ weight: ['400', '500', '700', '800'], subsets: ['latin', 'vietnamese'], variable: '--font-body' });

export const metadata: Metadata = {
  title: 'Đại Chiến Lô Nhô — Battle Simulator',
  description: 'Mô phỏng đại chiến low-poly: đấu với máy, 2 người 1 máy hoặc online.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" className={`${display.variable} ${body.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
