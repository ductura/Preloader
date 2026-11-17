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
  if (!HASH.test(script)) throw new Error('CSP script hash must be a sha256 source');
  if (!HASH.test(style)) throw new Error('CSP style hash must be a sha256 source');
  return [
    "default-src 'none'",
    `script-src '${script}'`,
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
 * Tekst jedinog elementa `tag` kako ga preglednik hashira. Element mora biti
 * točno `<tag>` bez atributa; drugi otvarajući tag bilo gdje (i u tekstu
 * skripte) baca, jer bi preglednik mogao drukčije podijeliti stranicu.
 */
function onlyElementText(html: string, tag: 'script' | 'style'): string {
  // Svaki `<script`/`<style` iza kojeg ne slijedi slovo, broj ili crtica broji se kao tag.
  const opens = [...html.matchAll(new RegExp(`<${tag}(?![\\w-])`, 'gi'))];
  const open = opens[0];
  if (opens.length !== 1 || open === undefined || html[open.index + open[0].length] !== '>') {
    throw new Error(`CSP page must have exactly one <${tag}> without attributes`);
  }
  const start = open.index + open[0].length + 1;
  // Kraj je pravi završni tag (`</style>`, `</style >`), ne `</stylesheet>` u tekstu.
  const end = html.slice(start).search(new RegExp(`</${tag}[\\t\\n\\f />]`, 'i'));
  if (end < 0) throw new Error(`CSP page <${tag}> is not closed`);
  return html.slice(start, start + end);
}

/**
 * Politika za izgrađeni index.html. Ulaz se normalizira kao u HTML parseru
 * prije hashiranja (početni BOM otpada, CRLF i sami CR postaju LF). Komentar
 * ili NUL bacaju: mijenjaju ono što preglednik vidi kao tekst elementa.
 */
export async function contentSecurityPolicyFor(html: string): Promise<string> {
  const text = html.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (text.includes('<!--')) throw new Error('CSP page must not contain an HTML comment');
  if (text.includes('\u0000')) throw new Error('CSP page must not contain NUL');
  return pageContentSecurityPolicy({
    scriptHash: await scriptHash(onlyElementText(text, 'script')),
    styleHash: await scriptHash(onlyElementText(text, 'style')),
  });
}
