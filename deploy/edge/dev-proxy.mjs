// Lokalni edge (ugovor #2028 §1): jedino podrijetlo http://localhost:8000 za preglednik.
// Samo za razvoj na jednom računalu; pravi rubni proxy u produkciji je P-0.10.
//
//   /, sve ostalo          -> preloader (Next.js, :3100)
//   /admin, /admin/*       -> Aplication_front (:3120)
//   /api/v1, /api/v1/*     -> Institution_server (:4000)
//   /app/web, /app/chrome  -> front institucije (:5173)
//
// Putanja se uspoređuje doslovno, bez dekodiranja i bez promjene velikih slova (P-0.10,
// src/sign-in/README.md): `/%61dmin` ili `/Admin` nisu administracija. Host, kolačići,
// Location i ostala zaglavlja prolaze nepromijenjeni u oba smjera; uklanjaju se samo
// zaglavlja jednog skoka (RFC 9110 §7.6.1). WebSocket (HMR) prolazi kao sirovi TCP.
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { isMain } from '../../scripts/is-main.ts';

/** @typedef {'preloader' | 'admin' | 'api' | 'front'} Upstream */
/** @typedef {Record<Upstream, URL>} Targets */

/** Zadani portovi iz ugovora §1. */
export const DEFAULT_TARGETS = Object.freeze({
  preloader: 'http://localhost:3100',
  admin: 'http://localhost:3120',
  api: 'http://localhost:4000',
  front: 'http://localhost:5173',
});

/** Varijable okoline koje mijenjaju cilj; vrijednost je `http://host:port` bez putanje. */
export const TARGET_ENV = Object.freeze({
  preloader: 'DUCTURA_EDGE_PRELOADER',
  admin: 'DUCTURA_EDGE_ADMIN',
  api: 'DUCTURA_EDGE_API',
  front: 'DUCTURA_EDGE_FRONT',
});

export const DEFAULT_PORT = 8000;

/**
 * Ciljevi iz okoline, sa zadanim vrijednostima. Prihvaća se samo `http:` bez
 * korisnika, putanje, upita i fragmenta: edge prosljeđuje izvornu putanju.
 * @param {Record<string, string | undefined>} env
 * @returns {Targets}
 */
export function targetsFromEnv(env = process.env) {
  /** @type {Partial<Targets>} */
  const targets = {};
  for (const key of /** @type {Upstream[]} */ (Object.keys(DEFAULT_TARGETS))) {
    const name = TARGET_ENV[key];
    const raw = env[name] || DEFAULT_TARGETS[key];
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`${name} must be an http URL, got ${JSON.stringify(raw)}`);
    }
    if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error(`${name} must be http://host:port without a path, got ${JSON.stringify(raw)}`);
    }
    targets[key] = url;
  }
  return /** @type {Targets} */ (targets);
}

/**
 * Kamo ide zahtjev. `rawPath` je putanja točno kako ju je poslao preglednik (bez upita).
 * @param {string} rawPath
 * @returns {Upstream}
 */
export function routeFor(rawPath) {
  const under = (/** @type {string} */ prefix) => rawPath === prefix || rawPath.startsWith(`${prefix}/`);
  if (under('/admin')) return 'admin';
  if (under('/api/v1')) return 'api';
  if (under('/app/web') || under('/app/chrome')) return 'front';
  return 'preloader';
}

/** Ime hosta za spajanje: IPv6 iz URL-a (`[::1]`) bez uglatih zagrada. */
function connectHost(/** @type {URL} */ url) {
  return url.hostname.replace(/^\[(.*)\]$/, '$1');
}

/** Putanja iz cilja zahtjeva (`/a/b?x`); apsolutni oblik `http://host/a` daje `/a`. */
function pathOf(/** @type {string} */ target) {
  const path = target.split('?', 1)[0] ?? '';
  return path.startsWith('/') ? path : '';
}

// RFC 9110 §7.6.1: vrijede samo za jednu vezu i ne prosljeđuju se.
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade']);

/**
 * Sirova zaglavlja bez zaglavlja jednog skoka i bez onih koja navodi `Connection`.
 * @param {string[]} raw parovi ime, vrijednost
 * @param {boolean} keepUpgrade
 * @returns {string[]}
 */
function endToEnd(raw, keepUpgrade = false) {
  const named = new Set();
  for (let i = 0; i < raw.length; i += 2) {
    if (raw[i]?.toLowerCase() === 'connection') {
      for (const token of (raw[i + 1] ?? '').split(',')) named.add(token.trim().toLowerCase());
    }
  }
  const out = [];
  for (let i = 0; i < raw.length; i += 2) {
    const name = raw[i] ?? '';
    const lower = name.toLowerCase();
    const upgrade = keepUpgrade && (lower === 'connection' || lower === 'upgrade');
    if (!upgrade && (HOP_BY_HOP.has(lower) || named.has(lower))) continue;
    out.push(name, raw[i + 1] ?? '');
  }
  return out;
}

/**
 * Zaglavlja prema uzvodnom: izvorna (s Hostom preglednika) plus X-Forwarded-*.
 * @param {import('node:http').IncomingMessage} req
 * @param {boolean} upgrade
 */
