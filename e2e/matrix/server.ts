// Preloader za e2e: `next start` iz `next build` (`pnpm e2e`), pokreće ga Playwright (webServer).
export const PRELOADER_PORT = 3101;
export const PRELOADER_ORIGIN = `http://localhost:${PRELOADER_PORT}`;

/** Putanje koje poslužuje preloader; sve ostalo specovi lažiraju (`page.route`). */
export function fromPreloader(url: URL, pages: readonly string[] = ['/']): boolean {
  return url.origin === PRELOADER_ORIGIN && (pages.includes(url.pathname) || url.pathname.startsWith('/_next/'));
}
