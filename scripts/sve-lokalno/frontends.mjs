import { spawn, spawnSync } from 'node:child_process';
import { childEnv, plan, pnpmInvocation, reposDir, waitForPort } from '../sve-lokalno.mjs';

const INSTITUTION_SERVER_URL = 'http://127.0.0.1:4000';
const variants = [
  {
    name: 'web-mobile', repo: 'Institution_web_mobile', script: 'dev',
    listens: [['web-mobile', 5174]], env: { INSTITUTION_SERVER_URL, BASE_PATH: '/app/mobile' },
    target: 'DUCTURA_EDGE_MOBILE',
  },
  {
    name: 'web-other', repo: 'Web_other', script: 'dev',
    listens: [['web-other', 5175]], env: { INSTITUTION_SERVER_URL },
    target: 'DUCTURA_EDGE_OTHER',
  },
];

export function planFrontends(env) {
  const base = reposDir(env);
  return variants.filter(({ target }) => !env[target]).flatMap((variant) =>
    plan(base, [variant]).map((entry) => ({ ...entry, target: variant.target })),
  );
}

export function frontendTargets(planned) {
  return Object.fromEntries(planned.filter((entry) => !entry.missing).map(({ target, service }) => [
    target, `http://localhost:${service.listens[0][1]}`,
  ]));
}

function stop(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}

export async function startFrontends(planned, env) {
  const children = [];
  process.once('exit', () => { for (const child of children) stop(child); });
  // Serijski: mobilni dev prvo gradi radne pakete, a Next kompajlira pri prvom zahtjevu.
  for (const { service, cwd, missing } of planned) {
    const [name, port] = service.listens[0];
    if (missing) {
      console.log(`  - ${name} PRESKOČENO: ${missing}`);
      continue;
    }
    if (await waitForPort(port, 500)) {
      console.error(`[${name}] port :${port} je zauzet.`);
      continue;
    }
    // Checkout ima instalirane ovisnosti; pokretanje dev skripte koristi pnpm pozivatelja.
    const { command, args } = pnpmInvocation(env, [
      '--config.manage-package-manager-versions=false', 'run', service.script, '--port', String(port),
    ]);
    const child = spawn(command, args, {
      cwd, env: childEnv(env, service.env), stdio: ['ignore', 'inherit', 'inherit'],
      detached: process.platform !== 'win32', windowsHide: true,
    });
    children.push(child);
    const ended = new Promise((resolve) => {
      child.once('error', (error) => { console.error(`[${name}] ${error.message}`); resolve(false); });
      child.once('exit', () => resolve(false));
    });
    const ready = await Promise.race([waitForPort(port, 60_000), ended]);
    console.log(`  ${ready ? 'radi' : 'NE ODGOVARA'}  ${name} :${port}`);
  }
}
