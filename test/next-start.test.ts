// Rewriteovi (src/rewrites.ts) i 404 kroz stvarni `next build` + `next start`, te CSP lokalnog edgea na
// stranicama koje Next stvarno vraća. Usluge su lažni poslužitelji na 127.0.0.1; mreže izvan računala nema.
// Izgradnja ide u privremenu kopiju projekta unutar repoa (`.next-proba-*`, u .gitignore), da `.next` i
// `next-env.d.ts` repoa ostanu netaknuti; node_modules se nalazi u roditeljskoj mapi.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createEdge, FALLBACK_CSP, targetsFromEnv } from '../deploy/edge/dev-proxy.mjs';
import { errorText } from '../src/text.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const NEXT_BIN = join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
// `deploy`: src/rewrites.ts čita tablicu ruta iz deploy/edge/routes.ts.
const COPY = ['pages', 'src', 'scripts', 'deploy', 'next.config.ts', 'package.json', 'tsconfig.json'];

interface Seen {
  upstream: string;
  method: string;
  url: string;
  body: string;
}

const seen: Seen[] = [];
const servers: Server[] = [];
let project: string;
let next: ChildProcess | undefined;
let nextOrigin: string;
let edgeOrigin: string;
let nextLog = '';

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

/** Lažna usluga: zapisuje metodu, putanju s upitom i tijelo; odgovara 201 sa svojim imenom. */
function fakeService(name: string): Server {
  return createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      seen.push({ upstream: name, method: req.method ?? '', url: req.url ?? '', body });
      res.writeHead(201, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Upstream': name }).end(`odgovor ${name}`);
    });
  });
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

function run(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [NEXT_BIN, ...args], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString()));
    child.stderr.on('data', (c: Buffer) => (out += c.toString()));
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`next ${args[0]} izašao ${code}:\n${out}`))));
  });
}

async function waitFor(url: string, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // još se pokreće
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`next start ne odgovara na ${url}:\n${nextLog}`);
}

beforeAll(async () => {
  const ports = {
    admin: await listen(fakeService('admin')),
    api: await listen(fakeService('api')),
    front: await listen(fakeService('front')),
  };
  project = join(root, `.next-proba-${randomBytes(4).toString('hex')}`);
  mkdirSync(project);
  for (const entry of COPY) cpSync(join(root, entry), join(project, entry), { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
    APLICATION_FRONT_URL: `http://127.0.0.1:${ports.admin}`,
    INSTITUTION_SERVER_URL: `http://127.0.0.1:${ports.api}/`,
    INSTITUTION_FRONT_URL: `http://127.0.0.1:${ports.front}`,
  };
  await run(['build'], env);

  const port = await freePort();
  nextOrigin = `http://127.0.0.1:${port}`;
  next = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(port), '-H', '127.0.0.1'], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
  next.stdout?.on('data', (c: Buffer) => (nextLog += c.toString()));
  next.stderr?.on('data', (c: Buffer) => (nextLog += c.toString()));
  await waitFor(`${nextOrigin}/greska`, 30_000);

  const edge = await createEdge({ targets: targetsFromEnv({ DUCTURA_EDGE_PRELOADER: nextOrigin }) });
  edgeOrigin = `http://127.0.0.1:${await listen(edge)}`;
}, 240_000);

afterAll(async () => {
  if (next && next.exitCode === null) {
    const exited = new Promise((resolve) => next?.once('exit', resolve));
    next.kill('SIGTERM');
    await exited;
  }
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  if (project) rmSync(project, { recursive: true, force: true });
});

