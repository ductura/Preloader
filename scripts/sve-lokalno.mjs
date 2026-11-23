// `pnpm sve`: cijela Ductura lokalno iza jednog podrijetla http://localhost:8000 (ugovor #2028 §1, LOK-2).
// Izgradi i pokrene preloader (`next build`, `next start` na :3100), usluge iz susjednih checkouta i lokalni edge
// (deploy/edge/dev-proxy.mjs). Preloader nije `next dev`: edge na njegov HTML stavlja CSP iz hasheva, a `next dev`
// dodaje vlastite skripte (docs/LOKALNO.md §3).
//
// Institution_server se pokreće svojim `pnpm lokalno` (migracije, izmišljeni seed, lažni OIDC na :8090 i server
// na :4000). Aplication_server dobiva svoju bazu, migracije, lokalnog administratora platforme i isti token
// provisioninga koji je Institution_server zapisao u svoj `.local/provisioning-token` (§2).
// Radi i na Windowsu: bez basha i bez `shell: true`; pnpm se pokreće kroz Node (`npm_execpath`).
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './is-main.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

export const EDGE_ORIGIN = 'http://localhost:8000';
export const OIDC_ISSUER = 'http://localhost:8090';
/** Preloader iz ovog repoa (`pnpm build`, pa `pnpm start`), iza edgea. */
export const PRELOADER_PORT = 3100;
/** Institution_server sluša samo na 127.0.0.1 (njegov `pnpm lokalno`). */
const INSTITUTION_SERVER_URL = 'http://127.0.0.1:4000';

/** Susjedni repozitoriji; ime mape se traži bez obzira na velika i mala slova. */
export const REPOS = Object.freeze(['Aplication_server', 'Aplication_front', 'Institution_server', 'Institution_front_web_chrome']);

/** Baze na lokalnom PostgreSQL-u: Institution_server dopušta samo `ductus`, Aplication_server ima svoju. */
export const DATABASES = Object.freeze({ institution: 'ductus', aplication: 'ductura' });

/** Lokalni administrator platforme; lozinka se stvara jednom u `.local/` Aplication_servera i nikad ne ispisuje. */
export const ADMIN_USER = 'admin';
export const ADMIN_PASSWORD_FILE = join('.local', 'admin-lozinka');
/** Token provisioninga koji `pnpm lokalno` Institution_servera zapisuje (§2). */
export const TOKEN_FILE = join('.local', 'provisioning-token');

/** PostgreSQL 17 u Dockeru (`pnpm sve --docker`): samo na 127.0.0.1, lozinka je javna i samo lokalna. */
export const DOCKER_PG = Object.freeze({
  container: 'ductura-lokalno-postgres',
  image: 'postgres:17',
  port: 54320,
  password: 'ductura-lokalno-samo',
});

/**
 * @typedef {object} Service
 * @property {string} name
 * @property {string} repo
 * @property {string} script skripta iz package.json
 * @property {[string, number][]} listens ime i port svega što usluga podiže
 * @property {Record<string, string>} env
 * @property {string} [database] baza (DATABASES) koju usluga dobiva u DATABASE_URL
 */

/**
 * Usluge iz ugovora §1 s portovima i okolinom. Token provisioninga i tajne Aplication_servera dodaju se pri
 * pokretanju (`main`), ne ovdje.
 * @returns {Service[]}
 */
