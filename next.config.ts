import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // A stray lockfile in a parent directory must not become the workspace root.
  turbopack: { root: process.cwd() },
  // Native module: must stay a runtime require, never bundled.
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
