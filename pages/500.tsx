// Greška na poslužitelju pri iscrtavanju: tekst iz kataloga (`internal`), bez skripte i bez Nextovog JavaScripta.
import type { GetStaticProps } from 'next';
import { errorText } from '../src/text.ts';
import { ErrorMain } from '../src/ui/ErrorMain.tsx';
import { StaticPage } from '../src/ui/StaticPage.tsx';

// `runtime` je tu samo zato da provjera tipova Nexta prihvati objekt; `unstable_runtimeJS` nije u njegovim tipovima.
export const config = { unstable_runtimeJS: false, runtime: 'nodejs' };

type Props = { css: string };

export const getStaticProps: GetStaticProps<Props> = async () => {
  const { pageAssets } = await import('../scripts/page-assets.ts');
  return { props: { css: (await pageAssets()).css } };
};

export default function ServerError({ css }: Props) {
  return (
    <StaticPage title={`${errorText.internal.title} · Ductura`} css={css}>
      <ErrorMain textKey="internal" />
    </StaticPage>
  );
}
