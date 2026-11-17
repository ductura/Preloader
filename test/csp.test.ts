// CSP izgrađene stranice (DAN-995): samo hash vlastite skripte i stila.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contentSecurityPolicyFor, pageContentSecurityPolicy, scriptHash } from '../deploy/edge/index.ts';
import { build } from '../scripts/build.ts';

const sha = (text: string) => `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}`;
const HASH = sha('x');
const page = (script: string, css: string) => `<!doctype html><style>${css}</style><body><script>${script}</script></body>`;

describe('neispravan hash ne ulazi u politiku', () => {
  it.each([
    ['bez prefiksa sha256', HASH.slice('sha256-'.length)],
    ['sha384 izvor', `sha384-${'A'.repeat(64)}`],
    ['koji lomi popis', `${HASH}' 'unsafe-inline`],
    ['zvjezdica', '*'],
    ['unsafe-inline', "'unsafe-inline'"],
    ['prazan', ''],
    ['s tabom', `${HASH}\t`],
    ['s CRLF', `${HASH}\r\n`],
    ['s NBSP', `${HASH} `],
    ['s DEL', `${HASH}\u007f`],
    ['toString', 'toString'],
    ['__proto__', '__proto__'],
  ])('%s', (_, bad) => {
    expect(() => pageContentSecurityPolicy({ scriptHash: bad, styleHash: HASH })).toThrow(/hash/);
    expect(() => pageContentSecurityPolicy({ scriptHash: HASH, styleHash: bad })).toThrow(/hash/);
  });
});

describe('stranica koja nije točno jedna skripta i jedan stil se odbija', () => {
  it.each([
    ['bez skripte', '<style>a{}</style>'],
    ['bez stila', '<script>1</script>'],
    ['dvije skripte', page('1', 'a{}') + '<script>2</script>'],
    ['dva stila', page('1', 'a{}') + '<STYLE>b{}</STYLE>'],
    ['vanjska skripta', '<style>a{}</style><script src="/x.js"></script>'],
    ['atribut na tagu', '<style>a{}</style><script type="module">1</script>'],
    ['velika slova kao drugi tag', page('1', 'a{}') + '<SCRIPT>2</SCRIPT>'],
    ['<script u tekstu skripte', page('"<script"', 'a{}')],
    ['komentar', page('1', 'a{}') + '<!-- x -->'],
    ['NUL', page('1\u0000', 'a{}')],
    ['nezatvorena skripta', '<style>a{}</style><script>1'],
  ])('%s', async (_, html) => {
    await expect(contentSecurityPolicyFor(html)).rejects.toThrow();
  });

  it('<noscript> nije skripta', async () => {
    const html = page('1', 'a{}') + '<noscript><p>x</p></noscript>';
    expect(await contentSecurityPolicyFor(html)).toContain(`script-src '${sha('1')}';`);
  });
});

describe('hash je hash teksta kako ga vidi preglednik', () => {
  it('scriptHash je sha256 UTF-8 teksta (ASCII i hrvatska slova)', async () => {
    for (const text of ['', 'console.log(1)', 'Šđčćž ŠĐČĆŽ']) expect(await scriptHash(text)).toBe(sha(text));
  });

  it('jedan promijenjen bajt skripte ili stila mijenja politiku', async () => {
    const base = await contentSecurityPolicyFor(page('a()', 'b{}'));
    expect(await contentSecurityPolicyFor(page('a( )', 'b{}'))).not.toBe(base);
    expect(await contentSecurityPolicyFor(page('a()', 'b{ }'))).not.toBe(base);
  });

  it('CRLF, sami CR i BOM daju isti hash kao LF bez BOM-a (HTML parser)', async () => {
    const lf = await contentSecurityPolicyFor(page('a()\nb()', 'b{}\nc{}'));
    expect(await contentSecurityPolicyFor(page('a()\r\nb()', 'b{}\r\nc{}'))).toBe(lf);
    expect(await contentSecurityPolicyFor(`﻿${page('a()\rb()', 'b{}\rc{}')}`)).toBe(lf);
  });
});

describe('politika izgrađenog index.html (DAN-995)', () => {
  let out: string;
  let html: string;
  beforeAll(async () => {
    out = mkdtempSync(join(tmpdir(), 'csp-'));
    await build(out);
    html = readFileSync(join(out, 'index.html'), 'utf8');
  });
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  const inner = (tag: string) => html.match(new RegExp(`<${tag}>([^]*?)</${tag}>`))?.[1] ?? '';

  it('dopušta samo hash vlastite skripte i stila', async () => {
    const policy = await contentSecurityPolicyFor(html);
    expect(policy).toBe(
      `default-src 'none'; script-src '${sha(inner('script'))}'; style-src '${sha(inner('style'))}'; ` +
        "img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    for (const directive of policy.split('; ')) {
      for (const source of directive.split(' ').slice(1)) {
        expect(source).not.toMatch(/unsafe|strict-dynamic|nonce|\*|^(https?|data|blob):/i);
      }
    }
  });

  it('stranica ne treba ništa što bi politika blokirala', () => {
    const markup = html.replace(/<script>[^]*?<\/script>/, '').replace(/<style>[^]*?<\/style>/, '');
    expect(markup).not.toMatch(/\son\w+\s*=|\sstyle\s*=|javascript:/i);
    expect(inner('script')).not.toMatch(/setAttribute\(\s*["']style|\.cssText/);
  });
});
