// Proračun veličine: gzip veličina svake stranice i zbroj. Prekoračenje ruši CI (izlazni kod 1).
// Mapa datoteka (stari `dist`) mjeri svaku datoteku; izgradnja Nexta (`.next`) mjeri stranicu sa svime što učita.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, normalize, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { isMain } from './is-main.ts';

export interface Budget {
  total: number;
  files: Record<string, number>;
}

const isLimit = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

export function parseBudget(text: string): Budget {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('budget must be an object');
  const { total, files, ...rest } = raw as Record<string, unknown>;
  if (Object.keys(rest).length > 0) throw new Error(`unknown budget fields: ${Object.keys(rest).join(', ')}`);
  if (!isLimit(total)) throw new Error('budget.total must be a non-negative integer');
  if (typeof files !== 'object' || files === null || Array.isArray(files)) throw new Error('budget.files must be an object');
  const entries = Object.entries(files);
  if (entries.length === 0) throw new Error('budget.files is empty');
  for (const [name, limit] of entries) {
    if (!isLimit(limit)) throw new Error(`limit for ${name} must be a non-negative integer`);
    if (normalize(name).startsWith('..') || name.startsWith('/')) throw new Error(`path outside dist: ${name}`);
  }
  return { total, files: files as Record<string, number> };
}

function listFiles(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path, base) : [relative(base, path).split(sep).join('/')];
  });
}

export const gzipSize = (path: string): number => gzipSync(readFileSync(path), { level: 9 }).length;

/** Returns one message per violation; an empty array means the build fits. */
export function checkBudget(dir: string, budget: Budget): string[] {
  const sizes = new Map(listFiles(dir).map((name) => [name, gzipSize(join(dir, name))] as const));
  return checkSizes(sizes, null, budget);
}

/** Mapa izgrađenih HTML stranica u `.next`: Pages Router (`server/pages`) ili App Router (`server/app`). */
export function nextPagesDir(nextDir: string): string | null {
  for (const sub of ['pages', 'app']) if (existsSync(join(nextDir, 'server', sub))) return join(nextDir, 'server', sub);
  return null;
}

/**
 * Next.js: stranica `name` je `server/pages/<name>` (ili `server/app/<name>`), a njezina veličina je gzip HTML-a plus gzip svake
 * skripte i stila koje stranica učita (`/_next/static/...`, bez `noModule`, koji moderan preglednik ne
 * preuzima). Zbroj broji svaku datoteku jednom, i kad je dijele dvije stranice.
 */
export function nextPageSizes(nextDir: string, names: readonly string[]): { sizes: Map<string, number>; total: number } {
  const sizes = new Map<string, number>();
  const all = new Map<string, number>();
  for (const name of names) {
    const page = join(nextPagesDir(nextDir) ?? join(nextDir, 'server', 'app'), name);
    if (!existsSync(page)) continue;
    const html = readFileSync(page, 'utf8');
    const files = new Map([[page, gzipSize(page)]]);
    for (const tag of html.match(/<(?:script|link)\b[^>]*>/g) ?? []) {
      if (/\bnoModule\b/i.test(tag) || (tag.startsWith('<link') && !/rel="(?:stylesheet|preload|modulepreload)"/.test(tag))) continue;
      const asset = /\b(?:src|href)="\/_next\/(static\/[^"?#]+)"/.exec(tag)?.[1];
      if (asset === undefined || asset.split('/').includes('..')) continue;
      const path = join(nextDir, asset);
      if (!existsSync(path)) throw new Error(`${name}: missing asset ${asset}`);
      files.set(path, gzipSize(path));
    }
    let size = 0;
    for (const [path, bytes] of files) {
      size += bytes;
      all.set(path, bytes);
    }
    sizes.set(name, size);
  }
  return { sizes, total: [...all.values()].reduce((a, b) => a + b, 0) };
}

/** Isto pravilo za obje mjere; `total` null znači zbroj veličina. */
export function checkSizes(sizes: ReadonlyMap<string, number>, total: number | null, budget: Budget): string[] {
  const problems: string[] = [];
  let sum = 0;
  for (const [name, size] of sizes) {
    // Own keys only: an inherited name such as "toString" must not count as a rule.
    const limit = Object.hasOwn(budget.files, name) ? budget.files[name] : undefined;
    if (limit === undefined) {
      problems.push(`${name}: nema granice u proračunu`);
      continue;
    }
    sum += size;
    if (size > limit) problems.push(`${name}: ${size} B gzip > ${limit} B`);
  }
  for (const name of Object.keys(budget.files)) {
    if (!sizes.has(name)) problems.push(`${name}: datoteka iz proračuna ne postoji`);
  }
  sum = total ?? sum;
  if (sum > budget.total) problems.push(`ukupno: ${sum} B gzip > ${budget.total} B`);
  return problems;
}

/** `dir` je izgradnja Nexta ako ima `server/pages` ili `server/app`, inače mapa datoteka. */
export function checkDir(dir: string, budget: Budget): string[] {
  if (nextPagesDir(dir) === null) return checkBudget(dir, budget);
  const { sizes, total } = nextPageSizes(dir, Object.keys(budget.files));
  for (const [name, size] of sizes) console.log(`${name}: ${size} B gzip (granica ${budget.files[name]} B)`);
  console.log(`ukupno: ${total} B gzip (granica ${budget.total} B)`);
  return checkSizes(sizes, total, budget);
}

if (isMain(import.meta.url)) {
  const [dir = '.next', budgetPath = 'budget.json'] = process.argv.slice(2);
  const problems = checkDir(dir, parseBudget(readFileSync(budgetPath, 'utf8')));
  if (problems.length > 0) {
    for (const p of problems) console.error(`Proračun prekoračen: ${p}`);
    process.exit(1);
  }
  console.log(`Proračun veličine u redu (${dir}).`);
}
