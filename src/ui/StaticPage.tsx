// Okvir stranice preloadera u Next.js (pages/): naslov, ugrađeni stil i skripta, bez Nextovog JavaScripta.
import Head from 'next/head';
import type { ReactNode } from 'react';

export interface StaticPageProps {
  title: string;
  css: string;
  /** Ugrađena skripta; bez nje stranica nema JavaScripta. */
  script?: string;
  children: ReactNode;
}

export function StaticPage({ title, css, script, children }: StaticPageProps) {
  return (
    <>
      <Head>
        <meta key="viewport" name="viewport" content="width=device-width,initial-scale=1" />
        <title>{title}</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </Head>
      {children}
      {script === undefined ? null : <script dangerouslySetInnerHTML={{ __html: script }} />}
    </>
  );
}
