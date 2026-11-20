import { pageAssets } from '../../../scripts/page-assets.ts';
import { errorText, text } from '../../../src/text.ts';

export const dynamic = 'force-static';

const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// Lokalni edge hashira jedini ugrađeni stil i očekuje 404 bez JavaScripta.
export async function GET() {
  const { css } = await pageAssets();
  const { title, body } = errorText.notFound;
  const html = `<!doctype html>
<html lang="hr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · Ductura</title>
<style>${css}</style>
</head>
<body>
<main class="sheet">
<p class="brand">Ductur<span>a</span></p>
<h1 id="error-title">${escapeHtml(title)}</h1>
<p id="error-body" class="lead">${escapeHtml(body)}</p>
<p><a class="button" href="/">${escapeHtml(text.home)}</a></p>
</main>
</body>
</html>`;
  return new Response(html, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
