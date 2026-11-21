import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GetServerSideProps } from 'next';
import { defaultConfig } from '../src/config.ts';
import { loadManifest, type DesktopDownload } from '../src/downloads/manifest.ts';
import { downloadsText as text } from '../src/downloads/messages.hr.ts';
import { StaticPage } from '../src/ui/StaticPage.tsx';

export const config = { unstable_runtimeJS: false, runtime: 'nodejs' };

type Props = { packages: DesktopDownload[]; css: string };

export const getServerSideProps: GetServerSideProps<Props> = async ({ query, res }) => {
  res.setHeader('Cache-Control', 'no-store');
  const packages = await loadManifest();
  const system = query.sustav;
  const css = readFileSync(join(process.cwd(), 'src/style.css'), 'utf8');
  return {
    props: {
      css,
      packages: system === undefined ? packages : packages.filter((entry) => entry.system === system),
    },
  };
};

export default function Page({ css, packages }: Props) {
  return (
    <StaticPage title={text.title} css={css}>
      <main className="sheet">
        <h1 className="brand">{text.title}</h1>
        {packages.map(({ system, architecture, url }) => (
          <p key={`${system}/${architecture}`}>
            <a className="button" href={url} download rel="noreferrer">
              {text.download(text.systems[system], architecture)}
            </a>
          </p>
        ))}
        <p><a href={defaultConfig.frontends.other}>{text.continueOnWeb}</a></p>
      </main>
    </StaticPage>
  );
}
