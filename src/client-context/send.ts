// P-0.8: jedan POST s kontekstom klijenta. Ne čeka odgovor i ne baca; pad rute ne mijenja nastavak.
import { detectBrowser } from '../detect.ts';
import { chooseView, resolvePlatform, type Signals } from '../detect/index.ts';
import { CLIENT_APP_VERSION_PATTERN, CLIENT_CONTEXT_PATH, type ClientContext } from './contract.ts';

export type Fetch = (path: string, init: RequestInit) => Promise<unknown>;

/** Zatvorene vrijednosti iz signala P-0.2 i širine prozora; ništa drugo ne ulazi. */
export function clientContextFrom(s: Signals, width: number, appVersion: string): ClientContext {
  const found: unknown = resolvePlatform(s);
  // Svaki niz iz resolvePlatform je na listi; naslijeđeni ključ hintsa (`__proto__`, `toString`) nije niz.
  const os = typeof found === 'string' ? (found as ClientContext['os']) : 'other';
  const ua = s.userAgent;
  const b = detectBrowser(ua);
  // Na iOS-u je svaki preglednik WebKit; Edge i Opera su Chromium.
  const browser = os === 'ios' ? 'safari' : b === 'firefox' || b === 'safari' || b === 'other' ? b : 'chromium';
  const tablet = /iPad/.test(ua) || (os === 'ios' && /Macintosh/.test(ua)) || (os === 'android' && !/Mobi/.test(ua));
  const device = chooseView(s) === 'desktop' ? 'desktop' : tablet ? 'tablet' : 'phone';
  const w = Number.isFinite(width) ? width : 0;
  const screen = w >= 840 ? 'expanded' : w >= 600 ? 'medium' : 'compact';
  return { app: 'web', appVersion, browser, device, os, screen };
}

/**
 * JCS tekst: popis ključeva u `JSON.stringify` određuje i redoslijed (kodne točke) i propušta
 * samo šest polja; vrijednosti su ASCII riječi, pa je to i njihov JCS oblik.
 */
export function clientContextBody(c: ClientContext): string {
  return JSON.stringify(c, ['app', 'appVersion', 'browser', 'device', 'os', 'screen']);
}

/**
 * Šalje jednom i uvijek vraća odmah; loša verzija ne šalje ništa. S ispravnom verzijom tijelo
 * ima najviše 128 bajtova, ispod `CLIENT_CONTEXT_MAX_BYTES` (test to provjerava).
 */
export function sendClientContext(send: Fetch, c: ClientContext): void {
  if (!new RegExp(CLIENT_APP_VERSION_PATTERN, 'u').test(c.appVersion)) return;
  try {
    send(CLIENT_CONTEXT_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: clientContextBody(c),
      credentials: 'omit',
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Nema mreže ili fetcha: korisnik svejedno nastavlja.
  }
}
