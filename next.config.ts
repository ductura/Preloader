import type { NextConfig } from 'next';
import { serviceRewrites } from './src/rewrites.ts';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Bez AGENTS.md koji next build inače zapisuje u korijen (kao Aplication_front).
  agentRules: false,
  // Putanja ide usluzi nepromijenjena: `/app/web/` se ne preusmjerava na `/app/web` (kao lokalni edge).
  skipTrailingSlashRedirect: true,
  // esbuild gradi ugrađene skripte stranica u getStaticProps (scripts/page-assets.ts); ne pakira se.
  serverExternalPackages: ['esbuild'],
  // Ductusove opcije i alias @/ za doslovnu kopiju početne stranice; preloader strože provjerava tsconfig.json.
  typescript: { tsconfigPath: 'tsconfig.next.json' },
  // Uz app/ (/ductus) nepostojeće putanje inače dobiju Nextovu englesku 404, a ne pages/404.tsx.
  experimental: { globalNotFound: true },
  // Čita se pri izgradnji (`next build`): na Vercelu su varijable postavljene u projektu.
  async rewrites() {
    return serviceRewrites(process.env);
  },
};

export default nextConfig;
