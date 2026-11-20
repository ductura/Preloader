import { existsSync } from 'node:fs';
import type { NextConfig } from 'next';
import { serviceRewrites } from './src/rewrites.ts';

// Izolirani test rewriteova gradi samo Pages Router.
const hasLanding = existsSync('tsconfig.next.json');
const staticNotFound = '/stranica-ne-postoji';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Bez AGENTS.md koji next build inače zapisuje u korijen (kao Aplication_front).
  agentRules: false,
  // Putanja ide usluzi nepromijenjena: `/app/web/` se ne preusmjerava na `/app/web` (kao lokalni edge).
  skipTrailingSlashRedirect: true,
  // esbuild gradi ugrađene skripte stranica u getStaticProps (scripts/page-assets.ts); ne pakira se.
  serverExternalPackages: ['esbuild'],
  typescript: {
    tsconfigPath: hasLanding
      ? 'tsconfig.next.json'
      : 'src/components/landing/tsconfig.preloader.json',
  },
  experimental: { globalNotFound: true },
  // Čita se pri izgradnji (`next build`): na Vercelu su varijable postavljene u projektu.
  async rewrites() {
    const services = serviceRewrites(process.env);
    if (!hasLanding) return services;
    return {
      // Lokalni edge očekuje 404 s ugrađenim stilom i bez skripti App Routera.
      beforeFiles: [{ source: '/404', destination: staticNotFound }],
      afterFiles: services,
      fallback: [{ source: '/:path*', destination: staticNotFound }],
    };
  },
};

export default nextConfig;
