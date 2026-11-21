// Tablica ruta (deploy/edge/routes.ts, P-0.10): rewriteovi Nexta (src/rewrites.ts kroz next.config.ts) i
// lokalni edge (deploy/edge/dev-proxy.mjs) za istu putanju daju isti cilj. Jedina namjerna razlika je u
// tablici izričito: `/app/web` s početne stranice lokalni edge šalje s 307 na `/o/`, a rewrite na front
// institucije. Usluge su lažni poslužitelji na 127.0.0.1; mreže izvan računala nema.
//
// Strana rewritea: pravila iz `next.config.ts` primjenjuju se redom kojim ih Next primjenjuje
// (beforeFiles, stranice, afterFiles, fallback). Stvarni `next start` za iste putanje provjerava
// test/next-start.test.ts. Strana edgea: stvarni edge pred lažnim uslugama i lažnim preloaderom koji
// odgovara kao Next bez varijabli usluga.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createEdge, routeFor, targetsFromEnv } from '../deploy/edge/dev-proxy.mjs';
import { EDGE_ONLY_REDIRECT, ROUTES, serviceFor, SERVICES, type Service } from '../deploy/edge/routes.ts';
import nextConfig from '../next.config.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const SERVICE_NAMES = Object.keys(SERVICES) as Service[];

/** Cilj zahtjeva: usluga s putanjom koju je primila, stranica preloadera sa statusom, ili preusmjeravanje. */
type Target = string;
const toService = (service: Service, path: string): Target => `${service} ${path}`;
const toPreloader = (status: number): Target => `preloader ${status}`;
const toRedirect = (status: number, location: string): Target => `${status} -> ${location}`;

// ——— Strana rewritea: next.config.ts ———

interface NextRewrite {
  source: string;
  destination: string;
}
interface NextRewrites {
  beforeFiles: NextRewrite[];
  afterFiles: NextRewrite[];
  fallback: NextRewrite[];
}

/** Putanje koje Next poslužuje sam (Pages i App Router), iz datoteka repoa. */
function nextPages(): Set<string> {
  const pages = new Set<string>();
  for (const file of readdirSync(join(root, 'pages'))) {
    const name = file.replace(/\.tsx?$/, '');
    if (name.startsWith('_')) continue;
    pages.add(name === 'index' ? '/' : `/${name}`);
  }
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/^(page|route)\.tsx?$/.test(entry.name)) {
        const segments = relative(join(root, 'app'), dir).split(/[\\/]/).filter((s) => s && !/^\(.*\)$/.test(s));
        pages.add(`/${segments.join('/')}`);
      }
    }
  };
  walk(join(root, 'app'));
  return pages;
}
const PAGES = nextPages();
/** Ruta na koju fallback šalje nepoznatu putanju; odgovara s 404 (app/(ulaz)/stranica-ne-postoji). */
const NOT_FOUND_ROUTE = '/stranica-ne-postoji';

/** Izvor rewritea u obliku koji koristimo (`/x`, `/x/:path*`, `/:path*`) prema putanji; vraća odredište ili null. */
function applyRewrite(rule: NextRewrite, path: string): string | null {
  const star = /^(.*)\/:path\*$/.exec(rule.source);
  if (star) {
    const base = star[1] ?? '';
    if (path !== base && !path.startsWith(`${base}/`)) return null;
    const rest = path.slice(base.length + 1);
    return rule.destination.replace(/\/:path\*$/, rest === '' ? '' : `/${rest}`);
  }
  return rule.source === path ? rule.destination : null;
}

/** Usluga čije je podrijetlo u odredištu, po varijablama okoline. */
function serviceOfDestination(env: Record<string, string>, destination: string): { service: Service; path: string } | null {
  const url = new URL(destination);
  for (const service of SERVICE_NAMES) {
    const value = env[SERVICES[service].rewriteEnv];
    if (value && new URL(value).origin === url.origin) return { service, path: `${url.pathname}${url.search}` };
  }
  return null;
}

