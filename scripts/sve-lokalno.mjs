// `pnpm sve`: cijela Ductura lokalno iza jednog podrijetla http://localhost:8000 (ugovor #2028 §1).
// Pokreće preloader (`next dev` na :3100), usluge iz susjednih checkouta i lokalni edge (deploy/edge/dev-proxy.mjs).
// Radi i na Windowsu: bez basha i bez `shell: true`; pnpm se pokreće kroz Node (`npm_execpath`).
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './is-main.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

export const EDGE_ORIGIN = 'http://localhost:8000';
export const OIDC_ISSUER = 'http://localhost:8090';
/** Preloader iz ovog repoa (`pnpm dev`), iza edgea. */
export const PRELOADER_PORT = 3100;

/** Susjedni repozitoriji; ime mape se traži bez obzira na velika i mala slova. */
export const REPOS = Object.freeze(['Aplication_server', 'Aplication_front', 'Institution_server', 'Institution_front_web_chrome']);

/**
 * @typedef {object} Service
 * @property {string} name
 * @property {string} repo
 * @property {string} [subdir] mapa unutar repoa
 * @property {string} script skripta iz package.json
 * @property {number} port
 * @property {Record<string, string>} env
 */

/**
 * Usluge iz ugovora §1 s portovima i okolinom. `token` je zajednička tajna za
 * provisioning (§2): generira se pri svakom pokretanju i nikad se ne ispisuje.
 * @param {string} token
 * @returns {Service[]}
 */
export function services(token) {
  const callback = `${EDGE_ORIGIN}/api/v1/auth/callback`;
  return [
    {
      name: 'aplication-server',
      repo: 'Aplication_server',
      script: 'dev',
      port: 3110,
      env: { PORT: '3110', INSTITUTION_SERVER_URL: 'http://localhost:4000', DUCTURA_PROVISIONING_TOKEN: token },
    },
    {
      name: 'aplication-front',
      repo: 'Aplication_front',
      script: 'dev',
      port: 3120,
      env: { PORT: '3120', APLICATION_SERVER_URL: 'http://localhost:3110', PUBLIC_ORIGIN: EDGE_ORIGIN },
    },
    {
      name: 'institution-server',
      repo: 'Institution_server',
      script: 'dev',
      port: 4000,
      env: {
        PORT: '4000',
        PUBLIC_ORIGIN: EDGE_ORIGIN,
        OIDC_ISSUER,
        OIDC_REDIRECT_URI: callback,
        DUCTURA_PROVISIONING_TOKEN: token,
      },
    },
    {
      name: 'lazni-oidc',
      repo: 'Institution_server',
      subdir: 'packages/test-fakes/oidc',
      script: 'start',
      port: 8090,
      env: {
        PORT: '8090',
        ISSUER: OIDC_ISSUER,
        REDIRECT_URI: callback,
        POST_LOGOUT_REDIRECT_URI: `${EDGE_ORIGIN}/`,
        BACKCHANNEL_LOGOUT_URI: `${EDGE_ORIGIN}/api/v1/auth/backchannel-logout`,
      },
    },
    {
      name: 'front-institucije',
      repo: 'Institution_front_web_chrome',
      script: 'dev',
      port: 5173,
      env: { PORT: '5173' },
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
 */

/**
 * Što se pokreće, a što se preskače i zašto.
 * @param {string} base
 * @param {Service[]} list
 * @returns {Planned[]}
 */
export function plan(base, list) {
  return list.map((service) => {
    const repo = findRepo(base, service.repo);
    if (!repo) return { service, cwd: null, missing: `nema checkouta ${service.repo} u ${base}` };
    const cwd = service.subdir ? join(repo, ...service.subdir.split('/')) : repo;
    const scripts = scriptsIn(cwd);
    if (!scripts) return { service, cwd: null, missing: `nema ${join(cwd, 'package.json')}` };
    if (typeof scripts[service.script] !== 'string') {
      return { service, cwd: null, missing: `${service.repo}${service.subdir ? `/${service.subdir}` : ''} nema skriptu "${service.script}"` };
    }
    return { service, cwd, missing: null };
  });
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

/** Okolina djeteta: roditeljska plus vrijednosti usluge (one imaju prednost). */
export function childEnv(/** @type {Record<string, string | undefined>} */ parent, /** @type {Record<string, string>} */ own) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(parent)) if (typeof v === 'string') out[k] = v;
  // Port i odredišta iz roditeljske okoline ne smiju preteći portove iz ugovora.
  delete out['PORT'];
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

/** Gasi dijete sa svim potomcima (next dev pokreće vlastite procese). */
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

export async function main(env = process.env) {
  const base = reposDir(env);
  const token = env['DUCTURA_PROVISIONING_TOKEN'] || randomBytes(32).toString('base64url');
  if (token.length < 32) throw new Error('DUCTURA_PROVISIONING_TOKEN mora imati najmanje 32 znaka.');
  const planned = plan(base, services(token));

  console.log(`Susjedni checkouti: ${base}`);
  for (const p of planned) {
    console.log(p.missing ? `  - ${p.service.name} (:${p.service.port}) PRESKOČENO: ${p.missing}` : `  + ${p.service.name} (:${p.service.port}) ${p.cwd}`);
  }
  if (!env['DATABASE_URL']) console.log('  ! DATABASE_URL nije postavljen: poslužitelji koriste svoje zadane lokalne baze (PostgreSQL :5432).');

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

  const preloader = pnpmInvocation(env, ['run', 'dev']);
  start('preloader', preloader.command, preloader.args, root, { PORT: String(PRELOADER_PORT) });
  for (const p of planned) {
    if (p.missing || !p.cwd) continue;
    const { command, args } = pnpmInvocation(env, ['run', p.service.script]);
    start(p.service.name, command, args, p.cwd, p.service.env);
  }
  start('edge', process.execPath, [join(root, 'deploy', 'edge', 'dev-proxy.mjs')], root, { DUCTURA_EDGE_PORT: '8000' });

  if (!(await waitForPort(8000, 30_000))) {
    console.error('Edge se nije pokrenuo na :8000.');
    stopAll(1);
    return;
  }
  const running = [{ name: 'preloader', port: PRELOADER_PORT }, ...planned.filter((p) => !p.missing).map((p) => p.service)];
  const ready = await Promise.all(running.map(async (service) => [service, await waitForPort(service.port)]));
  for (const [service, ok] of /** @type {[{ name: string, port: number }, boolean][]} */ (ready)) {
    console.log(`  ${ok ? 'radi' : 'NE ODGOVARA'}  ${service.name} :${service.port}`);
  }
  console.log(`\nDuctura lokalno: ${EDGE_ORIGIN}/\nZaustavljanje: Ctrl+C\n`);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
