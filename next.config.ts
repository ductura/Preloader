import { existsSync } from 'node:fs';
import type { NextConfig } from 'next';
import { entryRewrites, serviceRewrites } from './src/rewrites.ts';

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
  // `/ulaz` nosi noindex na samom Nextu, i za inačice koje Next prepisuje na stranicu preloadera: njegovo
  // podudaranje putanja ne razlikuje velika i mala slova ni završnu kosu crtu, pa `/Ulaz`, `/ULAZ` i `/Ulaz/`
  // također vraćaju preloader (200). Bez zaglavlja bi ih tražilice indeksirale uz `/ulaz`.
  async headers() {
    return [{ source: '/ulaz', headers: [{ key: 'X-Robots-Tag', value: 'noindex' }] }];
  },
  // Čita se pri izgradnji (`next build`): na Vercelu su varijable postavljene u projektu.
  async rewrites() {
    const services = serviceRewrites(process.env);
    // Karta adresa (D-318, DAN-1574): `/` je naslovnica, preloader je na `/ulaz`, javne stranice su na vrhu.
    const entries = entryRewrites(process.env);
    if (!hasLanding) return { beforeFiles: entries, afterFiles: services, fallback: [] };
    return {
      // Lokalni edge očekuje 404 s ugrađenim stilom i bez skripti App Routera.
      beforeFiles: [...entries, { source: '/404', destination: staticNotFound }],
      afterFiles: services,
      fallback: [{ source: '/:path*', destination: staticNotFound }],
    };
  },
};

export default nextConfig;
