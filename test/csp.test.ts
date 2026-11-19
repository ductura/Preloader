// CSP izgrađene stranice (DAN-995): samo hash vlastite skripte i stila.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contentSecurityPolicyFor, pageContentSecurityPolicy, scriptHash } from '../deploy/edge/index.ts';
import { build } from './static-build.ts';

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
    ['s NBSP', `${HASH}\u00a0`],
    ['s DEL', `${HASH}\u007f`],
    ['toString', 'toString'],
    ['__proto__', '__proto__'],
  ])('%s', (_, bad) => {
    expect(() => pageContentSecurityPolicy({ scriptHash: bad, styleHash: HASH })).toThrow(/hash/);
    expect(() => pageContentSecurityPolicy({ scriptHash: HASH, styleHash: bad })).toThrow(/hash/);
  });

  it('objekt čiji toString mijenja vrijednost', () => {
    let n = 0;
    const tricky = { toString: () => (n++ ? "x' 'unsafe-inline" : HASH) } as unknown as string;
    expect(() => pageContentSecurityPolicy({ scriptHash: tricky, styleHash: HASH })).toThrow(/hash/);
    expect(() => pageContentSecurityPolicy({ scriptHash: HASH, styleHash: tricky })).toThrow(/hash/);
  });
});

describe('stranica koja nije točno jedna skripta i jedan stil se odbija', () => {
  it.each<[string, string]>([
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
    ['<script/> kao drugi tag', page('1', 'a{}') + '<script/>'],
    ['<script\t> kao drugi tag', page('1', 'a{}') + '<script\t>2</script>'],
    ...['svg', 'math', 'template', 'textarea', 'xmp', 'plaintext', 'noembed', 'noframes', 'iframe'].map(
      (tag): [string, string] => [`skripta u <${tag}>`, `<style>a{}</style><${tag.toUpperCase()}><script>1</script></${tag}>`],
    ),
  ])('%s', async (_, html) => {
    await expect(contentSecurityPolicyFor(html)).rejects.toThrow();
  });

  it('</stylesheet> u tekstu stila nije kraj elementa', async () => {
    const css = 'p::after{content:"</stylesheet>"}';
    expect(await contentSecurityPolicyFor(page('1', css))).toContain(`style-src '${sha(css)}';`);
    expect(await contentSecurityPolicyFor(page('1', 'a{}').replace('</style>', '</STYLE >'))).toContain(`style-src '${sha('a{}')}';`);
  });

  it('<noscript>, <scripts> i <script-x> nisu skripta', async () => {
    const html = page('1', 'a{}') + '<noscript><p>x</p></noscript><scripts>2</scripts><script-x>3</script-x><svgx></svgx>';
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

  it('CRLF i sami CR daju isti hash kao LF (HTML parser)', async () => {
    const lf = await contentSecurityPolicyFor(page('a()\nb()', 'b{}\nc{}'));
    expect(await contentSecurityPolicyFor(page('a()\r\nb()', 'b{}\r\nc{}'))).toBe(lf);
    expect(await contentSecurityPolicyFor(page('a()\rb()', 'b{}\rc{}'))).toBe(lf);
  });

  it('BOM unutar teksta ostaje u hashu (preglednik ga ne briše)', async () => {
    expect(await contentSecurityPolicyFor(page('a()\ufeff', 'b{}'))).toContain(`script-src '${sha('a()\ufeff')}';`);
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

  // Isto izdvajanje kao u kodu: zajedničku grešku hvata tek e2e u pregledniku (traka w993a).
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
    // Inline stil i rukovatelji iz skripte: setAttribute('style'/'on…') i umetanje HTML-a.
    expect(inner('script')).not.toMatch(/setAttribute\(\s*["'](style|on)|innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });
});
