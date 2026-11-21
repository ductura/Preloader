// Lokalni edge (deploy/edge/dev-proxy.mjs, ugovor #2028 §1): rute, zaglavlja i WebSocket
// prema lažnim uzvodnim poslužiteljima na slučajnim portovima. Mreža izvan računala se ne koristi.
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { connect } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createEdge, DEFAULT_TARGETS, FALLBACK_CSP, routeFor, targetsFromEnv } from '../deploy/edge/dev-proxy.mjs';

interface Seen {
  upstream: string;
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

const seen: Seen[] = [];
const servers: Server[] = [];
let edgeUrl: string;
let edgePort: number;
let preloaderPort: number;
let wsUpgrades: Seen[] = [];

const sockets = new Set<import('node:net').Socket>();

async function listen(server: Server): Promise<number> {
  servers.push(server);
  // Nadograđene (WebSocket) veze ne zatvara closeAllConnections.
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return address.port;
}

const sha = (text: string) => `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}`;
const policy = (script: string, style: string) =>
  `default-src 'none'; script-src ${script}; style-src '${sha(style)}'; ` +
  "img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Stranice lažnog preloadera u obliku koji daje Next (`<style data-next-head="">`). */
const nextPage = (body: string, script?: string) =>
  `<!doctype html><html lang="hr"><head><title data-next-head="">Ductura</title><style data-next-head="">b{}</style></head>` +
  `<body><div id="__next">${body}</div>${script === undefined ? '' : `<script>${script}</script>`}</body></html>`;
const PAGES: Record<string, { status: number; body: string | Buffer; headers?: Record<string, string> }> = {
  '/greska.html': { status: 200, body: nextPage('<p>greška</p>', 'greska()') },
  '/html/stranica': { status: 200, body: nextPage('<p>preloader</p>', 'prvi()'), headers: { 'Content-Security-Policy': "script-src 'unsafe-inline'" } },
  '/html/404': { status: 404, body: nextPage('<p>Stranica ne postoji</p>') },
  '/html/304': { status: 304, body: '', headers: { ETag: '"v1"' } },
  '/html/dev': { status: 200, body: nextPage('<p>dev</p>', 'prvi()').replace('</body>', '<script src="/_next/static/chunks/a.js" defer=""></script></body>') },
  '/html/gzip': { status: 200, body: gzipSync(nextPage('<p>gzip</p>', 'prvi()')), headers: { 'Content-Encoding': 'gzip' } },
  '/html/velika': { status: 200, body: nextPage(`<p>${'x'.repeat(1024 * 1024)}</p>`, 'prvi()') },
};

/**
 * Lažni uzvodni: zapisuje zahtjev, vraća dva kolačića i Location, na `/__ws` prihvaća WebSocket.
 * Lažni preloader na `/greska.html` i `/html/*` vraća HTML iz `PAGES`.
 */
function fakeUpstream(name: string): Server {
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      seen.push({ upstream: name, method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      const page = name === 'preloader' ? PAGES[req.url ?? ''] : undefined;
      if (page) {
        res.writeHead(page.status, { 'Content-Type': 'text/html; charset=utf-8', ...page.headers }).end(page.body);
        return;
      }
      res.writeHead(303, [
        'Location', 'http://localhost:8000/app/web/',
        'Set-Cookie', '__Host-ductus_session=s1; Path=/; HttpOnly; Secure; SameSite=Lax',
        'Set-Cookie', 'ductura_admin=a1; Path=/; HttpOnly; SameSite=Strict',
        'X-Upstream', name,
        'Content-Type', 'text/plain',
      ]);
      res.end(`odgovor ${name}`);
    });
  });
  server.on('upgrade', (req, socket) => {
    wsUpgrades.push({ upstream: name, method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: '' });
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    // Jeka s oznakom uzvodnog: dokaz da bajtovi prolaze u oba smjera.
    socket.on('data', (chunk) => socket.write(`${name}:${chunk.toString()}`));
  });
  return server;
}

