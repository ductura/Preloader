// `pnpm sve` (scripts/sve-lokalno.mjs): plan usluga iz ugovora #2028 §1 i pokretanje bez ljuske.
// Cjeloviti test pokreće skriptu nad lažnim checkoutima (mali Node poslužitelji) i ide kroz edge na :8000.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  adminDatabaseUrl,
  ADMIN_PASSWORD_FILE,
  childEnv,
  databaseUrlFor,
  DATABASES,
  ensureAdminPassword,
  findRepo,
  OIDC_ISSUER,
  plan,
  pnpmInvocation,
  REPOS,
  reposDir,
  services,
  waitForLine,
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
  const list = services();
  const by = (name: string) => list.find((s) => s.name === name);

  test('portovi, repozitoriji i skripte', () => {
    expect(list.map((s) => [s.name, s.repo, s.script, s.listens])).toEqual([
      ['aplication-server', 'Aplication_server', 'dev', [['aplication-server', 3110]]],
      ['aplication-front', 'Aplication_front', 'dev', [['aplication-front', 3120]]],
      // `pnpm lokalno` Institution_servera podiže server i lažni OIDC (simulator AAI@EduHr).
      ['institution-server', 'Institution_server', 'lokalno', [['institution-server', 4000], ['lazni-oidc', 8090]]],
      ['front-institucije', 'Institution_front_web_chrome', 'dev', [['front-institucije', 5173]]],
    ]);
    for (const s of list) if (s.script === 'dev') expect(s.env['PORT']).toBe(String(s.listens[0]?.[1]));
  });

  test('Aplication_server: Institution_server, issuer simulatora i vlastita baza', () => {
    expect(OIDC_ISSUER).toBe('http://localhost:8090');
    expect(by('aplication-server')?.env).toMatchObject({ INSTITUTION_SERVER_URL: 'http://127.0.0.1:4000', AAI_OIDC_ISSUER: OIDC_ISSUER });
    expect(by('aplication-server')?.database).toBe('ductura');
    expect(by('institution-server')).toMatchObject({ env: {}, database: 'ductus' });
    expect(DATABASES).toEqual({ institution: 'ductus', aplication: 'ductura' });
  });

  test('front institucije: issuer simulatora za form-action odjave', () => {
    expect(by('front-institucije')?.env).toMatchObject({ INSTITUTION_SERVER_URL: 'http://127.0.0.1:4000', OIDC_ISSUER });
  });

  test('nijedna usluga nema token ni tajnu u planu', () => {
    for (const s of list) expect(Object.keys(s.env)).not.toContain('DUCTURA_PROVISIONING_TOKEN');
  });
});

