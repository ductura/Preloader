// `pnpm sve` (scripts/sve-lokalno.mjs): plan usluga iz ugovora #2028 §1 i pokretanje bez ljuske.
// Cjeloviti test pokreće skriptu nad lažnim checkoutima (mali Node poslužitelji) i ide kroz edge na :8000.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  childEnv,
  EDGE_ORIGIN,
  findRepo,
  OIDC_ISSUER,
  plan,
  pnpmInvocation,
  provisioningToken,
  REPOS,
  reposDir,
  services,
  waitForPort,
  waitForHttp,
} from '../scripts/sve-lokalno.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const TOKEN = 't'.repeat(43);

let base: string;
beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'sve-'));
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

function fakeRepo(dir: string, scripts: Record<string, string>, files: Record<string, string> = {}): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'lazni', private: true, scripts }));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
}

describe('usluge iz ugovora §1', () => {
  const list = services(TOKEN);
  test('stvarna skripta servera posjeduje jedini OIDC', () => {
    expect(list.map((s) => [s.name, s.repo, s.script, s.port])).toEqual([
      ['institution-server', 'Institution_server', 'lokalno', 4000],
      ['aplication-server', 'Aplication_server', 'dev', 3110],
      ['aplication-front', 'Aplication_front', 'dev', 3120],
      ['front-institucije', 'Institution_front_web_chrome', 'dev', 5173],
    ]);
    expect(OIDC_ISSUER).toBe('http://localhost:8090');
    for (const service of list) expect(service.env['PORT']).toBe(String(service.port));
  });
  test('spremljeni serverski token prenosi se samo aplikacijskom serveru', () => {
    expect(list.filter((s) => Object.values(s.env).includes(TOKEN)).map((s) => s.name)).toEqual(['aplication-server']);
    expect(list.find((s) => s.name === 'aplication-server')?.env['INSTITUTION_SERVER_URL']).toBe('http://localhost:4000');
    expect(childEnv({ DUCTURA_PROVISIONING_TOKEN: TOKEN, DATABASE_URL: 'admin-db', APP_DATABASE_URL: 'app-db', AUTH_DATABASE_URL: 'auth-db' }, {})).toEqual({});
    expect(childEnv({ DATABASE_URL: 'admin-db' }, { DATABASE_URL: 'owned-db' })).toEqual({ DATABASE_URL: 'owned-db' });
  });
});

describe('susjedni checkouti', () => {
  test('obvezna usluga koja nedostaje prekida plan prije pokretanja', () => {
    const dir = join(base, 'obvezna-nedostaje');
    fakeRepo(join(dir, 'Aplication_server'), { dev: 'x' });
    expect(() => plan(dir, services(TOKEN))).toThrow(/Preflight.*Institution_server/s);
  });

  test('zadano je roditelj ovog repoa, DUCTURA_REPOS ga mijenja', () => {
    expect(reposDir({})).toBe(join(root, '..'));
    expect(reposDir({ DUCTURA_REPOS: base })).toBe(base);
  });

  test('ime mape bez obzira na velika i mala slova; datoteka nije checkout', () => {
    const dir = join(base, 'imena');
    mkdirSync(join(dir, 'aplication_server'), { recursive: true });
    writeFileSync(join(dir, 'Aplication_front'), '');
    expect(findRepo(dir, 'Aplication_server')).toBe(join(dir, 'aplication_server'));
    expect(findRepo(dir, 'Aplication_front')).toBeNull();
    expect(findRepo(join(base, 'nema'), 'Aplication_server')).toBeNull();
  });

  test('preflight navodi nedostajuće skripte i checkoute zajedno', () => {
    const dir = join(base, 'plan');
    fakeRepo(join(dir, 'Aplication_server'), { dev: 'x' });
    fakeRepo(join(dir, 'Aplication_front'), { build: 'x' });
    fakeRepo(join(dir, 'Institution_server'), { dev: 'x' });
    expect(() => plan(dir, services(TOKEN))).toThrow(/Institution_server nema skriptu "lokalno"/);
    expect(() => plan(dir, services(TOKEN))).toThrow(/Aplication_front nema skriptu "dev"/);
    expect(() => plan(dir, services(TOKEN))).toThrow(/nema checkouta Institution_front_web_chrome/);
    expect(REPOS).toHaveLength(4);
  });

});

