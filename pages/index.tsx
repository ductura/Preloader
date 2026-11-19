// Prvi ekran (`/`): statičan HTML s ugrađenim stilom i skriptom (`src/main.ts`), bez Nextovog JavaScripta (P-0.1).
import type { GetStaticProps } from 'next';
import { text } from '../src/text.ts';
import { PreloaderMain } from '../src/ui/PreloaderMain.tsx';
import { StaticPage } from '../src/ui/StaticPage.tsx';

// `runtime` je tu samo zato da provjera tipova Nexta prihvati objekt; `unstable_runtimeJS` nije u njegovim tipovima.
export const config = { unstable_runtimeJS: false, runtime: 'nodejs' };

type Props = { script: string; css: string };

export const getStaticProps: GetStaticProps<Props> = async () => {
  const { pageAssets } = await import('../scripts/page-assets.ts');
  const { script, css } = await pageAssets();
  return { props: { script, css } };
};

export default function Page({ script, css }: Props) {
  return (
    <StaticPage title={text.title} css={css} script={script}>
      <PreloaderMain />
    </StaticPage>
  );
}
