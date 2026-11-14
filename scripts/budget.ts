// Proračun veličine: gzip veličina svake datoteke u dist i zbroj. Prekoračenje ruši CI (izlazni kod 1).
import { readdirSync, readFileSync, statSync } from 'node:fs';
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
  const problems: string[] = [];
  const present = new Set(listFiles(dir));
  let sum = 0;
  for (const name of present) {
    const limit = budget.files[name];
    if (limit === undefined) {
      problems.push(`${name}: nema granice u proračunu`);
      continue;
    }
    const size = gzipSize(join(dir, name));
    sum += size;
    if (size > limit) problems.push(`${name}: ${size} B gzip > ${limit} B`);
  }
  for (const name of Object.keys(budget.files)) {
    if (!present.has(name)) problems.push(`${name}: datoteka iz proračuna ne postoji`);
  }
  if (sum > budget.total) problems.push(`ukupno: ${sum} B gzip > ${budget.total} B`);
  return problems;
}

if (isMain(import.meta.url)) {
  const [dir = 'dist', budgetPath = 'budget.json'] = process.argv.slice(2);
  const problems = checkBudget(dir, parseBudget(readFileSync(budgetPath, 'utf8')));
  if (problems.length > 0) {
    for (const p of problems) console.error(`Proračun prekoračen: ${p}`);
    process.exit(1);
  }
  console.log(`Proračun veličine u redu (${dir}).`);
}
