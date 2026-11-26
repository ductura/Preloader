// Lokalni edge (ugovor #2028 §1): jedino podrijetlo http://localhost:8000 za preglednik.
// Samo za razvoj na jednom računalu; pravi rubni proxy u produkciji je P-0.10.
//
// Rute su u tablici `routes.ts`, iz koje čitaju i rewriteovi Nexta (src/rewrites.ts):
//   /                      -> naslovnica fronta institucije (:5173, putanja /app/web/naslovnica; DAN-1574)
//   /prijava               -> prvi ekran preloadera (Next.js, :3100; Next ga prepisuje na /; DAN-1574)
//   sve ostalo             -> preloader (Next.js, :3100)
//   /admin, /admin/*       -> Aplication_front (:3120)
//   /api/v1, /api/v1/*     -> Institution_server (:4000)
//   /app/web, /app/chrome  -> front institucije (:5173)
//   /app/mobile            -> Institution_web_mobile (DUCTURA_EDGE_MOBILE; bez nje preloader, 404)
//   /o                     -> Web_other (DUCTURA_EDGE_OTHER; bez nje preloader, 404)
// Samo lokalno: /app/web s prvog ekrana preloadera (/prijava) -> 307 na /o/ (EDGE_ONLY_REDIRECT, VS-2).
// Adresa u pregledniku za / i /prijava ostaje ista; front za / dobiva putanju iz ENTRY_REWRITES uz isti upit.
//
// Putanja se uspoređuje doslovno, bez dekodiranja i bez promjene velikih slova (P-0.10,
// src/sign-in/README.md): `/%61dmin` ili `/Admin` nisu administracija. Host, kolačići,
// Location i ostala zaglavlja prolaze nepromijenjeni u oba smjera; uklanjaju se samo
// zaglavlja jednog skoka (RFC 9110 §7.6.1). WebSocket (HMR) prolazi kao sirovi TCP.
// HTML preloadera (i stranica greške uz 502) dobiva CSP iz hasheva svoje skripte i stila (DAN-995).
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { contentSecurityPolicyFor } from './content-security-policy.ts';
import { EDGE_ONLY_REDIRECT, entryFor, SERVICES, serviceFor } from './routes.ts';
import { isMain } from '../../scripts/is-main.ts';

/** @typedef {import('./routes.ts').Service} Service */
/** @typedef {'preloader' | 'admin' | 'api' | 'front'} Upstream */
/** @typedef {'mobile' | 'other'} Variant */
/** @typedef {Record<Upstream, URL> & Partial<Record<Variant, URL>>} Targets */

const SERVICE_NAMES = /** @type {Service[]} */ (Object.keys(SERVICES));

/** Zadani portovi iz ugovora §1 (preloader i usluge s `edgeDefault` u tablici ruta). */
export const DEFAULT_TARGETS = Object.freeze(
  /** @type {Readonly<Record<Upstream, string>>} */ ({
    preloader: 'http://localhost:3100',
    ...Object.fromEntries(SERVICE_NAMES.flatMap((name) => {
      const spec = /** @type {import('./routes.ts').ServiceSpec} */ (SERVICES[name]);
      return spec.edgeDefault ? [[name, spec.edgeDefault]] : [];
    })),
  }),
);

/** Varijable okoline koje mijenjaju cilj; vrijednost je `http://host:port` bez putanje. */
export const TARGET_ENV = Object.freeze(
  /** @type {Readonly<Record<Upstream | Variant, string>>} */ ({
    preloader: 'DUCTURA_EDGE_PRELOADER',
    ...Object.fromEntries(SERVICE_NAMES.map((name) => [name, SERVICES[name].edgeEnv])),
  }),
);

export const DEFAULT_PORT = 8000;

/**
 * Politika za HTML preloadera koji nema CSP-a iz hasheva (npr. `next dev` sa svojim skriptama ili
 * komprimiran odgovor): ništa se ne izvršava ni ne učitava. Stranica se tada vidi bez stila.
 */
export const FALLBACK_CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Najveća HTML stranica preloadera koju edge pročita da bi izračunao CSP. */
const MAX_HTML_BYTES = 1024 * 1024;

