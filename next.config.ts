import { existsSync } from 'node:fs';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Dev server behind `publish.sh`'s Cloudflare Tunnel (default https://duyna.online):
  // Next.js blocks cross-site dev resources (e.g. the `/_next/hmr` websocket) from
  // unknown origins by writing raw `Unauthorized` to the upgrade socket, which
  // cloudflared reports as `malformed HTTP response "Unauthorized"` (type=ws).
  // Allowlisting the tunnel host here keeps HMR working through the tunnel.
  allowedDevOrigins: ['duyna.online', ...(process.env.DOMAIN && process.env.DOMAIN !== 'duyna.online' ? [process.env.DOMAIN] : [])],
  // A stray lockfile in a parent directory must not become the workspace root.
  turbopack: { root: process.cwd() },
  // Native module: must stay a runtime require, never bundled.
  serverExternalPackages: ['better-sqlite3'],
  // Page routes are English; keep the old Vietnamese top-up URL working for shared links.
  redirects: async () => [{ source: '/nap-xu', destination: '/topup', permanent: true }],
  // Battle GLBs come from the browser cache once the home page has warmed them: shipped models are
  // fresh for a day then served stale while revalidating; uploads are timestamped, so never change.
  headers: async () => [
    { source: '/models/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=31536000' }] },
    { source: '/uploads/models/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
  ],
  // One value per build (per start in dev): client caches keyed by it drop what older code produced.
  // HERO_BANNER: hero image slot filled? Checked per build/start so a missing file never hits the image optimizer.
  env: {
    BUILD_STAMP: Date.now().toString(36),
    SERVER: process.env.SERVER ?? '',
    HERO_BANNER: existsSync('public/images/hero-banner.png') ? '1' : '',
  },
};

export default nextConfig;