function upstreamHeaders(req, upgrade) {
  const headers = endToEnd(req.rawHeaders, upgrade);
  const forwardedFor = req.socket.remoteAddress ?? '';
  const host = req.headers.host ?? '';
  const drop = new Set(['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto']);
  const kept = [];
  for (let i = 0; i < headers.length; i += 2) {
    if (!drop.has((headers[i] ?? '').toLowerCase())) kept.push(headers[i] ?? '', headers[i + 1] ?? '');
  }
  kept.push('X-Forwarded-For', forwardedFor, 'X-Forwarded-Host', host, 'X-Forwarded-Proto', 'http');
  // Tijelo bez duljine (chunked) mora i prema uzvodnom imati okvir: Node ga sam ne
  // dodaje za svaku metodu (npr. DELETE), pa bi bajtovi tijela prošli bez okvira.
  if (!upgrade && req.headers['transfer-encoding'] !== undefined && req.headers['content-length'] === undefined) {
    kept.push('Transfer-Encoding', 'chunked');
  }
  return kept;
}

/** Odgovor kad uzvodni ne odgovori: stranica greške preloadera (`/greska.html`), a bez nje kratak tekst. */
function sendError(/** @type {URL} */ preloader, /** @type {import('node:http').ServerResponse} */ res, /** @type {number} */ status) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const plain = () => {
    if (res.headersSent) return;
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`${status}\n`);
  };
  const page = httpRequest({ hostname: connectHost(preloader), port: preloader.port || 80, path: '/greska.html', timeout: 5000 });
  page.on('response', (incoming) => {
    if (incoming.statusCode !== 200 || !String(incoming.headers['content-type']).startsWith('text/html')) {
      incoming.resume();
      plain();
      return;
    }
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    incoming.pipe(res);
    incoming.on('error', () => res.destroy());
  });
  page.on('timeout', () => page.destroy(new Error('timeout')));
  page.on('error', plain);
  page.end();
}

/**
 * Edge kao `http.Server` (još ne sluša).
 * @param {{ targets?: Targets, log?: (line: string) => void }} options
 */
export async function createEdge({ targets = targetsFromEnv({}), log = () => {} } = {}) {
  const server = createServer(async (req, res) => {
    const target = req.url ?? '/';
    const rawPath = pathOf(target);
    if (!rawPath) {
      res.writeHead(400).end();
      return;
    }
    const route = routeFor(rawPath);
    // Preloader nema obrazaca ni API-ja: drugo od GET i HEAD ne ide dalje.
    if (route === 'preloader' && req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }

    const upstream = targets[route];
    const outgoing = httpRequest({
      hostname: connectHost(upstream),
      port: upstream.port || 80,
      method: req.method,
      path: target,
      headers: upstreamHeaders(req, false),
      setHost: false,
    });
    outgoing.on('response', (incoming) => {
      res.writeHead(incoming.statusCode ?? 502, incoming.statusMessage, endToEnd(incoming.rawHeaders));
      incoming.pipe(res);
      incoming.on('error', () => res.destroy());
    });
    outgoing.on('error', (error) => {
      log(`${route} ${upstream.host} nije dostupan: ${error.message}`);
      // Kad ne odgovara sam preloader, ni stranice greške nema: kratak tekst.
      sendError(targets.preloader, res, 502);
    });
    req.on('error', () => outgoing.destroy());
    req.pipe(outgoing);
  });

  // WebSocket (HMR razvojnih poslužitelja): zahtjev se šalje uzvodnom i dalje se samo prenose bajtovi.
  server.on('upgrade', (req, socket, head) => {
    const target = req.url ?? '/';
    const rawPath = pathOf(target);
    if (!rawPath) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const route = routeFor(rawPath);
    const upstream = targets[route];
    let connected = false;
    const remote = connect({ host: connectHost(upstream), port: Number(upstream.port || 80) }, () => {
      connected = true;
      const headers = upstreamHeaders(req, true);
      let lines = `${req.method} ${target} HTTP/${req.httpVersion}\r\n`;
      for (let i = 0; i < headers.length; i += 2) lines += `${headers[i]}: ${headers[i + 1]}\r\n`;
      remote.write(`${lines}\r\n`);
      if (head.length > 0) remote.write(head);
      remote.pipe(socket);
      socket.pipe(remote);
    });
    const close = () => {
      remote.destroy();
      socket.destroy();
    };
    remote.on('error', (error) => {
      log(`${route} ${upstream.host} nije dostupan (WebSocket): ${error.message}`);
      if (!connected) socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      else close();
    });
    socket.on('error', close);
    remote.on('close', () => {
      if (connected) socket.destroy();
    });
    socket.on('close', () => remote.destroy());
  });

  return server;
}

/** Pokretanje: `node deploy/edge/dev-proxy.mjs` (ili `pnpm edge`). */
export async function main(env = process.env) {
  const port = Number(env['DUCTURA_EDGE_PORT'] || DEFAULT_PORT);
  const host = env['DUCTURA_EDGE_HOST'] || 'localhost';
  const targets = targetsFromEnv(env);
  const server = await createEdge({ targets, log: (line) => console.error(`[edge] ${line}`) });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolveListen(undefined));
  });
  console.log(`[edge] sluša na http://localhost:${port}/`);
  for (const key of /** @type {Upstream[]} */ (Object.keys(targets))) console.log(`[edge]   ${key} -> ${targets[key].host}`);
  return server;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`[edge] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
