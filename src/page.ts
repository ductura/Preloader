// Cijeli HTML prvog ekrana i stranice greške kao niz, iz istih komponenti koje poslužuje Next.js
// (`src/ui/`). Za testove u happy-dom i za mjerenje vlastitog koda (`test/static-build.ts`).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultConfig, type Config } from './config.ts';
import { errorText, text } from './text.ts';
import { ErrorMain } from './ui/ErrorMain.tsx';
import { PreloaderMain } from './ui/PreloaderMain.tsx';

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

function documentOf(title: string, assets: { script: string; css: string }, body: string, bodyAttributes = ''): string {
  return `<!doctype html>
<html lang="hr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${assets.css}</style>
</head>
<body${bodyAttributes}>
${body}
<script>${assets.script}</script>
</body>
</html>
`;
}

export function renderPage(assets: { script: string; css: string }, config: Config = defaultConfig): string {
  return documentOf(text.title, assets, renderToStaticMarkup(createElement(PreloaderMain, { config })), ' data-frontend=""');
}

/** Stranica greške (DAN-935-2): bez skripte opći tekst; skripta prema `?status=` upisuje tekst stanja. */
export function renderErrorPage(assets: { script: string; css: string }): string {
  return documentOf(`${errorText.general.title} · Ductura`, assets, renderToStaticMarkup(createElement(ErrorMain)));
}