export function services() {
  return [
    {
      name: 'aplication-server',
      repo: 'Aplication_server',
      script: 'dev',
      listens: [['aplication-server', 3110]],
      // AAI_OIDC_ISSUER: issuer nove institucije (obrazac ga ne traži); lokalno simulator AAI@EduHr.
      env: { PORT: '3110', INSTITUTION_SERVER_URL, AAI_OIDC_ISSUER: OIDC_ISSUER },
      database: DATABASES.aplication,
    },
    {
      name: 'aplication-front',
      repo: 'Aplication_front',
      script: 'dev',
      listens: [['aplication-front', 3120]],
      env: { PORT: '3120', APLICATION_SERVER_URL: 'http://127.0.0.1:3110', PUBLIC_ORIGIN: EDGE_ORIGIN },
    },
    {
      // `pnpm lokalno` (Institution_server docs/LOKALNO.md) sam postavlja okolinu servera i lažnog OIDC-a
      // (issuer OIDC_ISSUER, povratak na EDGE_ORIGIN/api/v1/auth/callback); iz pozivatelja uzima samo DATABASE_URL.
      name: 'institution-server',
      repo: 'Institution_server',
      script: 'lokalno',
      listens: [
        ['institution-server', 4000],
        ['lazni-oidc', 8090],
      ],
      env: {},
      database: DATABASES.institution,
    },
    {
      name: 'front-institucije',
      repo: 'Institution_front_web_chrome',
      script: 'dev',
      listens: [['front-institucije', 5173]],
      // OIDC_ISSUER: form-action u CSP-u stranice pušta 303 odjave na end_session simulatora;
      // bez njega preglednik zaustavlja odjavu na stranici (INT-20).
      env: { PORT: '5173', INSTITUTION_SERVER_URL, OIDC_ISSUER },
    },
  ];
}

/**
 * Mapa u kojoj su susjedni checkouti: `DUCTURA_REPOS` ili roditelj ovog repoa (`../<Repo>`).
 * @param {Record<string, string | undefined>} env
 */
export function reposDir(env = process.env) {
  return resolve(env['DUCTURA_REPOS'] || join(root, '..'));
}

/**
 * Put do checkouta `repo` u `base`, bez obzira na velika i mala slova; null ako ga nema.
 * @param {string} base
 * @param {string} repo
 */
export function findRepo(base, repo) {
  let names;
  try {
    names = readdirSync(base);
  } catch {
    return null;
  }
  const exact = names.find((n) => n === repo) ?? names.find((n) => n.toLowerCase() === repo.toLowerCase());
  if (!exact) return null;
  const path = join(base, exact);
  return statSync(path).isDirectory() ? path : null;
}

/** Skripte iz package.json u mapi, ili null. */
function scriptsIn(/** @type {string} */ dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return pkg && typeof pkg.scripts === 'object' && pkg.scripts ? pkg.scripts : {};
  } catch {
    return null;
  }
}

/**
 * @typedef {object} Planned
 * @property {Service} service
 * @property {string | null} cwd
 * @property {string | null} missing razlog preskakanja, null kad se pokreće
 * @property {Record<string, string>} scripts skripte checkouta
 */

/**
 * Što se pokreće, a što se preskače i zašto.
 * @param {string} base
 * @param {Service[]} list
 * @returns {Planned[]}
 */
export function plan(base, list) {
  return list.map((service) => {
    const cwd = findRepo(base, service.repo);
    if (!cwd) return { service, cwd: null, missing: `nema checkouta ${service.repo} u ${base}`, scripts: {} };
    const scripts = scriptsIn(cwd);
    if (!scripts) return { service, cwd: null, missing: `nema ${join(cwd, 'package.json')}`, scripts: {} };
    if (typeof scripts[service.script] !== 'string') {
      return { service, cwd: null, missing: `${service.repo} nema skriptu "${service.script}"`, scripts };
    }
    return { service, cwd, missing: null, scripts };
  });
}

/**
 * Adresa superkorisnika lokalnog PostgreSQL-a. Smije biti samo na ovom računalu; baza u adresi se zanemaruje
 * jer svaka usluga dobiva svoju (`databaseUrlFor`). Greška nikad ne ispisuje vrijednost.
 * @param {string} raw
 */
export function adminDatabaseUrl(raw) {
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('DATABASE_URL nije URL.');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') throw new Error('DATABASE_URL nije postgres URL.');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('DATABASE_URL mora biti na localhost, 127.0.0.1 ili [::1].');
  if (!url.username) throw new Error('DATABASE_URL nema korisnika.');
  return url;
}

