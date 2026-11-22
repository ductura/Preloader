// INT-09: izvještaj sistemskog prolaza (.github/workflows/sistem.yml): tablica PROLAZ/PAD po scenariju,
// SHA svih repoa i vs-run.json. Pad se ne skriva: scenarij koji nije prošao je PAD, a koji nije ni pokrenut
// NIJE POKRENUTO; `sveProlazi` je true samo kad su svi redovi PROLAZ.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain } from '../../scripts/is-main.ts';

export const REPOS = Object.freeze([
  ['Preloader', null],
  ['Aplication_server', 'REF_APLICATION_SERVER'],
  ['Aplication_front', 'REF_APLICATION_FRONT'],
  ['Institution_server', 'REF_INSTITUTION_SERVER'],
  ['Institution_front_web_chrome', 'REF_INSTITUTION_FRONT'],
  ['Institution_web_mobile', 'REF_WEB_MOBILE'],
  ['Web_other', 'REF_WEB_OTHER'],
]);

/** Ishod koraka GitHub Actionsa (`steps.<id>.outcome`) u status scenarija. */
export function statusOf(outcome) {
  if (outcome === 'success') return 'PROLAZ';
  if (outcome === 'failure' || outcome === 'cancelled') return 'PAD';
  return 'NIJE POKRENUTO';
}

/** Redovi iz Playwrightova JSON izvještaja: po jedan za svaki test i projekt (uređaj). */
export function playwrightScenarios(report) {
  const rows = [];
  const walk = (suite, titles) => {
    const here = suite.title && !/\.spec\.[cm]?[jt]s$/.test(suite.title) ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const results = test.results ?? [];
        const last = results[results.length - 1];
        // Ponovljen test (retry) nikad nije čist prolaz; konfiguracija ih ni ne dopušta.
        const ok = test.status === 'expected' && results.length === 1 && last?.status === 'passed';
        const skipped = test.status === 'skipped';
        rows.push({
          id: `A01:${test.projectName}`,
          naziv: [...here, spec.title].join(' › '),
          status: ok ? 'PROLAZ' : skipped ? 'NIJE POKRENUTO' : 'PAD',
          detalj: ok ? '' : String(last?.error?.message ?? test.status).split('\n')[0].slice(0, 300),
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const suite of report?.suites ?? []) walk(suite, []);
  return rows;
}

export function buildRun({ env, repos, playwright, runUrl }) {
  const stack = statusOf(env.STACK_OUTCOME);
  const scenarios = [{ id: 'LOK-2', naziv: 'stog iza edgea :8000 (pnpm sve)', status: stack, detalj: '' }];
  if (playwright) {
    const rows = playwrightScenarios(playwright);
    // Zelen korak bez ijednog testa nije dokaz: prazan izvještaj je PAD.
    if (rows.length === 0) rows.push({ id: 'A01', naziv: 'INT-07 usmjeravanje po uređaju', status: 'PAD', detalj: 'izvještaj nema nijedan test' });
    scenarios.push(...rows);
  } else scenarios.push({ id: 'A01', naziv: 'INT-07 usmjeravanje po uređaju', status: statusOf(env.INT07_OUTCOME), detalj: 'nema JSON izvještaja' });
  scenarios.push({ id: 'A02/A03', naziv: 'INT-06 otvaranje izmišljene ustanove (Aplication_server)', status: statusOf(env.INT06_OUTCOME), detalj: '' });
  return {
    runUrl: runUrl ?? '',
    repoi: repos,
    scenariji: scenarios,
    sveProlazi: scenarios.length > 0 && scenarios.every((s) => s.status === 'PROLAZ'),
  };
}

export function markdown(run) {
  const esc = (v) => String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const lines = [
    '## Sistemski prolaz (INT-09)', '', run.runUrl ? `Run: ${run.runUrl}` : '', '',
    '| Scenarij | Naziv | Ishod | Detalj |', '|---|---|---|---|',
    ...run.scenariji.map((s) => `| ${esc(s.id)} | ${esc(s.naziv)} | ${s.status} | ${esc(s.detalj)} |`),
    '', '| Repo | Grana | SHA |', '|---|---|---|',
    ...run.repoi.map((r) => `| ${r.repo} | ${esc(r.ref)} | \`${r.sha}\` |`), '',
  ];
  return lines.join('\n');
}

export function repoShas(dir, env, git = (cwd) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim()) {
  return REPOS.map(([repo, refVar]) => {
    let sha = 'nepoznato';
    try { sha = git(join(dir, repo)); } catch { /* checkout nije uspio */ }
    return { repo, ref: refVar ? (env[refVar] ?? '') : (env['GITHUB_REF_NAME'] ?? ''), sha };
  });
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (isMain(import.meta.url)) {
  const dir = arg('repos');
  const json = arg('int07');
  const out = arg('out');
  if (!dir || !out) throw new Error('upotreba: izvjestaj.mjs --repos <mapa> [--int07 <json>] --out <vs-run.json> [--summary <datoteka>]');
  let playwright = null;
  if (json && existsSync(json)) {
    try { playwright = JSON.parse(readFileSync(json, 'utf8')); } catch { playwright = null; }
  }
  const run = buildRun({ env: process.env, repos: repoShas(dir, process.env), playwright, runUrl: process.env['RUN_URL'] });
  writeFileSync(out, `${JSON.stringify(run, null, 2)}\n`);
  const text = markdown(run);
  console.log(text);
  const summary = arg('summary');
  if (summary) appendFileSync(summary, `${text}\n`);
}
