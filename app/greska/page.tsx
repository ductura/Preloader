import type { Metadata } from 'next';
import { errorText } from '../../src/text.ts';
import { ErrorMain } from '../../src/ui/ErrorMain.tsx';
import { ErrorScript } from '../../src/ui/ErrorScript.tsx';

export const metadata: Metadata = { title: `${errorText.general.title} · Ductura` };

export default function Page() {
  return (
    <>
      <ErrorMain />
      <ErrorScript />
    </>
  );
}
