import { createServer } from 'node:http';
import { route } from './detect.js';
import { defaultConfig } from './config.js';

const LABELS = { windows: 'Windows', macos: 'macOS' };

function page(r) {
  const offer = r.desktopPackage
    ? `<p><a id="desktop-download" href="${r.downloadUrl}">Preuzmi Ducturu za ${LABELS[r.desktopPackage]}</a></p>`
    : '';
  return `<!doctype html><html lang="hr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ductura</title></head><body data-frontend="${r.frontend}">
<h1>Ductura</h1>
<p><a id="open-app" href="${r.url}">Otvori Ducturu u pregledniku</a></p>
${offer}
<script>setTimeout(function(){location.href=${JSON.stringify(r.url)}}, ${r.desktopPackage ? 4000 : 0});</script>
</body></html>`;
}

export function createApp(config = defaultConfig) {
  return createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const r = route(req.headers['user-agent'] ?? '', config);
    if (url.pathname === '/api/route') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', vary: 'User-Agent' });
      return res.end(JSON.stringify(r));
    }
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', vary: 'User-Agent' });
      return res.end(page(r));
    }
    res.writeHead(404).end();
  });
}
