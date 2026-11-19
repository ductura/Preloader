import type { Metadata } from 'next';
import { text } from '../src/text.ts';
import { PreloaderMain } from '../src/ui/PreloaderMain.tsx';
import { PreloaderScript } from '../src/ui/PreloaderScript.tsx';

export const metadata: Metadata = { title: text.title };

export default function Page() {
  return (
    <>
      <PreloaderMain />
      <PreloaderScript />
    </>
  );
}