describe('next start: rewriteovi do usluga', () => {
  test('POST /api/v1/client-context: metoda, putanja, upit i tijelo stižu do Institution_servera', async () => {
    seen.length = 0;
    const body = JSON.stringify({ surface: 'web', device: 'desktop' });
    const res = await fetch(`${nextOrigin}/api/v1/client-context?izvor=preloader&put=%2Fapp%2Fweb%2F`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('x-upstream')).toBe('api');
    expect(await res.text()).toBe('odgovor api');
    expect(seen).toEqual([{ upstream: 'api', method: 'POST', url: '/api/v1/client-context?izvor=preloader&put=%2Fapp%2Fweb%2F', body }]);
  });

  test.each([
    ['GET', '/api/v1/auth/login?returnTo=%2Fapp%2Fweb%2F', 'api', '/api/v1/auth/login?returnTo=%2Fapp%2Fweb%2F'],
    ['DELETE', '/api/v1', 'api', '/api/v1'],
    ['PUT', '/admin/postavke?kartica=1', 'admin', '/admin/postavke?kartica=1'],
    ['GET', '/admin', 'admin', '/admin'],
    ['PATCH', '/app/chrome/a/b?c=d', 'front', '/app/chrome/a/b?c=d'],
    ['GET', '/app/web', 'front', '/app/web/'],
    ['GET', '/app/web/assets/x.js', 'front', '/app/web/assets/x.js'],
    // Karta adresa (D-318, DAN-1574): naslovnica na `/`, javne stranice na vrhu, nova adresa aplikacije
    // prepisana na staru osnovu fronta, administracija doslovno (Aplication_front#24); upit ide uz odredište.
    ['GET', '/', 'front', '/app/web/naslovnica'],
    ['GET', '/?izvor=a&put=%2Fapp%2Fweb%2F', 'front', '/app/web/naslovnica?izvor=a&put=%2Fapp%2Fweb%2F'],
    ['GET', '/pomoc', 'front', '/app/web/pomoc'],
    ['GET', '/stanje?x=1', 'front', '/app/web/stanje?x=1'],
    ['GET', '/preuzimanja/windows/a.msi', 'front', '/app/web/preuzimanja/windows/a.msi'],
    ['GET', '/aplikacija', 'front', '/app/web/'],
    ['POST', '/aplikacija/zadaci?godina=2026', 'front', '/app/web/zadaci?godina=2026'],
    ['GET', '/administracija', 'admin', '/administracija'],
    ['GET', '/administracija/prijava', 'admin', '/administracija/prijava'],
  ])('%s %s ide na %s kao %s', async (method, path, upstream, url) => {
    seen.length = 0;
    const res = await fetch(`${nextOrigin}${path}`, { method, redirect: 'manual' });
    expect(res.status).toBe(201);
    expect(seen.map((s) => [s.upstream, s.method, s.url])).toEqual([[upstream, method, url]]);
  });
});

describe('next start: preloader na /ulaz (karta adresa D-318)', () => {
  test.each(['/ulaz', '/ulaz/', '/ulaz?x=1'])('%s je preloader i ne ide nijednoj usluzi', async (path) => {
    seen.length = 0;
    const res = await fetch(`${nextOrigin}${path}`, { redirect: 'manual' });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<html lang="hr">');
    expect(html).toContain('id="sign-in-aai"');
    expect(seen).toEqual([]);
  });
});

describe('next start: nepoznata putanja', () => {
  // Stare adrese (`/prijava`, `/download`, `/api/auth`) Next ne poznaje: lokalno ih preusmjerava edge, a na
  // ductura.org produkcijski rub (DAN-939).
  test.each(['/nema-me', '/api/v2/x', '/api/v1x', '/app/mobile/', '/administracijax', '/ulaz/x', '/prijava', '/download/x', '/api/auth/logout'])(
    '%s daje 404 s hrvatskom stranicom i ne ide nijednoj usluzi',
    async (path) => {
      seen.length = 0;
      const res = await fetch(`${nextOrigin}${path}`, { redirect: 'manual' });
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toMatch(/^text\/html/);
      const html = await res.text();
      expect(html).toContain('<html lang="hr">');
      expect(html).toContain(`${errorText.notFound.title} · Ductura`);
      expect(seen).toEqual([]);
    },
  );
});

describe('lokalni edge ispred next start: CSP iz hasheva na stvarnim stranicama', () => {
  const sha = (text: string) => `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}`;
  const inner = (html: string, tag: string) => html.match(new RegExp(`<${tag}(?: data-next-head="")?>([^]*?)</${tag}>`))?.[1];

  test.each([
    ['/ulaz', 200],
    ['/greska.html', 200],
    ['/greska.html?status=503', 200],
    ['/nema-me', 404],
  ])('%s', async (path, status) => {
    const res = await fetch(`${edgeOrigin}${path}`, { headers: { 'Accept-Encoding': 'gzip, br' } });
    expect(res.status).toBe(status);
    const html = await res.text();
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).not.toBe(FALLBACK_CSP);
    const style = inner(html, 'style');
    const script = inner(html, 'script');
    expect(style).toBeDefined();
    expect(csp).toContain(`style-src '${sha(style ?? '')}';`);
    expect(csp).toContain(script === undefined ? "script-src 'none';" : `script-src '${sha(script)}';`);
    expect(csp).not.toMatch(/unsafe|nonce|strict-dynamic|\*/);
    expect(res.headers.get('x-robots-tag')).toBe(path === '/ulaz' ? 'noindex' : null);
  });

  test('uz ugašenu uslugu 502 sa stranicom greške Nexta i CSP-om', async () => {
    const down = await createEdge({ targets: targetsFromEnv({ DUCTURA_EDGE_PRELOADER: nextOrigin, DUCTURA_EDGE_API: 'http://127.0.0.1:9' }) });
    const res = await fetch(`http://127.0.0.1:${await listen(down)}/api/v1/me`);
    expect(res.status).toBe(502);
    const html = await res.text();
    expect(html).toContain(`${errorText.general.title} · Ductura`);
    expect(res.headers.get('content-security-policy')).toContain(`script-src '${sha(inner(html, 'script') ?? '')}';`);
  });
});
