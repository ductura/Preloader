// Statična stranica preloadera; skripta i stil ugrađuju se pri izgradnji.
import { defaultConfig, type Config } from './config.ts';
import { text } from './text.ts';

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

export function renderPage(assets: { script: string; css: string }, config: Config = defaultConfig): string {
  const e = escapeHtml;
  const choice = (href: string, label: string) => `<li><a href="${e(href)}">${e(label)}</a></li>`;
  return `<!doctype html>
<html lang="hr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(text.title)}</title>
<style>${assets.css}</style>
</head>
<body data-frontend="">
<main class="sheet">
<h1 class="brand">Ductur<span>a</span></h1>
<p class="lead">${e(text.lead)}</p>
<p><a id="open-app" class="button" href="${e(config.frontends.other)}">${e(text.openApp)}</a></p>
<p id="desktop-offer" hidden><a id="desktop-download" href=""></a></p>
<noscript>
<p>${e(text.noscript)}</p>
<ul>
${choice(config.frontends.chrome, text.frontends.chrome)}
${choice(config.frontends.mobile, text.frontends.mobile)}
${choice(config.frontends.other, text.frontends.other)}
${choice(config.downloads.windows, text.download('windows'))}
${choice(config.downloads.macos, text.download('macos'))}
</ul>
</noscript>
</main>
<script>${assets.script}</script>
</body>
</html>
`;
}