/**
 * Ciljevi iz okoline, sa zadanim vrijednostima. Prihvaća se samo `http:` bez
 * korisnika, putanje, upita i fragmenta: edge prosljeđuje izvornu putanju.
 * @param {Record<string, string | undefined>} env
 * @returns {Targets}
 */
export function targetsFromEnv(env = process.env) {
  /** @type {Partial<Targets>} */
  const targets = {};
  for (const key of /** @type {(Upstream | Variant)[]} */ (Object.keys(TARGET_ENV))) {
    const name = TARGET_ENV[key];
    const raw = env[name] || (key in DEFAULT_TARGETS ? DEFAULT_TARGETS[/** @type {Upstream} */ (key)] : undefined);
    if (!raw) continue;
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
 * Kamo ide zahtjev, po tablici ruta (`routes.ts`). `rawPath` je putanja točno kako ju je poslao
 * preglednik (bez upita). Usluga bez zadanog cilja (Institution_web_mobile, Web_other) dobiva svoje
 * putanje samo kad je u `targets`; inače idu preloaderu i daju 404, kao rewrite bez varijable.
 * `referer` služi samo za razvojne putanje `next dev` (`/__nextjs_font/*`, `/__nextjs_original-stack-frames`):
 * Next ih traži bez basePatha, pa idu usluzi čija ih je stranica tražila. Samo lokalno (LOK-2).
 * @param {string} rawPath
 * @param {string} [referer]
 * @param {Partial<Record<Upstream | Variant, URL>>} [targets]
 * @returns {Upstream | Variant}
 */
export function routeFor(rawPath, referer, targets = {}) {
  return forwardFor(rawPath, referer, targets).route;
}

/** Usluga iz tablice lokalno postoji: ima zadani cilj ili varijablu. */
function available(/** @type {Service} */ service, /** @type {Partial<Record<Upstream | Variant, URL>>} */ targets) {
  const spec = /** @type {import('./routes.ts').ServiceSpec} */ (SERVICES[service]);
  return spec.edgeDefault !== undefined || targets[service] !== undefined;
}

/**
 * Kamo ide zahtjev i s kojom putanjom (bez upita). Ulaz usluge (`/` na naslovnicu fronta; ENTRY_REWRITES,
 * DAN-1574) mijenja putanju prema uzvodnom; sve ostale putanje idu nepromijenjene. `/prijava` ide preloaderu
 * kao `/prijava`: njegov Next je sam prepisuje na `/` (src/rewrites.ts, `entryRewrites`). Poslan kao `/`,
 * preloader izgrađen s `INSTITUTION_FRONT_URL` bi ga opet poslao na naslovnicu. Ulaz čija usluga lokalno
 * ne postoji ide preloaderu s izvornom putanjom.
 * @param {string} rawPath
 * @param {string} [referer]
 * @param {Partial<Record<Upstream | Variant, URL>>} [targets]
 * @returns {{ route: Upstream | Variant, path: string }}
 */
export function forwardFor(rawPath, referer, targets = {}) {
  const entry = entryFor(rawPath);
  if (entry !== null) {
    if (entry.service === null) return { route: 'preloader', path: rawPath };
    if (available(entry.service, targets)) return { route: entry.service, path: entry.destination };
    return { route: 'preloader', path: rawPath };
  }
  const service = serviceFor(rawPath);
  if (service !== null) return { route: available(service, targets) ? service : 'preloader', path: rawPath };
  if (rawPath.startsWith('/__nextjs') && referer) {
    let from = '';
    try {
      from = new URL(referer).pathname;
    } catch {
      // Neispravan Referer: preloader.
    }
    if (from && !from.startsWith('/__nextjs')) return { route: routeFor(from, undefined, targets), path: rawPath };
  }
  return { route: 'preloader', path: rawPath };
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

// Samo odabir s prvog ekrana preloadera (`/prijava`, DAN-1574) koristi /app/web/ za Web_other. Povratak iz
// AAI@EduHr, izravni pristup, poveznice naslovnice (`/`) i Chromeovi resursi pod /app/web/ pripadaju
// postojećem hostu.
function fromFirstScreen(/** @type {import('node:http').IncomingMessage} */ req) {
  const source = URL.parse(req.headers.referer ?? '');
  if (source?.protocol !== 'http:' || source.host !== req.headers.host) return false;
  const entry = entryFor(source.pathname);
  return entry !== null && entry.service === null;
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

/** Sirova zaglavlja bez navedenih imena (mala slova). */
function without(/** @type {string[]} */ raw, /** @type {string[]} */ names) {
  const drop = new Set(names);
  const kept = [];
  for (let i = 0; i < raw.length; i += 2) {
    if (!drop.has((raw[i] ?? '').toLowerCase())) kept.push(raw[i] ?? '', raw[i + 1] ?? '');
  }
  return kept;
}

/**
 * Zaglavlja prema uzvodnom: izvorna (s Hostom preglednika) plus X-Forwarded-*. Preloaderu bez
 * `Accept-Encoding` i `Range`, da HTML stigne cijel i nekomprimiran i edge može izračunati CSP.
 * @param {import('node:http').IncomingMessage} req
 * @param {boolean} upgrade
 * @param {boolean} identity
 */
function upstreamHeaders(req, upgrade, identity = false) {
  const forwardedFor = req.socket.remoteAddress ?? '';
  const host = req.headers.host ?? '';
  const drop = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', ...(identity ? ['accept-encoding', 'range', 'if-range'] : [])];
  const kept = without(endToEnd(req.rawHeaders, upgrade), drop);
  kept.push('X-Forwarded-For', forwardedFor, 'X-Forwarded-Host', host, 'X-Forwarded-Proto', 'http');
  // Tijelo bez duljine (chunked) mora i prema uzvodnom imati okvir: Node ga sam ne
  // dodaje za svaku metodu (npr. DELETE), pa bi bajtovi tijela prošli bez okvira.
  if (!upgrade && req.headers['transfer-encoding'] !== undefined && req.headers['content-length'] === undefined) {
    kept.push('Transfer-Encoding', 'chunked');
  }
  return kept;
}

const isHtml = (/** @type {string | undefined} */ type) => String(type).toLowerCase().startsWith('text/html');

/** Kratak tekstualni odgovor (bez HTML-a, pa bez CSP-a). */
function sendPlain(/** @type {import('node:http').ServerResponse} */ res, /** @type {number} */ status) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`${status}\n`);
}

/** Cijelo tijelo odgovora, ili null kad je veće od `limit` (tada se veza prekida). */
function readBody(/** @type {import('node:http').IncomingMessage} */ incoming, /** @type {number} */ limit) {
  return new Promise((resolveBody, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    incoming.on('data', (/** @type {Buffer} */ chunk) => {
      size += chunk.length;
      if (size > limit) {
        incoming.destroy();
        resolveBody(null);
        return;
      }
      chunks.push(chunk);
    });
    incoming.on('end', () => resolveBody(Buffer.concat(chunks)));
    incoming.on('error', reject);
  });
}

/**
 * HTML preloadera s CSP-om iz hasheva njegove jedine skripte i stila; stranica bez skripte (404)
 * dobiva `script-src 'none'`. Kad se politika ne da izračunati, ide stroga `FALLBACK_CSP`.
 * Odgovor na HEAD Node šalje bez tijela, s istim zaglavljima kao GET.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string[]} headers zaglavlja odgovora (sirova)
 * @param {import('node:http').IncomingMessage} incoming
 * @param {(line: string) => void} log
 */
async function sendHtml(res, status, headers, incoming, log) {
  let body;
  try {
    body = await readBody(incoming, MAX_HTML_BYTES);
  } catch {
    res.destroy();
    return;
  }
  if (body === null) {
    log(`preloader: HTML veći od ${MAX_HTML_BYTES} B, bez CSP-a se ne šalje`);
    sendPlain(res, 502);
    return;
  }
  let policy = FALLBACK_CSP;
  const encoding = String(incoming.headers['content-encoding'] ?? 'identity').toLowerCase();
  if (encoding !== 'identity') {
    log(`preloader: komprimiran HTML (${encoding}), stroga politika`);
  } else {
    try {
      policy = await contentSecurityPolicyFor(body.toString('utf8'), { scriptOptional: true });
    } catch (error) {
      log(`preloader: stranica nema CSP iz hasheva (${error instanceof Error ? error.message : error}), stroga politika`);
    }
  }
  if (res.headersSent) return;
  const kept = without(headers, ['content-security-policy', 'content-length']);
  kept.push('Content-Security-Policy', policy, 'Content-Length', String(body.length));
  res.writeHead(status, kept);
  res.end(body);
}

/** Odgovor kad uzvodni ne odgovori: stranica greške preloadera (`/greska.html`) s CSP-om, a bez nje kratak tekst. */
function sendError(
  /** @type {URL} */ preloader,
  /** @type {import('node:http').ServerResponse} */ res,
  /** @type {number} */ status,
  /** @type {(line: string) => void} */ log,
) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const plain = () => sendPlain(res, status);
  const page = httpRequest({ hostname: connectHost(preloader), port: preloader.port || 80, path: '/greska.html', timeout: 5000 });
  page.on('response', (incoming) => {
    if (incoming.statusCode !== 200 || !isHtml(incoming.headers['content-type'])) {
      incoming.resume();
      plain();
      return;
    }
    void sendHtml(res, status, ['Content-Type', 'text/html; charset=utf-8', 'Cache-Control', 'no-store'], incoming, log);
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
    const otherEntry = targets[EDGE_ONLY_REDIRECT.requires] !== undefined && EDGE_ONLY_REDIRECT.paths.includes(rawPath);
    if (otherEntry && (req.method === 'GET' || req.method === 'HEAD') && fromFirstScreen(req)) {
      const location = `${EDGE_ONLY_REDIRECT.location}${target.slice(rawPath.length)}`;
      res.writeHead(EDGE_ONLY_REDIRECT.status, { Location: location, 'Cache-Control': 'no-store' }).end();
      return;
    }
    const { route, path } = forwardFor(rawPath, req.headers.referer, targets);
    // Preloader nema obrazaca ni API-ja: drugo od GET i HEAD ne ide dalje.
    if (route === 'preloader' && req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }

    const upstream = targets[route] ?? targets.preloader;
    const preloader = route === 'preloader';
    const outgoing = httpRequest({
      hostname: connectHost(upstream),
      port: upstream.port || 80,
      // HEAD na preloader ide kao GET: CSP se računa iz tijela, a Node odgovor na HEAD šalje bez njega.
      method: preloader && req.method === 'HEAD' ? 'GET' : req.method,
      path: `${path}${target.slice(rawPath.length)}`,
      headers: upstreamHeaders(req, false, preloader),
      setHost: false,
    });
    outgoing.on('response', (incoming) => {
      const status = incoming.statusCode ?? 502;
      // 304 nema tijela: preglednik zadržava spremljenu stranicu i njezin CSP.
      if (preloader && status !== 304 && isHtml(incoming.headers['content-type'])) {
        void sendHtml(res, status, endToEnd(incoming.rawHeaders), incoming, log);
        return;
      }
      const headers = endToEnd(incoming.rawHeaders);
      if (otherEntry) headers.push('Vary', 'Referer');
      res.writeHead(status, incoming.statusMessage, headers);
      incoming.pipe(res);
      incoming.on('error', () => res.destroy());
    });
    outgoing.on('error', (error) => {
      log(`${route} ${upstream.host} nije dostupan: ${error.message}`);
      // Kad ne odgovara sam preloader, ni stranice greške nema: kratak tekst.
      sendError(targets.preloader, res, 502, log);
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
    const { route, path } = forwardFor(rawPath, undefined, targets);
    const upstream = targets[route] ?? targets.preloader;
    let connected = false;
    const remote = connect({ host: connectHost(upstream), port: Number(upstream.port || 80) }, () => {
      connected = true;
      const headers = upstreamHeaders(req, true);
      let lines = `${req.method} ${path}${target.slice(rawPath.length)} HTTP/${req.httpVersion}\r\n`;
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
  for (const [key, target] of Object.entries(targets)) console.log(`[edge]   ${key} -> ${target.host}`);
  return server;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`[edge] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