/** Ista adresa s drugom bazom (i bez upita osim `sslmode`). */
export function databaseUrlFor(/** @type {URL} */ admin, /** @type {string} */ database) {
  const url = new URL(admin.href);
  url.pathname = `/${database}`;
  const sslmode = url.searchParams.get('sslmode');
  url.search = sslmode ? `?sslmode=${encodeURIComponent(sslmode)}` : '';
  return url.href;
}

/**
 * Kako pokrenuti pnpm bez ljuske. Unutar `pnpm sve` pnpm postavlja `npm_execpath`
 * (njegov CLI u JavaScriptu), pa se pokreće kroz Node i na Windowsu.
 * @param {Record<string, string | undefined>} env
 * @param {string[]} args
 */
export function pnpmInvocation(env, args, platform = process.platform, node = process.execPath) {
  const execPath = env['npm_execpath'];
  if (typeof execPath === 'string' && /pnpm/i.test(execPath)) {
    // pnpm.cjs (npm, corepack) ide kroz Node; samostalni pnpm(.exe) pokreće se izravno.
    if (/\.[cm]?js$/i.test(execPath)) return { command: node, args: [execPath, ...args] };
    if (platform !== 'win32' || /\.exe$/i.test(execPath)) return { command: execPath, args };
  }
  if (platform === 'win32') throw new Error('Na Windowsu pokrenite kroz pnpm: pnpm sve');
  return { command: 'pnpm', args };
}

/**
 * Okolina djeteta: roditeljska plus vrijednosti usluge (one imaju prednost). Port, baza i token iz roditeljske
 * okoline se ne prenose: svaka usluga dobiva svoje.
 */
export function childEnv(/** @type {Record<string, string | undefined>} */ parent, /** @type {Record<string, string>} */ own) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(parent)) if (typeof v === 'string') out[k] = v;
  for (const name of ['PORT', 'DATABASE_URL', 'DUCTURA_PROVISIONING_TOKEN', 'DUCTURA_ADMIN_TOKEN_SECRET']) delete out[name];
  return { ...out, ...own };
}