async function rewritesFor(env: Record<string, string>): Promise<NextRewrites> {
  const saved = { ...process.env };
  for (const service of SERVICE_NAMES) delete process.env[SERVICES[service].rewriteEnv];
  Object.assign(process.env, env);
  try {
    const rewrites = await nextConfig.rewrites?.();
    if (!rewrites || Array.isArray(rewrites)) throw new Error('next.config.ts mora vratiti beforeFiles, afterFiles i fallback');
    return rewrites as NextRewrites;
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

/** Kamo Next s ovim rewriteovima šalje putanju (s upitom). */
function nextTarget(rewrites: NextRewrites, env: Record<string, string>, target: string): Target {
  const [rawPath = '', query] = target.split(/\?(.*)/s, 2);
  const search = query === undefined ? '' : `?${query}`;
  const resolve = (destination: string): Target => {
    if (/^https?:\/\//.test(destination)) {
      const found = serviceOfDestination(env, `${destination}${search}`);
      if (!found) throw new Error(`odredište ${destination} nije nijedna usluga`);
      return toService(found.service, found.path);
    }
    return destination === NOT_FOUND_ROUTE ? toPreloader(404) : toPreloader(PAGES.has(destination) ? 200 : 404);
  };
  // Next uspoređuje putanju bez završne kose crte (`trailingSlash: false`); provjereno na `next start`.
  let path = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath;
  for (const rule of rewrites.beforeFiles) {
    const destination = applyRewrite(rule, path);
    if (destination !== null) path = destination;
  }
  if (PAGES.has(path)) return resolve(path);
  for (const rule of rewrites.afterFiles) {
    const destination = applyRewrite(rule, path);
    if (destination !== null) return resolve(destination);
  }
  for (const rule of rewrites.fallback) {
    const destination = applyRewrite(rule, path);
    if (destination !== null) return resolve(destination);
  }
  return toPreloader(404);
}

// ——— Strana edgea: stvarni dev-proxy ———

const servers: Server[] = [];
const seen: { upstream: Service | 'preloader'; url: string }[] = [];
const ports = {} as Record<Service, number>;
let preloaderRewrites: NextRewrites;
let edgeOrigin = '';
let edgeOriginWithoutVariants = '';

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

function fakeService(name: Service): Server {
  return createServer((req, res) => {
    seen.push({ upstream: name, url: req.url ?? '' });
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Upstream': name }).end(name);
  });
}

/** Lažni preloader: odgovara kao Next bez varijabli usluga (stranica 200, sve ostalo 404). */
function fakePreloader(): Server {
  return createServer((req, res) => {
    const url = req.url ?? '/';
    seen.push({ upstream: 'preloader', url });
    const status = nextTarget(preloaderRewrites, {}, url) === toPreloader(200) ? 200 : 404;
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Upstream': 'preloader' }).end(String(status));
  });
}

/** Zahtjev s putanjom točno kako je napisana (fetch bi je normalizirao). */
function rawGet(origin: string, target: string, referer?: string): Promise<{ status: number; headers: string }> {
  const { hostname, port } = new URL(origin);
  return new Promise((resolve, reject) => {
    const socket = connect(Number(port), hostname, () => {
      const ref = referer === undefined ? '' : `Referer: ${referer}\r\n`;
      socket.write(`GET ${target} HTTP/1.1\r\nHost: ${hostname}:${port}\r\n${ref}Connection: close\r\n\r\n`);
    });
    let data = '';
    socket.on('data', (chunk) => (data += chunk.toString()));
    socket.on('end', () => resolve({ status: Number(data.split(' ')[1]), headers: data.split('\r\n\r\n')[0] ?? '' }));
    socket.on('error', reject);
  });
}

async function edgeTarget(origin: string, target: string, referer?: string): Promise<Target> {
  seen.length = 0;
  const res = await rawGet(origin, target, referer);
  if (seen.length === 0) {
    const location = /\r\nLocation: ([^\r\n]*)/i.exec(res.headers)?.[1] ?? '';
    return toRedirect(res.status, location);
  }
  expect(seen).toHaveLength(1);
  const [hit] = seen;
  if (!hit) throw new Error('nema zahtjeva');
  return hit.upstream === 'preloader' ? toPreloader(res.status) : toService(hit.upstream, hit.url);
}

const rewriteEnvAll = (): Record<string, string> =>
  Object.fromEntries(SERVICE_NAMES.map((s) => [SERVICES[s].rewriteEnv, `http://127.0.0.1:${ports[s]}`]));
const rewriteEnvWithoutVariants = (): Record<string, string> =>
  Object.fromEntries(
    SERVICE_NAMES.filter((s) => s !== 'mobile' && s !== 'other').map((s) => [SERVICES[s].rewriteEnv, `http://127.0.0.1:${ports[s]}`]),
  );

beforeAll(async () => {
  for (const service of SERVICE_NAMES) ports[service] = await listen(fakeService(service));
  preloaderRewrites = await rewritesFor({});
  const preloaderPort = await listen(fakePreloader());
  const edgeEnv = (services: Service[]) => ({
    DUCTURA_EDGE_PRELOADER: `http://127.0.0.1:${preloaderPort}`,
    ...Object.fromEntries(services.map((s) => [SERVICES[s].edgeEnv, `http://127.0.0.1:${ports[s]}`])),
  });
  edgeOrigin = `http://127.0.0.1:${await listen(await createEdge({ targets: targetsFromEnv(edgeEnv(SERVICE_NAMES)) }))}`;
  const withoutVariants = SERVICE_NAMES.filter((s) => s !== 'mobile' && s !== 'other');
  edgeOriginWithoutVariants = `http://127.0.0.1:${await listen(await createEdge({ targets: targetsFromEnv(edgeEnv(withoutVariants)) }))}`;
});

afterAll(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

// ——— Tablica ———

/** Zahtjev s početne stranice istog podrijetla (odabir u preloaderu). */
const FIRST_SCREEN = 'first-screen';

/** Zatvoren skup razloga zbog kojih rewrite i lokalni edge smiju dati različit cilj. */
const DIFFERENCES = {
  edgeOnlyRedirect: 'samo lokalni edge (VS-2): odabir „ostala sučelja” s početne stranice otvara Web_other',
  bareSlash: 'ista usluga; rewrite gole putanje dodaje kosu crtu za Vite base fronta institucije',
  trailingSlash: 'ista usluga; Next uspoređuje i prosljeđuje bez završne kose crte, edge putanju ne mijenja',
} as const;

interface Row {
  path: string;
  referer?: typeof FIRST_SCREEN;
  rewrite: Target;
  /** Izostavljeno: isto kao rewrite. Navedeno samo uz razlog iz `DIFFERENCES`. */
  edge?: Target;
  why?: keyof typeof DIFFERENCES;
}

/** Sve usluge pokrenute i zadane (Vercel s pet varijabli, lokalno `pnpm sve` s pet frontova). */
const ALL: Row[] = [
  { path: '/', rewrite: toPreloader(200) },
  { path: '/greska.html?status=503', rewrite: toPreloader(200) },
  { path: '/admin', rewrite: toService('admin', '/admin') },
  { path: '/admin/postavke?kartica=1', rewrite: toService('admin', '/admin/postavke?kartica=1') },
  { path: '/api/v1', rewrite: toService('api', '/api/v1') },
  { path: '/api/v1/auth/login?returnTo=%2Fapp%2Fweb%2F', rewrite: toService('api', '/api/v1/auth/login?returnTo=%2Fapp%2Fweb%2F') },
  { path: '/app/chrome/assets/x.js', rewrite: toService('front', '/app/chrome/assets/x.js') },
  { path: '/app/mobile', rewrite: toService('mobile', '/app/mobile') },
  { path: '/app/mobile/zadaci?v=1', rewrite: toService('mobile', '/app/mobile/zadaci?v=1') },
  { path: '/o', rewrite: toService('other', '/o') },
  { path: '/o/zadaci/7', rewrite: toService('other', '/o/zadaci/7') },
  // /app/web bez dolaska s početne stranice (izravni ulaz, povratak iz AAI@EduHr): oba na front institucije.
  { path: '/app/web/zadaci', rewrite: toService('front', '/app/web/zadaci') },
  // Izričite razlike.
  {
    path: '/app/web/',
    referer: FIRST_SCREEN,
    rewrite: toService('front', '/app/web/'),
    edge: toRedirect(EDGE_ONLY_REDIRECT.status, EDGE_ONLY_REDIRECT.location),
    why: 'edgeOnlyRedirect',
  },
  {
    path: '/app/web?x=1',
    referer: FIRST_SCREEN,
    rewrite: toService('front', '/app/web/?x=1'),
    edge: toRedirect(307, '/o/?x=1'),
    why: 'edgeOnlyRedirect',
  },
  { path: '/app/web/', rewrite: toService('front', '/app/web/') },
  { path: '/app/chrome', rewrite: toService('front', '/app/chrome/'), edge: toService('front', '/app/chrome'), why: 'bareSlash' },
  { path: '/app/mobile/', rewrite: toService('mobile', '/app/mobile'), edge: toService('mobile', '/app/mobile/'), why: 'trailingSlash' },
  { path: '/o/?q=1', rewrite: toService('other', '/o?q=1'), edge: toService('other', '/o/?q=1'), why: 'trailingSlash' },
  { path: '/admin/', rewrite: toService('admin', '/admin'), edge: toService('admin', '/admin/'), why: 'trailingSlash' },
  // Nepoznata putanja: 404 u oba (preloader, fallback u next.config.ts).
  ...['/nema-me', '/api/v2/x', '/api/v1x', '/administracija', '/Admin', '/%61dmin', '/app/webx', '/app/mobilex', '/ostalo', '/O/x', '/%6F/x', '/app'].map(
    (path): Row => ({ path, rewrite: toPreloader(404) }),
  ),
];

/** Bez varijabli za Institution_web_mobile i Web_other: njihove putanje daju 404 u oba, ostalo radi. */
const WITHOUT_VARIANTS: Row[] = [
  { path: '/', rewrite: toPreloader(200) },
  { path: '/api/v1/me', rewrite: toService('api', '/api/v1/me') },
  { path: '/app/mobile', rewrite: toPreloader(404) },
  { path: '/app/mobile/zadaci', rewrite: toPreloader(404) },
  { path: '/o', rewrite: toPreloader(404) },
  { path: '/o/zadaci', rewrite: toPreloader(404) },
  // Bez Web_other nema ni preusmjeravanja: i lokalni edge šalje na front institucije.
  { path: '/app/web/', referer: FIRST_SCREEN, rewrite: toService('front', '/app/web/') },
];

describe.each([
  ['sve usluge zadane', ALL, rewriteEnvAll, () => edgeOrigin],
  ['bez Institution_web_mobile i Web_other', WITHOUT_VARIANTS, rewriteEnvWithoutVariants, () => edgeOriginWithoutVariants],
] as const)('%s: rewrite i lokalni edge', (_name, rows, env, origin) => {
  test.each(rows.map((row) => [row.referer ? `${row.path} (s početne stranice)` : row.path, row] as const))('%s', async (_label, row) => {
    const rewrites = await rewritesFor(env());
    const viaRewrite = nextTarget(rewrites, env(), row.path);
    const referer = row.referer === FIRST_SCREEN ? `${origin()}/` : undefined;
    const viaEdge = await edgeTarget(origin(), row.path, referer);
    expect({ rewrite: viaRewrite, edge: viaEdge }).toEqual({ rewrite: row.rewrite, edge: row.edge ?? row.rewrite });
  });
});

describe('tablica', () => {
  test('svaka putanja iz tablice ruta ima redak sa svojom uslugom u oba ulaza', () => {
    const covered = new Set(ALL.filter((row) => row.edge === undefined).map((row) => serviceFor(row.path.split('?')[0] ?? '')));
    for (const { service } of ROUTES) expect(covered).toContain(service);
    expect(ALL.some((row) => row.path === '/' && row.rewrite === toPreloader(200))).toBe(true);
  });

  test('svaka izričita razlika ima razlog, a razlog odgovara retku', () => {
    for (const row of [...ALL, ...WITHOUT_VARIANTS]) {
      const path = row.path.split('?')[0] ?? '';
      const service = serviceFor(path);
      if (row.edge === undefined) {
        expect(row.why).toBeUndefined();
        continue;
      }
      expect(row.why, row.path).toBeDefined();
      if (row.why === 'edgeOnlyRedirect') {
        expect(EDGE_ONLY_REDIRECT.paths).toContain(path);
        expect(row.referer).toBe(FIRST_SCREEN);
        expect(row.rewrite.startsWith('front ')).toBe(true);
        expect(row.edge.startsWith(`${EDGE_ONLY_REDIRECT.status} -> ${EDGE_ONLY_REDIRECT.location}`)).toBe(true);
      } else {
        // Ista usluga, putanja se razlikuje samo u završnoj kosoj crti.
        expect(service).not.toBeNull();
        const strip = (t: string) => t.replace(/\/(?=\?|$)/, '');
        expect(row.rewrite.split(' ')[0]).toBe(service);
        expect(row.edge.split(' ')[0]).toBe(service);
        expect(strip(row.rewrite)).toBe(strip(row.edge));
        if (row.why === 'bareSlash') expect(ROUTES.some((r) => r.prefix === path && SERVICES[r.service].bareSlash)).toBe(true);
        if (row.why === 'trailingSlash') expect(path.endsWith('/')).toBe(true);
      }
    }
    expect(ALL.filter((row) => row.why === 'edgeOnlyRedirect').length).toBeGreaterThan(0);
  });

  test('prefiksi se ne preklapaju i počinju kosom crtom', () => {
    for (const a of ROUTES) {
      expect(a.prefix).toMatch(/^\/[^?#]*[^/]$/);
      for (const b of ROUTES) if (a !== b) expect(b.prefix === a.prefix || b.prefix.startsWith(`${a.prefix}/`)).toBe(false);
    }
  });

  test('usluga bez zadanog lokalnog cilja lokalno postoji samo uz varijablu', () => {
    expect(routeFor('/app/mobile/x')).toBe('preloader');
    expect(routeFor('/o/x')).toBe('preloader');
    const targets = targetsFromEnv({ DUCTURA_EDGE_MOBILE: 'http://localhost:5174', DUCTURA_EDGE_OTHER: 'http://localhost:5175' });
    expect(routeFor('/app/mobile/x', undefined, targets)).toBe('mobile');
    expect(routeFor('/o/x', undefined, targets)).toBe('other');
  });
});

describe('podrijetlo s putanjom ruši izgradnju', () => {
  test.each(SERVICE_NAMES.map((s) => SERVICES[s].rewriteEnv))('%s: next.config.ts odbija rewrite', async (name) => {
    await expect(rewritesFor({ [name]: 'https://usluga.example.test/putanja' })).rejects.toThrow(new RegExp(name));
  });

  test('stvarni next build pada prije prevođenja', async () => {
    const project = join(root, `.next-proba-${randomBytes(4).toString('hex')}`);
    mkdirSync(project);
    try {
      for (const entry of ['pages', 'app', 'src', 'scripts', 'deploy', 'next.config.ts', 'package.json', 'tsconfig.json', 'tsconfig.next.json']) {
        cpSync(join(root, entry), join(project, entry), { recursive: true });
      }
      const { code, out } = await new Promise<{ code: number | null; out: string }>((resolve, reject) => {
        const child = spawn(process.execPath, [join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], {
          cwd: project,
          env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', WEB_OTHER_URL: 'https://other.example.test/o' },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let log = '';
        child.stdout.on('data', (c: Buffer) => (log += c.toString()));
        child.stderr.on('data', (c: Buffer) => (log += c.toString()));
        child.once('error', reject);
        child.once('exit', (exit) => resolve({ code: exit, out: log }));
      });
      expect(code).not.toBe(0);
      expect(out).toContain('WEB_OTHER_URL must be an origin without a path, query or fragment');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  }, 120_000);
});