beforeAll(async () => {
  const ports = {
    preloader: await listen(fakeUpstream('preloader')),
    admin: await listen(fakeUpstream('admin')),
    api: await listen(fakeUpstream('api')),
    front: await listen(fakeUpstream('front')),
  };
  preloaderPort = ports.preloader;
  const targets = targetsFromEnv({
    DUCTURA_EDGE_PRELOADER: `http://127.0.0.1:${ports.preloader}`,
    DUCTURA_EDGE_ADMIN: `http://127.0.0.1:${ports.admin}`,
    DUCTURA_EDGE_API: `http://127.0.0.1:${ports.api}`,
    DUCTURA_EDGE_FRONT: `http://127.0.0.1:${ports.front}`,
  });
  const edge = await createEdge({ targets });
  edgePort = await listen(edge);
  edgeUrl = `http://127.0.0.1:${edgePort}`;
});

afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

const get = (path: string, init: RequestInit = {}) => fetch(`${edgeUrl}${path}`, { redirect: 'manual', ...init });

/** Zahtjev s putanjom točno kako je napisana (fetch bi je normalizirao). */
function rawRequest(path: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(edgePort, '127.0.0.1', () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost:8000\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    socket.on('data', (chunk) => (data += chunk.toString()));
    socket.on('end', () => resolve({ status: Number(data.split(' ')[1]), text: data }));
    socket.on('error', reject);
  });
}

describe('routeFor', () => {
  test.each([
    ['/', 'preloader'],
    ['/greska.html', 'preloader'],
    ['/admin', 'admin'],
    ['/admin/', 'admin'],
    ['/admin/prijava', 'admin'],
    ['/admin/_next/webpack-hmr', 'admin'],
    ['/administracija', 'preloader'],
    ['/Admin', 'preloader'],
    ['/%61dmin', 'preloader'],
    ['/api/v1', 'api'],
    ['/api/v1/auth/login', 'api'],
    ['/api/v1/client-context', 'api'],
    ['/api/v2/x', 'preloader'],
    ['/api/v1x', 'preloader'],
    ['/app/web/', 'front'],
    ['/app/web', 'front'],
    ['/app/chrome/index.html', 'front'],
    ['/app/webx', 'preloader'],
    ['/app/mobile/', 'preloader'],
    ['/o/', 'preloader'],
  ] as const)('%s -> %s', (path, route) => {
    expect(routeFor(path)).toBe(route);
  });

  test.each([
    ['/app/mobile', 'mobile'],
    ['/app/mobile/', 'mobile'],
    ['/app/mobile/_next/webpack-hmr', 'mobile'],
    ['/app/mobilex', 'preloader'],
    ['/App/mobile', 'preloader'],
    ['/o', 'other'],
    ['/o/', 'other'],
    ['/o/zadaci', 'other'],
    ['/ostalo', 'preloader'],
    ['/O/', 'preloader'],
    ['/%6F/', 'preloader'],
    ['/app/web/', 'front'],
  ] as const)('uz pokrenute VS-2 frontove (tablica ruta) %s -> %s', (path, route) => {
    const targets = targetsFromEnv({ DUCTURA_EDGE_MOBILE: 'http://localhost:5174', DUCTURA_EDGE_OTHER: 'http://localhost:5175' });
    expect(routeFor(path, undefined, targets)).toBe(route);
  });

  test('razvojne putanje next dev idu usluzi stranice iz Referera (LOK-2)', () => {
    expect(routeFor('/__nextjs_font/geist-latin.woff2', 'http://localhost:8000/admin/_next/static/chunks/a.css')).toBe('admin');
    expect(routeFor('/__nextjs_original-stack-frames', 'http://localhost:8000/app/web/zadaci')).toBe('front');
    expect(routeFor('/__nextjs_font/x.woff2', 'http://localhost:8000/')).toBe('preloader');
    expect(routeFor('/__nextjs_font/x.woff2', 'http://localhost:8000/__nextjs_font/y')).toBe('preloader');
    expect(routeFor('/__nextjs_font/x.woff2', 'nije url')).toBe('preloader');
    expect(routeFor('/__nextjs_font/x.woff2')).toBe('preloader');
    // Referer ne mijenja ništa drugo.
    expect(routeFor('/greska.html', 'http://localhost:8000/admin')).toBe('preloader');
  });
});

