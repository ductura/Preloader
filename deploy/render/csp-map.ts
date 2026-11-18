// nginx map of the Content-Security-Policy per page of dist/, for the optional
// Render image (deploy/render/Dockerfile). The policy is the one the local edge
// sends (deploy/edge/content-security-policy.ts): only the hashes of the one
// inline script and the one inline style of each page.
//
//   node deploy/render/csp-map.ts <dist> <out.conf>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentSecurityPolicyFor } from '../edge/content-security-policy.ts';
import { isMain } from '../../scripts/is-main.ts';

/** Built pages and the request paths ($uri in nginx) that serve each. */
export const PAGES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'index.html': ['/', '/index.html'],
  'greska.html': ['/greska.html'],
});

/** The `map $uri $ductura_csp { ... }` block; any other path gets no header. */
export async function cspMap(distDir: string): Promise<string> {
  const lines = ['map $uri $ductura_csp {', '  default "";'];
  for (const [file, paths] of Object.entries(PAGES)) {
    const policy = await contentSecurityPolicyFor(readFileSync(join(distDir, file), 'utf8'));
    // A quote, backslash, $ or line end would break out of the nginx string.
    if (/["\\$\r\n]/.test(policy)) throw new Error(`CSP of ${file} cannot be written as an nginx string`);
    for (const path of paths) lines.push(`  ${path} "${policy}";`);
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

if (isMain(import.meta.url)) {
  const [distDir, out] = process.argv.slice(2);
  if (distDir === undefined || out === undefined) throw new Error('usage: csp-map.ts <dist> <out.conf>');
  writeFileSync(out, await cspMap(distDir));
}