describe('pokretanje bez ljuske (Windows)', () => {
  test('pnpm iz npm_execpath ide kroz Node', () => {
    expect(pnpmInvocation({ npm_execpath: 'C:\\pnpm\\bin\\pnpm.cjs' }, ['run', 'dev'], 'win32', 'C:\\node.exe')).toEqual({
      command: 'C:\\node.exe',
      args: ['C:\\pnpm\\bin\\pnpm.cjs', 'run', 'dev'],
    });
  });

  test('samostalni pnpm.exe pokreće se izravno', () => {
    expect(pnpmInvocation({ npm_execpath: 'C:\\pnpm\\pnpm.exe' }, ['run', 'dev'], 'win32')).toEqual({
      command: 'C:\\pnpm\\pnpm.exe',
      args: ['run', 'dev'],
    });
  });

  test('na Windowsu bez pnpm-a traži `pnpm sve`, na POSIX-u zove pnpm iz PATH-a', () => {
    expect(() => pnpmInvocation({}, ['run', 'dev'], 'win32')).toThrow(/pnpm sve/);
    expect(() => pnpmInvocation({ npm_execpath: 'C:\\npm\\npm-cli.js' }, ['run', 'dev'], 'win32')).toThrow(/pnpm sve/);
    expect(pnpmInvocation({}, ['run', 'dev'], 'linux')).toEqual({ command: 'pnpm', args: ['run', 'dev'] });
  });

  test('port iz roditeljske okoline ne preteče ugovor', () => {
    expect(childEnv({ PORT: '9999', PATH: '/bin', PRAZNO: undefined }, { PORT: '4000' })).toEqual({ PORT: '4000', PATH: '/bin' });
    expect(childEnv({ PORT: '9999' }, {})).toEqual({});
  });

  test('waitForPort: otvoren i zatvoren port', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    expect(await waitForPort(port, 2000, '127.0.0.1')).toBe(true);
    await new Promise((resolve) => server.close(resolve));
    expect(await waitForPort(port, 600, '127.0.0.1')).toBe(false);
  });
});

