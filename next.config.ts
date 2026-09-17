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
};

export default nextConfig;
