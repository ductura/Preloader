// `pnpm sve`: cijela Ductura lokalno iza jednog podrijetla http://localhost:8000 (ugovor #2028 §1).
// Pokreće preloader (`next dev` na :3100), usluge iz susjednih checkouta i lokalni edge (deploy/edge/dev-proxy.mjs).
// Radi i na Windowsu: bez basha i bez `shell: true`; pnpm se pokreće kroz Node (`npm_execpath`).
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
 * Institution_serverov pnpm lokalno jedini pokreće OIDC i postavlja APP_*.
 * Njegov spremljeni token zatim dobiva samo Aplication_server.
 * @param {string} token
 * @returns {Service[]}
 */
export function services(token) {
  return [
    { name: 'institution-server', repo: 'Institution_server', script: 'lokalno', port: 4000, env: { PORT: '4000' } },
    {
      name: 'aplication-server', repo: 'Aplication_server', script: 'dev', port: 3110,
      env: { PORT: '3110', INSTITUTION_SERVER_URL: 'http://localhost:4000', DUCTURA_PROVISIONING_TOKEN: token },
    },
    {
      name: 'aplication-front', repo: 'Aplication_front', script: 'dev', port: 3120,
      env: { PORT: '3120', APLICATION_SERVER_URL: 'http://localhost:3110', PUBLIC_ORIGIN: EDGE_ORIGIN },
    },
    { name: 'front-institucije', repo: 'Institution_front_web_chrome', script: 'dev', port: 5173, env: { PORT: '5173' } },
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
 * @property {string | null} missing razlog preflight pogreške
 */

/**
 * Provjera svih obveznih checkouta i skripti prije pokretanja ijednog procesa.
 * @param {string} base
 * @param {Service[]} list
 * @returns {Planned[]}
 */
export function plan(base, list) {
  const planned = list.map((service) => {
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
  const missing = planned.filter((p) => p.missing).map((p) => `${p.service.name}: ${p.missing}`);
  if (missing.length) throw new Error(`Preflight: nedostaju obvezne usluge:\n${missing.join('\n')}`);
  return planned;
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
  // Zajedničku tajnu ne nasljeđuju frontovi ni edge.
  delete out['DUCTURA_PROVISIONING_TOKEN'];
  delete out['DATABASE_URL'];
  delete out['APP_DATABASE_URL'];
  delete out['AUTH_DATABASE_URL'];
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

/** Token priprema Institution_server; poruke nikad ne sadrže njegovu vrijednost. */
export function provisioningToken(/** @type {string} */ repo, /** @type {string | undefined} */ configured) {
  let token;
  try { token = readFileSync(join(repo, '.local', 'provisioning-token'), 'utf8').trim(); }
  catch { throw new Error('Institution_server nije pripremio .local/provisioning-token.'); }
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new Error('Nevaljan lokalni provisioning token.');
  if (configured !== undefined && configured !== token)
    throw new Error('DUCTURA_PROVISIONING_TOKEN se razlikuje od tokena Institution_servera.');
  return token;
}

/** TCP listener nije dokaz da HTTP usluga radi. Preusmjeravanje nije uspjeh probe. */
export async function waitForHttp(/** @type {string} */ url, timeoutMs = 120_000, /** @type {AbortSignal | undefined} */ signal = undefined) {
  const until = Date.now() + timeoutMs;
  do {
    if (signal?.aborted) return false;
    try {
      const timeout = AbortSignal.timeout(Math.max(1, Math.min(2000, until - Date.now())));
      const response = await fetch(url, { redirect: 'manual', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      const ok = response.status === 200;
      await response.body?.cancel();
      if (ok) return true;
    } catch { /* Usluga se možda još podiže. */ }
    if (Date.now() >= until) return false;
    await new Promise((done) => setTimeout(done, Math.min(500, until - Date.now())));
  } while (Date.now() < until);
  return false;
}

export async function main(env = process.env) {
  if (!['', 'development', 'test'].includes(env['NODE_ENV'] ?? ''))
    throw new Error('pnpm sve dopušten je samo za lokalni development/test.');
  const base = reposDir(env);
  const planned = plan(base, services(''));
  const institution = planned.find((p) => p.service.name === 'institution-server');
  if (!institution?.cwd) throw new Error('Preflight: nema Institution_servera.');
  for (const port of [8000, PRELOADER_PORT, 8090, ...planned.map((p) => p.service.port)]) {
    if (await waitForPort(port, 0)) throw new Error(`Preflight: port :${port} je zauzet; postojeći proces nije mijenjan.`);
  }
  console.log(`Susjedni checkouti: ${base}`);
  for (const p of planned) console.log(`  + ${p.service.name} (:${p.service.port}) ${p.cwd}`);

  /** @type {import('node:child_process').ChildProcess[]} */
  const children = [];
  const lifetime = new AbortController();
  let stopping = false;
  const stopAll = (/** @type {number} */ code) => {
    if (stopping) return;
    stopping = true;
    lifetime.abort();
    for (const child of children) stopTree(child);
    setTimeout(() => process.exit(code), 500);
  };
  process.once('SIGINT', () => stopAll(130));
  process.once('SIGTERM', () => stopAll(143));

  /** @param {string} label @param {string} command @param {string[]} args @param {string} cwd @param {Record<string, string>} own */
  const start = (label, command, args, cwd, own) => {
    if (stopping) throw new Error('Pokretanje je prekinuto.');
    const child = spawn(command, args, {
      cwd, env: childEnv(env, own), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      detached: process.platform !== 'win32',
    });
    children.push(child);
    prefixed(child.stdout, label, process.stdout);
    prefixed(child.stderr, label, process.stderr);
    child.once('error', () => {
      console.error(`[${label}] nije pokrenut.`);
      stopAll(1);
    });
    child.once('exit', (code, signal) => {
      if (!stopping) {
        console.error(`[${label}] završio (${signal ?? code}); zaustavljam stog.`);
        stopAll(1);
      }
    });
  };
  /** @param {Planned} p @param {string} token */
  const startService = (p, token) => {
    if (!p.cwd) throw new Error(`Preflight: nema ${p.service.name}.`);
    const invocation = pnpmInvocation(env, ['run', p.service.script]);
    const own = { ...p.service.env };
    if (p.service.name === 'aplication-server') own['DUCTURA_PROVISIONING_TOKEN'] = token;
    if (p.service.name === 'institution-server' && typeof env['DATABASE_URL'] === 'string')
      own['DATABASE_URL'] = env['DATABASE_URL'];
    start(p.service.name, invocation.command, invocation.args, p.cwd, own);
  };
  /** @param {string} name @param {string} url */
  const ready = async (name, url) => {
    if (!(await waitForHttp(url, 120_000, lifetime.signal)) || stopping)
      throw new Error(`${name} ne odgovara ispravnim HTTP odgovorom: ${url}`);
    console.log(`  radi  ${name} ${url}`);
  };

  try {
    // Server priprema lokalnu bazu, APP_* i trajnu tajnu te posjeduje jedini OIDC.
    startService(institution, '');
    await ready('institution-server', 'http://localhost:4000/api/v1/health');
    await ready('lazni-oidc', `${OIDC_ISSUER}/.well-known/openid-configuration`);
    const token = provisioningToken(institution.cwd, env['DUCTURA_PROVISIONING_TOKEN']);
    const preloader = pnpmInvocation(env, ['run', 'dev']);
    start('preloader', preloader.command, preloader.args, root, { PORT: String(PRELOADER_PORT) });
    for (const p of planned) if (p !== institution) startService(p, token);
    start('edge', process.execPath, [join(root, 'deploy', 'edge', 'dev-proxy.mjs')], root, {
      DUCTURA_EDGE_PORT: '8000', DUCTURA_EDGE_HOST: 'localhost',
      DUCTURA_EDGE_PRELOADER: `http://localhost:${PRELOADER_PORT}`,
      DUCTURA_EDGE_ADMIN: 'http://localhost:3120',
      DUCTURA_EDGE_API: 'http://localhost:4000',
      DUCTURA_EDGE_FRONT: 'http://localhost:5173',
    });
    await Promise.all([
      ready('preloader', `http://localhost:${PRELOADER_PORT}/`),
      ready('aplication-server', 'http://localhost:3110/api/health'),
      ready('aplication-front', 'http://localhost:3120/admin/prijava'),
      ready('front-institucije', 'http://localhost:5173/app/web/'),
      ready('edge', `${EDGE_ORIGIN}/`),
    ]);
    if (!stopping) console.log(`\nDuctura lokalno: ${EDGE_ORIGIN}/\nZaustavljanje: Ctrl+C\n`);
  } catch (error) {
    if (!stopping) console.error(error instanceof Error ? error.message : 'Pokretanje nije uspjelo.');
    stopAll(1);
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