describe('baza', () => {
  test('superkorisnik samo na ovom računalu; svaka usluga dobiva svoju bazu', () => {
    const admin = adminDatabaseUrl('postgres://postgres:tajna@127.0.0.1:54320/postgres?sslmode=disable&x=1');
    expect(databaseUrlFor(admin, 'ductus')).toBe('postgres://postgres:tajna@127.0.0.1:54320/ductus?sslmode=disable');
    expect(databaseUrlFor(adminDatabaseUrl('postgresql://p@localhost'), 'ductura')).toBe('postgresql://p@localhost/ductura');
    expect(() => adminDatabaseUrl('postgres://p:tajna@db.example.invalid/ductus')).toThrow(/localhost/);
    expect(() => adminDatabaseUrl('mysql://p@localhost/x')).toThrow(/postgres/);
    expect(() => adminDatabaseUrl('postgres://localhost/x')).toThrow(/korisnika/);
    expect(() => adminDatabaseUrl('nije url')).toThrow(/URL/);
    for (const bad of ['postgres://p:tajna@db.example.invalid/ductus']) {
      try {
        adminDatabaseUrl(bad);
      } catch (error) {
        expect(String(error)).not.toContain('tajna');
      }
    }
  });

  test('lozinka administratora: stvara se jednom, 0600, i ostaje', () => {
    const repo = join(base, 'admin-lozinka');
    mkdirSync(repo);
    const first = ensureAdminPassword(repo);
    expect(first.file).toBe(join(repo, ADMIN_PASSWORD_FILE));
    expect(first.password.length).toBeGreaterThanOrEqual(12);
    expect(readFileSync(first.file, 'utf8')).toBe(`${first.password}\n`);
    if (process.platform !== 'win32') expect(statSync(first.file).mode & 0o777).toBe(0o600);
    expect(ensureAdminPassword(repo).password).toBe(first.password);
    writeFileSync(first.file, 'kratko\n');
    expect(ensureAdminPassword(repo).password).not.toBe('kratko');
  });

  test('waitForLine: prvi neprazan redak ili null', async () => {
    const file = join(base, 'redak');
    expect(await waitForLine(file, 300)).toBeNull();
    setTimeout(() => writeFileSync(file, 'abc\nxyz\n'), 100);
    expect(await waitForLine(file, 3000)).toBe('abc');
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
    // Institution_server bez `lokalno` (npr. stara grana sa skriptom dev) se preskače.
    fakeRepo(join(dir, 'Institution_server'), { dev: 'x' });
    mkdirSync(join(dir, 'Institution_front_web_chrome'));
    const result = plan(dir, services());
    expect(result.map((p) => [p.service.name, p.missing === null])).toEqual([
      ['aplication-server', true],
      ['aplication-front', false],
      ['institution-server', false],
      ['front-institucije', false],
    ]);
    expect(result[1]?.missing).toContain('nema skriptu "dev"');
    expect(result[2]?.missing).toContain('nema skriptu "lokalno"');
    expect(result[3]?.missing).toContain('package.json');
    expect(plan(join(base, 'nema'), services())[3]?.missing).toContain('nema checkouta Institution_front_web_chrome');
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

  test('port, baza i tajne iz roditeljske okoline ne prelaze na usluge', () => {
    expect(childEnv({ PORT: '9999', PATH: '/bin', PRAZNO: undefined }, { PORT: '4000' })).toEqual({ PORT: '4000', PATH: '/bin' });
    const parent = { PORT: '9999', DATABASE_URL: 'postgres://p@localhost/x', DUCTURA_PROVISIONING_TOKEN: TOKEN, DUCTURA_ADMIN_TOKEN_SECRET: TOKEN };
    expect(childEnv(parent, {})).toEqual({});
    expect(childEnv(parent, { DATABASE_URL: 'postgres://p@localhost/ductus' })).toEqual({ DATABASE_URL: 'postgres://p@localhost/ductus' });
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
const answer = (name) => (req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ name, url: req.url, host: req.headers.host, issuer: process.env.AAI_OIDC_ISSUER ?? null,
    token: token ? createHash('sha256').update(token).digest('hex') : null, tokenLength: token.length,
    secret: (process.env.DUCTURA_ADMIN_TOKEN_SECRET ?? '').length }));
};
const ports = process.env.LAZNI_PORTOVI ? JSON.parse(process.env.LAZNI_PORTOVI) : [[process.env.LAZNI_NAZIV, Number(process.env.PORT)]];
for (const [name, port] of ports) createServer(answer(name)).listen(port, '127.0.0.1');
`;

// Lažni `pnpm lokalno` Institution_servera: zapiše token u .local/ kao pravi (§2), pa podigne server i OIDC.
const FAKE_LOKALNO = `
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('.local', { recursive: true });
writeFileSync('.local/provisioning-token', ${JSON.stringify(`${TOKEN}
`)});
process.env.LAZNI_PORTOVI = JSON.stringify([['institution-server', 4000], ['lazni-oidc', 8090]]);
process.env.DUCTURA_PROVISIONING_TOKEN = ${JSON.stringify(TOKEN)};
await import('./server.mjs');
`;

describe('pnpm sve nad lažnim checkoutima', () => {
  test('pokreće usluge i edge; /admin, /api/v1 i /app/web stižu do svojih usluga', { timeout: 90_000 }, async () => {
    const dir = join(base, 'sve');
    const fake = (repo: string, name: string, script = 'dev') =>
      fakeRepo(join(dir, repo), { [script]: `node ${script === 'lokalno' ? 'lokalno.mjs' : 'server.mjs'}` }, {
        'server.mjs': `process.env.LAZNI_NAZIV=${JSON.stringify(name)};\n${FAKE_SERVER}`,
        'lokalno.mjs': FAKE_LOKALNO,
      });
    fake('Aplication_server', 'aplication-server');
    fake('Aplication_front', 'aplication-front');
    fake('Institution_server', 'institution-server', 'lokalno');
    fake('institution_front_web_chrome', 'front-institucije');

    // NODE_ENV je u tipovima Nexta obavezan; okolina se i dalje gradi samo od nizova iz process.env.
    const env = {} as NodeJS.ProcessEnv;
    for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v;
    delete env['DUCTURA_PROVISIONING_TOKEN'];
    delete env['DATABASE_URL'];
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
      const admin = await json('/administracija/prijava');
      const api = await json('/api/v1/auth/login?returnTo=%2Fapp%2Fweb%2F');
      const front = await json('/app/web/');
      expect(admin).toMatchObject({ name: 'aplication-front', url: '/administracija/prijava', host: 'localhost:8000' });
      expect(api).toMatchObject({ name: 'institution-server', url: '/api/v1/auth/login?returnTo=%2Fapp%2Fweb%2F', tokenLength: 43 });
      expect(front).toMatchObject({ name: 'front-institucije', url: '/app/web/' });
      // Karta adresa (D-318): `/` je naslovnica fronta institucije, preloader je na `/ulaz`, a nove adrese
      // aplikacije ide na staru osnovu fronta, a administracija doslovno (Aplication_front#24).
      expect(await json('/?izvor=x')).toMatchObject({ name: 'front-institucije', url: '/app/web/naslovnica?izvor=x' });
      expect(await json('/aplikacija/zadaci')).toMatchObject({ name: 'front-institucije', url: '/app/web/zadaci' });
      // Stara adresa administracije: 301 na novu (tablica 301), bez poziva usluge.
      const old = await fetch('http://localhost:8000/admin/prijava?x=1', { redirect: 'manual' });
      expect([old.status, old.headers.get('location')]).toEqual([301, '/administracija/prijava?x=1']);
      const page = await fetch('http://localhost:8000/ulaz');
      expect(await page.text()).toContain('Prijava preko AAI@EduHr');
      // Izgrađen preloader (`next start`) iza edgea: CSP iz hasheva, ne stroga zamjenska politika.
      expect(page.headers.get('content-security-policy')).toMatch(/script-src 'sha256-[A-Za-z0-9+/]{43}='/);
      // Aplication_server dobiva token koji je Institution_server zapisao, issuer simulatora i tajnu kolačića.
      const server = await (await fetch('http://127.0.0.1:3110/')).json();
      expect(server).toMatchObject({ token: api.token, issuer: OIDC_ISSUER, secret: 43 });
      expect(out).toMatch(/radi {2}lazni-oidc :8090/);
      expect(out).toMatch(/Nema baze/);
      expect(out).not.toContain(TOKEN);
    } finally {
      child.kill('SIGTERM');
      await new Promise((resolve) => (child.exitCode !== null ? resolve(null) : child.once('exit', resolve)));
    }
    expect(await waitForPort(8000, 500)).toBe(false);
    expect(await waitForPort(3110, 500)).toBe(false);
  });
});
