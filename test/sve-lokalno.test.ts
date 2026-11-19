// `pnpm sve` (scripts/sve-lokalno.mjs): plan usluga iz ugovora #2028 §1 i pokretanje bez ljuske.
// Cjeloviti test pokreće skriptu nad lažnim checkoutima (mali Node poslužitelji) i ide kroz edge na :8000.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  childEnv,
  EDGE_ORIGIN,
  findRepo,
  OIDC_ISSUER,
  plan,
  pnpmInvocation,
  REPOS,
  reposDir,
  services,
  waitForPort,
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
  const by = (name: string) => list.find((s) => s.name === name);

  test('portovi i repozitoriji', () => {
    expect(list.map((s) => [s.name, s.repo, s.port])).toEqual([
      ['aplication-server', 'Aplication_server', 3110],
      ['aplication-front', 'Aplication_front', 3120],
      ['institution-server', 'Institution_server', 4000],
      ['lazni-oidc', 'Institution_server', 8090],
      ['front-institucije', 'Institution_front_web_chrome', 5173],
    ]);
    for (const s of list) expect(s.env['PORT']).toBe(String(s.port));
  });

  test('isti token provisioninga ide samo na oba poslužitelja (§2)', () => {
    const holders = list.filter((s) => Object.values(s.env).includes(TOKEN)).map((s) => s.name);
    expect(holders).toEqual(['aplication-server', 'institution-server']);
    expect(by('aplication-server')?.env['INSTITUTION_SERVER_URL']).toBe('http://localhost:4000');
  });

  test('OIDC: issuer :8090, povratak preko edgea', () => {
    expect(OIDC_ISSUER).toBe('http://localhost:8090');
    expect(by('institution-server')?.env).toMatchObject({ OIDC_ISSUER, OIDC_REDIRECT_URI: `${EDGE_ORIGIN}/api/v1/auth/callback` });
    expect(by('lazni-oidc')).toMatchObject({ subdir: 'packages/test-fakes/oidc', script: 'start' });
    expect(by('lazni-oidc')?.env).toMatchObject({ ISSUER: OIDC_ISSUER, REDIRECT_URI: `${EDGE_ORIGIN}/api/v1/auth/callback` });
  });
});

describe('susjedni checkouti', () => {
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

  test('plan: što nedostaje preskače se s razlogom', () => {
    const dir = join(base, 'plan');
    fakeRepo(join(dir, 'Aplication_server'), { dev: 'x' });
    fakeRepo(join(dir, 'Aplication_front'), { build: 'x' });
    fakeRepo(join(dir, 'Institution_server'), { dev: 'x' });
    const result = plan(dir, services(TOKEN));
    expect(result.map((p) => [p.service.name, p.missing === null])).toEqual([
      ['aplication-server', true],
      ['aplication-front', false],
      ['institution-server', true],
      ['lazni-oidc', false],
      ['front-institucije', false],
    ]);
    expect(result[1]?.missing).toContain('nema skriptu "dev"');
    expect(result[3]?.missing).toContain('package.json');
    expect(result[4]?.missing).toContain('nema checkouta Institution_front_web_chrome');
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

// Lažna usluga: odgovara imenom, putanjom i SHA-256 tokena provisioninga (sam token se ne vraća).
const FAKE_SERVER = `
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
const token = process.env.DUCTURA_PROVISIONING_TOKEN ?? '';
createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ name: process.env.LAZNI_NAZIV, url: req.url, host: req.headers.host,
    token: token ? createHash('sha256').update(token).digest('hex') : null, tokenLength: token.length }));
}).listen(Number(process.env.PORT), 'localhost');
`;

describe('pnpm sve nad lažnim checkoutima', () => {
  test('pokreće usluge i edge; /admin, /api/v1 i /app/web stižu do svojih usluga', { timeout: 90_000 }, async () => {
    const dir = join(base, 'sve');
    const fake = (repo: string, name: string, script = 'dev', subdir = '') =>
      fakeRepo(join(dir, repo, subdir), { [script]: `node server.mjs` }, { 'server.mjs': `process.env.LAZNI_NAZIV=${JSON.stringify(name)};\n${FAKE_SERVER}` });
    fake('Aplication_server', 'aplication-server');
    fake('Aplication_front', 'aplication-front');
    fake('Institution_server', 'institution-server');
    fake('Institution_server', 'lazni-oidc', 'start', 'packages/test-fakes/oidc');
    fake('institution_front_web_chrome', 'front-institucije');

    // NODE_ENV je u tipovima Nexta obavezan; okolina se i dalje gradi samo od nizova iz process.env.
    const env = {} as NodeJS.ProcessEnv;
    for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v;
    delete env['DUCTURA_PROVISIONING_TOKEN'];
    env['DUCTURA_REPOS'] = dir;
    const child = spawn(process.execPath, [join(root, 'scripts', 'sve-lokalno.mjs')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString()));
    child.stderr.on('data', (c: Buffer) => (out += c.toString()));
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setInterval(() => {
          if (out.includes('Ductura lokalno: http://localhost:8000/')) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
        child.once('exit', (code) => {
          clearInterval(timer);
          reject(new Error(`izašao ${code}: ${out}`));
        });
      });
      const json = async (path: string) => (await fetch(`http://localhost:8000${path}`, { redirect: 'manual' })).json();
      const admin = await json('/admin/prijava');
      const api = await json('/api/v1/auth/login?returnTo=%2Fapp%2Fweb%2F');
      const front = await json('/app/web/');
      expect(admin).toMatchObject({ name: 'aplication-front', url: '/admin/prijava', host: 'localhost:8000' });
      expect(api).toMatchObject({ name: 'institution-server', url: '/api/v1/auth/login?returnTo=%2Fapp%2Fweb%2F', tokenLength: 43 });
      expect(front).toMatchObject({ name: 'front-institucije', url: '/app/web/' });
      const page = await fetch('http://localhost:8000/');
      expect(await page.text()).toContain('Prijava preko AAI@EduHr');
      // Isti token na oba poslužitelja, generiran pri pokretanju i nigdje ispisan.
      const server = await (await fetch('http://localhost:3110/')).json();
      expect(server.token).toBe(api.token);
      expect(out).toMatch(/radi {2}lazni-oidc :8090/);
      expect(out).not.toMatch(/[A-Za-z0-9_-]{43}/);
    } finally {
      child.kill('SIGTERM');
      await new Promise((resolve) => (child.exitCode !== null ? resolve(null) : child.once('exit', resolve)));
    }
    expect(await waitForPort(8000, 500)).toBe(false);
    expect(await waitForPort(3110, 500)).toBe(false);
  });
});