describe('provjera spremnosti i zajedničke tajne', () => {
  test('otvoreni HTTP port s 503 ili preusmjeravanjem nije spreman', async () => {
    let status = 503;
    const server = createHttpServer((_req, res) => {
      res.statusCode = status;
      if (status === 302) res.setHeader('location', '/');
      res.end();
    });
    await new Promise<void>((done) => server.listen(0, 'localhost', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('nema porta');
    const url = `http://localhost:${address.port}/`;
    try {
      expect(await waitForHttp(url, 200)).toBe(false);
      status = 302;
      expect(await waitForHttp(url, 200)).toBe(false);
      status = 200;
      expect(await waitForHttp(url, 200)).toBe(true);
      expect(await waitForHttp(url, 200, AbortSignal.abort())).toBe(false);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  test('čita trajni token, odbija nedostajući, nevaljani i neusklađeni token bez ispisa tajne', () => {
    const repo = join(base, 'token');
    mkdirSync(join(repo, '.local'), { recursive: true });
    expect(() => provisioningToken(repo, undefined)).toThrow('nije pripremio');
    writeFileSync(join(repo, '.local/provisioning-token'), `see-this-secret\n`);
    expect(() => provisioningToken(repo, undefined)).toThrow('Nevaljan lokalni provisioning token.');
    writeFileSync(join(repo, '.local/provisioning-token'), `${TOKEN}\n`);
    expect(provisioningToken(repo, undefined)).toBe(TOKEN);
    expect(provisioningToken(repo, TOKEN)).toBe(TOKEN);
    expect(() => provisioningToken(repo, 'other-secret')).toThrow('razlikuje od tokena Institution_servera');
  });
});

// Cijeli launcher i pravi Next/edge, ali sintetički susjedni servisi bez baze.
const FAKE_SERVER = `
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
const token = process.env.DUCTURA_PROVISIONING_TOKEN ?? '';
createServer((req, res) => {
  if (req.url === '/__exit') { res.end('stopping'); setTimeout(() => process.exit(0), 50); return; }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ name: process.env.LAZNI_NAZIV, url: req.url, host: req.headers.host,
    token: token ? createHash('sha256').update(token).digest('hex') : null, tokenLength: token.length }));
}).listen(Number(process.env.PORT), 'localhost');
`;

function syntheticStack(name: string): string {
  const dir = join(base, name);
  for (const service of services(TOKEN)) {
    const institution = service.name === 'institution-server';
    const setup = institution ? `
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('.local', { recursive: true });
writeFileSync('.local/provisioning-token', ${JSON.stringify(TOKEN)});
process.env.DUCTURA_PROVISIONING_TOKEN = ${JSON.stringify(TOKEN)};
` : '';
    const oidc = institution ? `
createServer((_req, res) => res.end('{}')).listen(8090, 'localhost');
` : '';
    fakeRepo(join(dir, service.repo), { [service.script]: 'node server.mjs' }, {
      'server.mjs': `process.env.LAZNI_NAZIV=${JSON.stringify(service.name)};\n${setup}${FAKE_SERVER}${oidc}`,
    });
  }
  return dir;
}

function launch(dir: string) {
  const child = spawn(process.execPath, [join(root, 'scripts/sve-lokalno.mjs')], {
    cwd: root, detached: process.platform !== 'win32',
    env: { ...process.env, NODE_ENV: 'development', DUCTURA_REPOS: dir, DUCTURA_PROVISIONING_TOKEN: TOKEN,
      DUCTURA_EDGE_API: 'http://localhost:9' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (part: Buffer) => (out += part.toString()));
  child.stderr.on('data', (part: Buffer) => (out += part.toString()));
  const exited = new Promise<number | null>((done) => child.once('exit', done));
  return { child, exited, output: () => out };
}

async function stopOwn(stack: ReturnType<typeof launch>): Promise<void> {
  const { child } = stack;
  if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGTERM');
  }
  await stack.exited;
}

describe('pnpm sve nad sintetičkim checkoutima', () => {
  test('nedostajući checkout prekida CLI prije pokretanja procesa', { timeout: 10_000 }, async () => {
    const stack = launch(join(base, 'missing'));
    try {
      expect(await stack.exited).toBe(1);
      expect(stack.output()).toMatch(/Preflight.*Institution_server/s);
      expect(stack.output()).not.toContain('[preloader]');
      expect(stack.output()).not.toContain('Ductura lokalno:');
    } finally { await stopOwn(stack); }
  });

  test('zauzeti port prekida CLI i ostavlja postojeći proces netaknut', { timeout: 10_000 }, async () => {
    const listener = createServer();
    await new Promise<void>((done) => listener.listen(8000, 'localhost', done));
    const stack = launch(syntheticStack('occupied'));
    try {
      expect(await stack.exited).toBe(1);
      expect(stack.output()).toContain('port :8000 je zauzet');
      expect(await waitForPort(8000, 100)).toBe(true);
      expect(stack.output()).not.toContain('[institution-server]');
    } finally {
      await stopOwn(stack);
      await new Promise<void>((done) => listener.close(() => done()));
    }
  });

  test('rani završetak obveznog servera prekida stog bez poruke o uspjehu', { timeout: 15_000 }, async () => {
    const dir = syntheticStack('early-exit');
    writeFileSync(join(dir, 'Institution_server/server.mjs'), 'process.exit(0);');
    const stack = launch(dir);
    try {
      expect(await stack.exited).toBe(1);
      expect(stack.output()).toContain('[institution-server] završio');
      expect(stack.output()).not.toContain('Ductura lokalno:');
      expect(stack.output()).not.toContain('[preloader]');
    } finally { await stopOwn(stack); }
  });

  test('pokreće jedan OIDC, dijeli token i gasi stog nakon pada obvezne usluge', { timeout: 90_000 }, async () => {
    const stack = launch(syntheticStack('ready'));
    try {
      const until = Date.now() + 60_000;
      while (!stack.output().includes('Ductura lokalno: http://localhost:8000/')) {
        if (stack.child.exitCode !== null || Date.now() > until) throw new Error(stack.output());
        await new Promise((done) => setTimeout(done, 100));
      }
      const json = async (path: string) => (await fetch(`http://localhost:8000${path}`, { redirect: 'manual' })).json();
      const admin = await json('/admin/prijava');
      const api = await json('/api/v1/auth/login?returnTo=%2Fapp%2Fweb%2F');
      const front = await json('/app/web/');
      expect(admin).toMatchObject({ name: 'aplication-front', url: '/admin/prijava', host: 'localhost:8000', tokenLength: 0 });
      expect(api).toMatchObject({ name: 'institution-server', url: '/api/v1/auth/login?returnTo=%2Fapp%2Fweb%2F', tokenLength: 43 });
      expect(front).toMatchObject({ name: 'front-institucije', url: '/app/web/', tokenLength: 0 });
      expect(await (await fetch(EDGE_ORIGIN)).text()).toContain('Prijava preko AAI@EduHr');
      const platform = await (await fetch('http://localhost:3110/')).json();
      expect(platform.token).toBe(api.token);
      expect(stack.output()).toContain('radi  lazni-oidc');
      expect(stack.output()).not.toContain(TOKEN);
      await fetch('http://localhost:3110/__exit');
      expect(await stack.exited).toBe(1);
      expect(stack.output()).toContain('[aplication-server] završio');
      for (const port of [8000, 3100, 3110, 3120, 4000, 5173, 8090])
        expect(await waitForPort(port, 100), `port ${port} ostao je otvoren`).toBe(false);
    } finally { await stopOwn(stack); }
  });
});
