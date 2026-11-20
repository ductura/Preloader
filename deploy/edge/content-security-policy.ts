/**
 * Content-Security-Policy statične stranice preloadera (DAN-995), prenesen iz
 * Ductus src/server/http/content-security-policy.ts (DAN-489). Ondje politiku
 * gradi middleware s nonceom; ovdje je stranica statična, pa politika dopušta
 * samo hash jedine ugrađene skripte i jedinog ugrađenog stila: bez
 * 'unsafe-inline', 'unsafe-eval', noncea i 'strict-dynamic'.
 *
 * Modul radi i u rubnom (edge) runtimeu: samo Web Crypto, bez `node:` uvoza.
 */

const HASH = /^sha256-[A-Za-z0-9+/]{43}=$/;

export type PolicyHashes = {
  /** `sha256-<base64>` teksta jedine skripte. */
  scriptHash: string;
  /** `sha256-<base64>` teksta jedinog stila. */
  styleHash: string;
};

/** The CSP source of a script's text, `sha256-<base64>`. */
export async function scriptHash(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return `sha256-${btoa(String.fromCharCode(...digest))}`;
}

/** The page policy. Throws on a malformed hash. */
export function pageContentSecurityPolicy({ scriptHash: script, styleHash: style }: PolicyHashes): string {
  // typeof first: an object's toString could pass the test and then return something else.
  if (typeof script !== 'string' || !HASH.test(script)) throw new Error('CSP script hash must be a sha256 source');
  return policyOf(`'${script}'`, style);
}

/** Politika sa zadanim izvorom skripte (hash ili `'none'`); hash stila se provjerava. */
function policyOf(scriptSource: string, style: string): string {
  if (typeof style !== 'string' || !HASH.test(style)) throw new Error('CSP style hash must be a sha256 source');
  return [
    "default-src 'none'",
    `script-src ${scriptSource}`,
    `style-src '${style}'`,
    "img-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * Jedini atribut koji smije stajati na tagu: oznaka kojom `next/head` označava svoje elemente.
 * Ne mijenja ni tekst ni izvršavanje elementa.
 */
const NEXT_HEAD = ' data-next-head="">';

/**
 * Tekst jedinog elementa `tag` kako ga preglednik hashira, ili null kad ga nema i `optional`.
 * Element mora biti točno `<tag>` bez atributa (ili samo s oznakom `next/head`); drugi otvarajući
 * tag bilo gdje (i u tekstu skripte) baca, jer bi preglednik mogao drukčije podijeliti stranicu.
 */
function onlyElementText(html: string, tag: 'script' | 'style', optional = false): string | null {
  // Svaki `<script`/`<style` iza kojeg ne slijedi slovo, broj, `_` ili crtica broji se kao tag.
  const opens = [...html.matchAll(new RegExp(`<${tag}(?![\\w-])`, 'gi'))];
  if (opens.length === 0 && optional) return null;
  const open = opens[0];
  const after = open === undefined ? -1 : open.index + open[0].length;
  const rest = html[after] === '>' ? '>' : html.startsWith(NEXT_HEAD, after) ? NEXT_HEAD : '';
  if (opens.length !== 1 || rest === '') {
    throw new Error(`CSP page must have exactly one <${tag}> without attributes`);
  }
  const start = after + rest.length;
  // Kraj je pravi završni tag (`</style>`, `</style >`), ne `</stylesheet>` u tekstu.
  const end = html.slice(start).search(new RegExp(`</${tag}[\\t\\n\\f />]`, 'i'));
  if (end < 0) throw new Error(`CSP page <${tag}> is not closed`);
  return html.slice(start, start + end);
}

/**
 * Omotači u kojima tekst skripte ili stila nije onaj koji preglednik izvrši ili
 * hashira (SVG/MathML dekodiraju entitete i CDATA; template, textarea i slični
 * tagovi skrivaju ili prikazuju tekst). Napomena: `<title>` je dopušten jer ga
 * stranica ima; skripta unutar njega ne bi se izvršila (sigurno, ne šire).
 */
const FOREIGN = /<(svg|math|template|textarea|xmp|plaintext|noembed|noframes|iframe)(?![\w-])/i;

/**
 * Politika za izgrađenu stranicu. CRLF i sami CR postaju LF, kao u HTML
 * parseru prije hashiranja. Komentar, NUL ili strani omotač bacaju: mijenjaju
 * ono što preglednik vidi kao tekst elementa. Uz `scriptOptional` stranica bez
 * ijedne skripte (404 Nexta) dobiva `script-src 'none'`.
 */
export async function contentSecurityPolicyFor(html: string, { scriptOptional = false } = {}): Promise<string> {
  const text = html.replace(/\r\n?/g, '\n');
  if (text.includes('<!--')) throw new Error('CSP page must not contain an HTML comment');
  if (text.includes('\u0000')) throw new Error('CSP page must not contain NUL');
  if (FOREIGN.test(text)) throw new Error('CSP page must not wrap content in a foreign or raw-text element');
  const script = onlyElementText(text, 'script', scriptOptional);
  const style = await scriptHash(onlyElementText(text, 'style') ?? '');
  if (script === null) return policyOf("'none'", style);
  return pageContentSecurityPolicy({ scriptHash: await scriptHash(script), styleHash: style });
}
