// Statična stranica preloadera; skripta i stil ugrađuju se pri izgradnji.
import { defaultConfig, type Config } from './config.ts';
import { clientText, PACKAGE_LABELS, text } from './text.ts';

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

export function renderPage(assets: { script: string; css: string }, config: Config = defaultConfig): string {
  const e = escapeHtml;
  const choice = (href: string, label: string) => `<li><a href="${e(href)}">${e(label)}</a></li>`;
  // Gumbi su izvorno dostupni tipkovnicom; `aria-pressed` postavlja klijent.
  const group = (id: string, label: string, options: [string, string, string][]) =>
    `<div role="group" aria-labelledby="choice-${id}"><span id="choice-${id}">${e(label)}</span>${options
      .map(([key, value, name]) => `<button type="button" data-${key}="${value}" aria-pressed="false">${e(name)}</button>`)
      .join('')}</div>`;
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
<section id="choice" class="choice" aria-labelledby="choice-title" hidden>
<h2 id="choice-title">${e(text.choiceTitle)}</h2>
${group('view', text.choiceView, [['view', 'desktop', text.views.desktop], ['view', 'mobile', text.views.mobile]])}
${group('package', text.choicePackage, [['package', 'windows', PACKAGE_LABELS.windows], ['package', 'macos', PACKAGE_LABELS.macos]])}
<p id="choice-status" role="status"></p>
</section>
<noscript>
<p>${e(text.noscript)}</p>
<ul>
${choice(config.frontends.chrome, text.frontends.chrome)}
${choice(config.frontends.mobile, text.frontends.mobile)}
${choice(config.frontends.other, text.frontends.other)}
${choice(config.downloads.windows, clientText.download('windows'))}
${choice(config.downloads.macos, clientText.download('macos'))}
</ul>
</noscript>
</main>
<script>${assets.script}</script>
</body>
</html>
`;
}
