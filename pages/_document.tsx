import { Head, Html, Main, NextScript } from 'next/document';

// Stranice preloadera nemaju Nextov JavaScript (`unstable_runtimeJS: false`), pa NextScript ništa ne ispisuje.
export default function Document() {
  return (
    <Html lang="hr">
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
