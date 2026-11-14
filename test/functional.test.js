// Funkcionalna provjera: Chrome na Macu otvara Chrome sučelje i nudi macOS paket.
// Chrome na Androidu otvara mobilno sučelje.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { defaultConfig } from '../src/config.js';
import { UA } from './user-agents.js';

let server, base;
before(async () => {
  server = createApp(defaultConfig).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const visit = (ua) => fetch(`${base}/`, { headers: { 'user-agent': ua } }).then((r) => r.text());

test('Chrome na Macu: Chrome sučelje + macOS paket', async () => {
  const html = await visit(UA.chromeMac);
  assert.match(html, /data-frontend="chrome"/);
  assert.match(html, new RegExp(`href="${defaultConfig.frontends.chrome}"`));
  assert.match(html, /id="desktop-download" href="[^"]+\.dmg"/);
  assert.match(html, /za macOS/);
});

test('Chrome na Androidu: mobilno sučelje, bez desktop paketa', async () => {
  const html = await visit(UA.chromeAndroid);
  assert.match(html, /data-frontend="mobile"/);
  assert.match(html, new RegExp(`href="${defaultConfig.frontends.mobile}"`));
  assert.doesNotMatch(html, /desktop-download/);
});

test('Edge na Windowsu: ostala sučelja + Windows paket', async () => {
  const res = await fetch(`${base}/api/route`, { headers: { 'user-agent': UA.edgeWindows } });
  assert.deepEqual(await res.json(), {
    frontend: 'other',
    url: defaultConfig.frontends.other,
    desktopPackage: 'windows',
    downloadUrl: defaultConfig.downloads.windows,
  });
});