describe('targetsFromEnv', () => {
  test('zadani portovi iz ugovora §1', () => {
    expect(DEFAULT_TARGETS).toEqual({
      preloader: 'http://localhost:3100', admin: 'http://localhost:3120', api: 'http://localhost:4000', front: 'http://localhost:5173',
    });
    const t = targetsFromEnv({});
    expect([t.preloader.port, t.admin.port, t.api.port, t.front.port]).toEqual(['3100', '3120', '4000', '5173']);
  });

  test('Institution_web_mobile i Web_other nemaju zadani cilj; ciljevi su iz tablice ruta', () => {
    const t = targetsFromEnv({});
    expect(t.mobile).toBeUndefined();
    expect(t.other).toBeUndefined();
    const v = targetsFromEnv({ DUCTURA_EDGE_MOBILE: 'http://localhost:5174', DUCTURA_EDGE_OTHER: 'http://127.0.0.1:5175/' });
    expect([v.mobile?.host, v.other?.host]).toEqual(['localhost:5174', '127.0.0.1:5175']);
    expect(() => targetsFromEnv({ DUCTURA_EDGE_OTHER: 'http://localhost:5175/o' })).toThrow(/DUCTURA_EDGE_OTHER/);
  });

  test('prazna vrijednost znači zadanu', () => {
    expect(targetsFromEnv({ DUCTURA_EDGE_API: '' }).api.host).toBe('localhost:4000');
  });

  test.each(['https://localhost:4000', 'http://localhost:4000/api', 'http://u:p@localhost:4000', 'localhost:4000', 'nije url'])(
    'odbija %s',
    (value) => {
      expect(() => targetsFromEnv({ DUCTURA_EDGE_API: value })).toThrow(/DUCTURA_EDGE_API/);
    },
  );
});