/** Čeka da port prihvaća veze. */
export function waitForPort(/** @type {number} */ port, timeoutMs = 120_000, host = 'localhost') {
  const until = Date.now() + timeoutMs;
  return new Promise((resolveWait) => {
    const attempt = () => {
      const socket = connect({ port, host });
      socket.once('connect', () => {
        socket.destroy();
        resolveWait(true);
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > until) resolveWait(false);
        else setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}

/** Čeka datoteku s barem jednim nepraznim retkom; vraća prvi redak ili null. */
export async function waitForLine(/** @type {string} */ file, timeoutMs = 60_000) {
  for (const until = Date.now() + timeoutMs; ; ) {
    try {
      const line = readFileSync(file, 'utf8').split(/\r?\n/, 1)[0]?.trim();
      if (line) return line;
    } catch {
      // Još ne postoji.
    }
    if (Date.now() > until) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Lozinka lokalnog administratora: stvara se jednom (0600) u `.local/` Aplication_servera. */
export function ensureAdminPassword(/** @type {string} */ repo) {
  const file = join(repo, ADMIN_PASSWORD_FILE);
  const kept = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/, 1)[0]?.trim() : '';
  if (kept && kept.length >= 12) return { file, password: kept };
  mkdirSync(join(repo, '.local'), { recursive: true, mode: 0o700 });
  const password = randomBytes(18).toString('base64url');
  writeFileSync(file, `${password}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return { file, password };
}

/** Ispis djeteta s oznakom usluge, redak po redak. */
function prefixed(/** @type {NodeJS.ReadableStream | null} */ stream, /** @type {string} */ label, /** @type {NodeJS.WriteStream} */ out) {
  if (!stream) return;
  let rest = '';
  stream.setEncoding('utf8');
  stream.on('data', (/** @type {string} */ chunk) => {
    const lines = (rest + chunk).split(/\r?\n/);
    rest = lines.pop() ?? '';
    for (const line of lines) out.write(`[${label}] ${line}\n`);
  });
  stream.on('end', () => {
    if (rest) out.write(`[${label}] ${rest}\n`);
  });
}

/** Gasi dijete sa svim potomcima (next dev i `pnpm lokalno` pokreću vlastite procese). */
function stopTree(/** @type {import('node:child_process').ChildProcess} */ child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}

/** Naredba do kraja, s ispisom pod oznakom; true kad je uspjela. `input` ide na stdin i nikad se ne ispisuje. */
function runStep(/** @type {string} */ label, /** @type {string} */ command, /** @type {string[]} */ args, /** @type {{ cwd: string, env: Record<string, string>, input?: string }} */ options) {
  const result = spawnSync(command, args, { cwd: options.cwd, env: options.env, input: options.input ?? '', encoding: 'utf8', windowsHide: true });
  for (const line of `${result.stdout ?? ''}${result.stderr ?? ''}`.split(/\r?\n/)) if (line) console.log(`[${label}] ${line}`);
  if (result.error) console.error(`[${label}] nije pokrenut: ${result.error.message}`);
  return result.status === 0;
}

/**
 * PostgreSQL 17 u Dockeru za `pnpm sve --docker`: postojeći kontejner se pokreće, inače se stvara. Vraća adresu
 * superkorisnika ili null kad Docker ne radi.
 */
export async function dockerDatabase() {
  const docker = (/** @type {string[]} */ args) => spawnSync('docker', args, { encoding: 'utf8', windowsHide: true });
  const state = docker(['inspect', '-f', '{{.State.Running}}', DOCKER_PG.container]);
  if (state.error) return null;
  let started;
  if (state.status !== 0) {
    started = docker(['run', '-d', '--name', DOCKER_PG.container, '-e', `POSTGRES_PASSWORD=${DOCKER_PG.password}`, '-p', `127.0.0.1:${DOCKER_PG.port}:5432`, DOCKER_PG.image]);
  } else if (state.stdout.trim() !== 'true') {
    started = docker(['start', DOCKER_PG.container]);
  }
  if (started && started.status !== 0) {
    console.error(`Docker: ${started.stderr.trim()}`);
    return null;
  }
  // Prvo pokretanje slike sluša samo na socketu dok ne završi inicijalizaciju; spremna je kad odgovara na TCP-u.
  for (const until = Date.now() + 90_000; Date.now() < until; ) {
    if (docker(['exec', DOCKER_PG.container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).status === 0) {
      return `postgres://postgres:${DOCKER_PG.password}@127.0.0.1:${DOCKER_PG.port}/postgres`;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error(`Docker: ${DOCKER_PG.container} nije spreman u 90 s.`);
  return null;
}

// Stvara bazu Aplication_servera njegovim `pg` paketom (preloader nema klijenta PostgreSQL-a).
const CREATE_DATABASE = `
import pg from 'pg';
const url = new URL(process.env.SVE_ADMIN_URL);
const name = process.env.SVE_DATABASE;
url.pathname = '/postgres';
const client = new pg.Client({ connectionString: url.href });
await client.connect();
const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
if (rowCount === 0) await client.query('CREATE DATABASE ' + JSON.stringify(name));
console.log(rowCount === 0 ? 'baza ' + name + ' je stvorena' : 'baza ' + name + ' postoji');
await client.end();
`;

/**
 * Baza, migracije i administrator Aplication_servera prije pokretanja. Vraća okolinu za `pnpm dev`, ili null
 * kad priprema nije uspjela (tada se usluga ipak pokreće, bez baze).
 * @param {Planned} p
 * @param {URL} admin
 * @param {Record<string, string | undefined>} env
 */
function prepareAplicationServer(p, admin, env) {
  if (!p.cwd || !p.service.database) return null;
  const url = databaseUrlFor(admin, p.service.database);
  const base = childEnv(env, { DATABASE_URL: url });
  const label = p.service.name;
  const created = runStep(label, process.execPath, ['--input-type=module', '-e', CREATE_DATABASE], {
    cwd: p.cwd,
    env: { ...base, SVE_ADMIN_URL: admin.href, SVE_DATABASE: p.service.database },
  });
  if (!created) return null;
  if (typeof p.scripts['db:migrate'] === 'string') {
    const migrate = pnpmInvocation(env, ['run', '--silent', 'db:migrate']);
    if (!runStep(label, migrate.command, migrate.args, { cwd: p.cwd, env: base })) return null;
  }
  if (typeof p.scripts['admin:stvori'] === 'string') {
    const { password } = ensureAdminPassword(p.cwd);
    const create = pnpmInvocation(env, ['run', '--silent', 'admin:stvori', ADMIN_USER, '--zamijeni']);
    if (!runStep(label, create.command, create.args, { cwd: p.cwd, env: base, input: `${password}\n` })) return null;
  }
  return { DATABASE_URL: url };
}

export async function main(env = process.env, argv = process.argv.slice(2)) {
  const unknown = argv.filter((a) => a !== '--docker');
  if (unknown.length > 0) throw new Error('upotreba: pnpm sve [--docker]');
  const base = reposDir(env);
  const planned = plan(base, services());

  console.log(`Susjedni checkouti: ${base}`);
  for (const p of planned) {
    const ports = p.service.listens.map(([, port]) => `:${port}`).join(', ');
    console.log(p.missing ? `  - ${p.service.name} (${ports}) PRESKOČENO: ${p.missing}` : `  + ${p.service.name} (${ports}) ${p.cwd}`);
  }

  /** @type {URL | null} */
  let admin = null;
  if (env['DATABASE_URL']) admin = adminDatabaseUrl(env['DATABASE_URL']);
  else if (argv.includes('--docker')) {
    console.log(`Pokrećem ${DOCKER_PG.image} u Dockeru (${DOCKER_PG.container}, 127.0.0.1:${DOCKER_PG.port}) ...`);
    const url = await dockerDatabase();
    if (!url) throw new Error('PostgreSQL u Dockeru nije pokrenut. Postavite DATABASE_URL ili pokrenite Docker.');
    admin = new URL(url);
  }
  if (!admin) console.log('  ! Nema baze (DATABASE_URL ni --docker): Institution_server i Aplication_server neće raditi. Vidi docs/LOKALNO.md §1.');

  console.log('Gradim preloader (next build) ...');
  const build = pnpmInvocation(env, ['run', 'build']);
  const built = spawnSync(build.command, build.args, { cwd: root, env: childEnv(env, {}), stdio: 'inherit', windowsHide: true });
  if (built.status !== 0) throw new Error('Izgradnja preloadera nije uspjela.');

  /** @type {Map<string, Record<string, string>>} okolina usluge osim `service.env` */
  const extra = new Map();
  const aplicationServer = planned.find((p) => p.service.name === 'aplication-server' && !p.missing);
  if (aplicationServer && admin) {
    console.log('Pripremam Aplication_server (baza, migracije, administrator platforme) ...');
    const prepared = prepareAplicationServer(aplicationServer, admin, env);
    if (!prepared) console.error('[aplication-server] priprema nije uspjela; pokrećem ga bez baze.');
    extra.set('aplication-server', prepared ?? {});
  }
  // Tajna za kolačić administratora (najmanje 32 znaka): nova pri svakom pokretanju, nigdje se ne ispisuje.
  extra.set('aplication-server', { ...extra.get('aplication-server'), DUCTURA_ADMIN_TOKEN_SECRET: randomBytes(32).toString('base64url') });
  if (admin) extra.set('institution-server', { DATABASE_URL: databaseUrlFor(admin, DATABASES.institution) });

  /** @type {import('node:child_process').ChildProcess[]} */
  const children = [];
  let stopping = false;
  const stopAll = (/** @type {number} */ code) => {
    if (stopping) return;
    stopping = true;
    for (const child of children) stopTree(child);
    setTimeout(() => process.exit(code), 500).unref();
  };
  process.once('SIGINT', () => stopAll(130));
  process.once('SIGTERM', () => stopAll(143));

  /** @param {string} label @param {string} command @param {string[]} args @param {string} cwd @param {Record<string, string>} own */
  const start = (label, command, args, cwd, own) => {
    const child = spawn(command, args, {
      cwd,
      env: childEnv(env, own),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // Vlastita grupa procesa na POSIX-u, da se može ugasiti cijelo stablo.
      detached: process.platform !== 'win32',
    });
    children.push(child);
    prefixed(child.stdout, label, process.stdout);
    prefixed(child.stderr, label, process.stderr);
    child.once('error', (error) => console.error(`[${label}] nije pokrenut: ${error.message}`));
    child.once('exit', (code, signal) => {
      if (!stopping) console.error(`[${label}] završio (${signal ?? code}).`);
      if (label === 'edge') stopAll(code ?? 1);
    });
    return child;
  };
  const startService = (/** @type {Planned} */ p) => {
    if (p.missing || !p.cwd) return;
    const { command, args } = pnpmInvocation(env, ['run', p.service.script]);
    start(p.service.name, command, args, p.cwd, { ...p.service.env, ...extra.get(p.service.name) });
  };

  const preloader = pnpmInvocation(env, ['run', 'start']);
  start('preloader', preloader.command, preloader.args, root, { PORT: String(PRELOADER_PORT) });
  for (const p of planned) if (p.service.name !== 'aplication-server') startService(p);
  start('edge', process.execPath, [join(root, 'deploy', 'edge', 'dev-proxy.mjs')], root, { DUCTURA_EDGE_PORT: '8000' });

  // Aplication_server čeka token koji `pnpm lokalno` Institution_servera zapisuje na početku (§2).
  if (aplicationServer) {
    const institution = planned.find((p) => p.service.name === 'institution-server' && !p.missing);
    const token = institution?.cwd ? await waitForLine(join(institution.cwd, TOKEN_FILE), 60_000) : null;
    if (token && token.length >= 32) extra.set('aplication-server', { ...extra.get('aplication-server'), DUCTURA_PROVISIONING_TOKEN: token });
    else console.error(`[aplication-server] nema tokena provisioninga (${TOKEN_FILE} Institution_servera): dodavanje institucije neće stići do Institution_servera.`);
    if (!stopping) startService(aplicationServer);
  }

  if (!(await waitForPort(8000, 30_000))) {
    console.error('Edge se nije pokrenuo na :8000.');
    stopAll(1);
    return;
  }
  /** @type {[string, number][]} */
  const running = [['preloader', PRELOADER_PORT], ...planned.filter((p) => !p.missing).flatMap((p) => p.service.listens)];
  // Institution_server prije slušanja primijeni migracije i izgradi se, pa se čeka dulje.
  const ready = await Promise.all(running.map(async ([name, port]) => /** @type {const} */ ([name, port, await waitForPort(port, 300_000)])));
  for (const [name, port, ok] of ready) console.log(`  ${ok ? 'radi' : 'NE ODGOVARA'}  ${name} :${port}`);
  if (aplicationServer && admin) console.log(`\nAdministracija: ${EDGE_ORIGIN}/admin/prijava, korisnik "${ADMIN_USER}", lozinka u ${join(aplicationServer.cwd ?? '', ADMIN_PASSWORD_FILE)}`);
  console.log(`\nDuctura lokalno: ${EDGE_ORIGIN}/\nZaustavljanje: Ctrl+C\n`);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
