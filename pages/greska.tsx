// Stranica greške (`/greska`, i `/greska.html`): bez skripte opći tekst, a skripta (`src/errors/main.ts`)
// prema `?status=` upisuje tekst stanja (DAN-935-2). Bez Nextovog JavaScripta.
import type { GetStaticProps } from 'next';
import { errorText } from '../src/text.ts';
import { ErrorMain } from '../src/ui/ErrorMain.tsx';
import { StaticPage } from '../src/ui/StaticPage.tsx';

// `runtime` je tu samo zato da provjera tipova Nexta prihvati objekt; `unstable_runtimeJS` nije u njegovim tipovima.
export const config = { unstable_runtimeJS: false, runtime: 'nodejs' };

type Props = { script: string; css: string };

export const getStaticProps: GetStaticProps<Props> = async () => {
  const { pageAssets } = await import('../scripts/page-assets.ts');
  const { errorScript, css } = await pageAssets();
  return { props: { script: errorScript, css } };
};

export default function Page({ script, css }: Props) {
  return (
    <StaticPage title={`${errorText.general.title} · Ductura`} css={css} script={script}>
      <ErrorMain />
    </StaticPage>
  );
}