describe('preloader (Next.js)', () => {
  test.each(['/', '/greska.html?status=404', '/nema-me', '/_next/static/chunks/a.js', '/Admin', '/%61dmin', '/../tajna.txt', '/%2e%2e/tajna.txt'])(
    '%s ide preloaderu doslovno, s istom putanjom i upitom',
    async (path) => {
      seen.length = 0;
      const res = await rawRequest(path);
      expect(res.text).toContain('odgovor preloader');
      expect(seen.map((s) => [s.upstream, s.url])).toEqual([['preloader', path]]);
    },
  );

  test('HTML preloadera dobiva CSP iz hasheva skripte i stila; zaglavlje uzvodnog se zamjenjuje', async () => {
    seen.length = 0;
    const res = await get('/html/stranica', { headers: { 'Accept-Encoding': 'gzip, br' } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe(PAGES['/html/stranica']?.body);
    expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength(body)));
    const csp = res.headers.get('content-security-policy');
    expect(csp).toBe(policy(`'${sha('prvi()')}'`, 'b{}'));
    expect(csp).not.toMatch(/unsafe|nonce|strict-dynamic|\*/);
    // Preloader odgovara nekomprimirano, da se tijelo može hashirati.
    expect(seen[0]?.headers['accept-encoding']).toBeUndefined();
  });

  test('HEAD daje isti CSP bez tijela; preloaderu ide kao GET', async () => {
    seen.length = 0;
    const res = await get('/html/stranica', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe(policy(`'${sha('prvi()')}'`, 'b{}'));
    expect(await res.text()).toBe('');
    expect(seen.map((s) => s.method)).toEqual(['GET']);
  });

  test("404 Nexta bez skripte dobiva script-src 'none'", async () => {
    const res = await get('/html/404');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-security-policy')).toBe(policy("'none'", 'b{}'));
    expect(await res.text()).toContain('Stranica ne postoji');
  });

  test.each(['/html/dev', '/html/gzip'])('%s: bez CSP-a iz hasheva ide stroga politika', async (path) => {
    const res = await get(path);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe(FALLBACK_CSP);
  });

  test('304 prolazi bez tijela i bez zamjenske politike (ostaje spremljeni CSP)', async () => {
    const res = await get('/html/304', { headers: { 'If-None-Match': '"v1"' } });
    expect(res.status).toBe(304);
    expect(res.headers.get('content-security-policy')).toBeNull();
    expect(res.headers.get('etag')).toBe('"v1"');
  });

  test('Range ne ide preloaderu: HTML stiže cijel za hash', async () => {
    seen.length = 0;
    const res = await get('/html/stranica', { headers: { Range: 'bytes=0-10', 'If-Range': '"v1"' } });
    expect(res.headers.get('content-security-policy')).toBe(policy(`'${sha('prvi()')}'`, 'b{}'));
    expect(seen[0]?.headers['range']).toBeUndefined();
    expect(seen[0]?.headers['if-range']).toBeUndefined();
  });

  test('prevelik HTML se ne šalje bez CSP-a: 502', async () => {
    const res = await get('/html/velika');
    expect(res.status).toBe(502);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  });

  test('ostalo od preloadera (ne HTML) prolazi bez CSP-a i nepromijenjeno', async () => {
    const res = await get('/_next/static/chunks/a.js');
    expect(res.headers.get('content-security-policy')).toBeNull();
    expect(await res.text()).toBe('odgovor preloader');
  });

  test('POST na preloader je 405 i ne ide dalje', async () => {
    seen.length = 0;
    const res = await get('/', { method: 'POST', body: 'x' });
    expect(res.status).toBe(405);
    expect(seen).toEqual([]);
  });

  test('WebSocket (HMR za next dev) prolazi do preloadera', async () => {
    wsUpgrades = [];
    const reply = await rawUpgrade('/_next/webpack-hmr', 'ping');
    expect(reply).toContain('preloader:ping');
    expect(wsUpgrades[0]?.url).toBe('/_next/webpack-hmr');
  });
});

describe('prosljeđivanje', () => {
  test.each([
    ['/admin', 'admin'],
    ['/admin/prijava', 'admin'],
    ['/api/v1/auth/login?returnTo=%2Fapp%2Fweb%2F', 'api'],
    ['/api/v1/me', 'api'],
    ['/app/web/', 'front'],
    ['/app/chrome/x.js?v=1', 'front'],
  ] as const)('%s ide na %s s istom putanjom i upitom', async (path, upstream) => {
    seen.length = 0;
    const res = await get(path);
    expect(res.headers.get('x-upstream')).toBe(upstream);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(path);
  });

  test('Host, kolačići i X-Forwarded-* prema uzvodnom', async () => {
    seen.length = 0;
    await get('/api/v1/auth/callback?code=c&state=s', {
      headers: { cookie: '__Host-ductus_login=l1; other=2', 'x-forwarded-host': 'zlo.example' },
    });
    const h = seen[0]?.headers ?? {};
    expect(h.host).toBe(`127.0.0.1:${edgePort}`);
    expect(h.cookie).toBe('__Host-ductus_login=l1; other=2');
    expect(h['x-forwarded-host']).toBe(`127.0.0.1:${edgePort}`);
    expect(h['x-forwarded-proto']).toBe('http');
    expect(h['x-forwarded-for']).toMatch(/127\.0\.0\.1/);
  });

  test('Location i svi Set-Cookie vraćaju se nepromijenjeni, bez slijeđenja preusmjeravanja', async () => {
    const res = await get('/api/v1/auth/callback');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('http://localhost:8000/app/web/');
    expect(res.headers.getSetCookie()).toEqual([
      '__Host-ductus_session=s1; Path=/; HttpOnly; Secure; SameSite=Lax',
      'ductura_admin=a1; Path=/; HttpOnly; SameSite=Strict',
    ]);
    expect(await res.text()).toBe('odgovor api');
  });

  test('tijelo POST-a i metoda prolaze', async () => {
    seen.length = 0;
    await get('/admin/prijava', { method: 'POST', body: 'korisnik=k&lozinka=l', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(seen[0]).toMatchObject({ upstream: 'admin', method: 'POST', body: 'korisnik=k&lozinka=l' });
  });

  test.each(['DELETE', 'POST', 'PATCH'])('chunked tijelo za %s stiže uzvodnom s okvirom', async (method) => {
    seen.length = 0;
    const reply = await rawRequestWith(
      '/api/v1/x',
      'Transfer-Encoding: chunked\r\nConnection: close\r\n',
      method,
      '5\r\nabcde\r\n3\r\nfgh\r\n0\r\n\r\n',
    );
    expect(reply).toMatch(/^HTTP\/1\.1 303/);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method, body: 'abcdefgh' });
  });

  test('zaglavlja jednog skoka se ne prosljeđuju', async () => {
    seen.length = 0;
    await rawRequestWith('/api/v1/me', 'Connection: close, X-Tajno\r\nX-Tajno: 1\r\nKeep-Alive: timeout=5\r\nX-Ostaje: da\r\n');
    const h = seen[0]?.headers ?? {};
    expect(h['x-tajno']).toBeUndefined();
    expect(h['keep-alive']).toBeUndefined();
    expect(h['x-ostaje']).toBe('da');
  });

  test('WebSocket (HMR) prolazi do uzvodnog u oba smjera', async () => {
    wsUpgrades = [];
    const reply = await rawUpgrade('/admin/_next/webpack-hmr', 'ping');
    expect(reply).toMatch(/^HTTP\/1\.1 101/);
    expect(reply).toContain('admin:ping');
    expect(wsUpgrades[0]?.url).toBe('/admin/_next/webpack-hmr');
    expect(wsUpgrades[0]?.headers.upgrade).toBe('websocket');
    expect(wsUpgrades[0]?.headers.host).toBe('localhost:8000');
  });
});

describe('uzvodni nije pokrenut', () => {
  test('502 sa stranicom greške preloadera, edge radi dalje', async () => {
    const down = await createEdge({
      targets: targetsFromEnv({
        DUCTURA_EDGE_PRELOADER: `http://127.0.0.1:${preloaderPort}`,
        DUCTURA_EDGE_API: 'http://127.0.0.1:9',
        DUCTURA_EDGE_ADMIN: 'http://127.0.0.1:9',
      }),
    });
    const port = await listen(down);
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/me`);
    expect(res.status).toBe(502);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('content-security-policy')).toBe(policy(`'${sha('greska()')}'`, 'b{}'));
    expect(await res.text()).toContain('<p>greška</p>');
    expect(await (await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' })).text()).toBe('odgovor preloader');
    const ws = await rawUpgrade('/admin/_next/webpack-hmr', '', port);
    expect(ws).toMatch(/^HTTP\/1\.1 502/);
  });

  test('IPv6 cilj [::1] spaja se bez uglatih zagrada', async () => {
    const v6 = fakeUpstream('v6');
    servers.push(v6);
    v6.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        v6.once('error', reject);
        v6.listen(0, '::1', resolve);
      });
    } catch {
      // Bez IPv6 sučelja na računalu provjerava se samo da URL ostaje prihvaćen.
      expect(targetsFromEnv({ DUCTURA_EDGE_API: 'http://[::1]:4000' }).api.hostname).toBe('[::1]');
      return;
    }
    const address = v6.address();
    const v6port = typeof address === 'object' && address ? address.port : 0;
    const edge = await createEdge({ targets: targetsFromEnv({ DUCTURA_EDGE_API: `http://[::1]:${v6port}` }) });
    const port = await listen(edge);
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/me`, { redirect: 'manual' });
    expect(res.headers.get('x-upstream')).toBe('v6');
    const ws = await rawUpgrade('/api/v1/ws', 'ping', port);
    expect(ws).toContain('v6:ping');
  });

  test('bez preloadera 502 s kratkim tekstom, i za stranicu i za uslugu', async () => {
    const down = await createEdge({
      targets: targetsFromEnv({ DUCTURA_EDGE_PRELOADER: 'http://127.0.0.1:9', DUCTURA_EDGE_API: 'http://127.0.0.1:9' }),
    });
    const port = await listen(down);
    for (const path of ['/', '/api/v1/me']) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      expect(res.status).toBe(502);
      expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(await res.text()).toBe('502\n');
    }
  });
});

function rawRequestWith(path: string, extra: string, method = 'GET', body = '', port = edgePort): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(`${method} ${path} HTTP/1.1\r\nHost: localhost:8000\r\n${extra}\r\n${body}`);
    });
    let data = '';
    socket.on('data', (chunk) => (data += chunk.toString()));
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
}

/** WebSocket rukovanje; nakon 101 šalje `message` i vraća sve primljeno dok se ne pojavi jeka ili se veza zatvori. */
function rawUpgrade(path: string, message = '', port = edgePort): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: localhost:8000\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n` +
          'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
      );
    });
    let data = '';
    let sent = false;
    socket.on('data', (chunk) => {
      data += chunk.toString();
      if (data.includes('\r\n\r\n') && data.startsWith('HTTP/1.1 101') && !sent) {
        sent = true;
        if (message) socket.write(message);
        else {
          socket.destroy();
          resolve(data);
        }
      } else if (sent && data.includes(`:${message}`)) {
        socket.destroy();
        resolve(data);
      }
    });
    socket.on('end', () => resolve(data));
    socket.on('close', () => resolve(data));
    socket.on('error', reject);
  });
}
