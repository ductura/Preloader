// P-0.8: jedan POST s kontekstom klijenta. Ne čeka odgovor i ne baca; pad rute ne mijenja nastavak.
import type { Operations } from '@ductura/contracts';
import { detectBrowser } from '../detect.ts';
import { chooseView, resolvePlatform, type Signals } from '../detect/index.ts';

/** Tijelo rute iz `@ductura/contracts`; samo tip, pa u stranicu ne ulazi kod paketa. */
export type ClientContext = Operations['client.context.post']['body'];
/** Put rute `client.context.post`; test ga uspoređuje s `openapi/v1.json` paketa. */
export const CLIENT_CONTEXT_PATH = '/api/v1/client-context';

export type Fetch = (path: string, init: RequestInit) => Promise<unknown>;

/** Zatvorene vrijednosti iz signala P-0.2 i širine prozora; ništa drugo ne ulazi. */
export function clientContextFrom(s: Signals, width: number, appVersion: string): ClientContext {
  const found: unknown = resolvePlatform(s);
  // Svaki niz iz resolvePlatform je na listi; naslijeđeni ključ hintsa (`__proto__`, `toString`) nije niz.
  const os = typeof found === 'string' ? (found as ClientContext['os']) : 'other';
  const ua = s.userAgent;
  const b = detectBrowser(ua);
  // Na iOS-u je svaki preglednik WebKit; Edge i Opera su Chromium.
  const browser = os === 'ios' ? 'safari' : b === 'chrome' || b === 'edge' || b === 'opera' ? 'chromium' : b;
  // iOS bez iPhonea je iPad (i u desktop načinu, s UA-om Maca); Android bez `Mobi` je tablet.
  const tablet = os === 'ios' ? !/iPhone|iPod/.test(ua) : os === 'android' && !/Mobi/.test(ua);
  const device = chooseView(s) === 'desktop' ? 'desktop' : tablet ? 'tablet' : 'phone';
  // `width - width` je 0 samo za konačan broj: NaN i ±Infinity daju compact.
  const w = width - width === 0 ? width : 0;
  const screen = w >= 840 ? 'expanded' : w >= 600 ? 'medium' : 'compact';
  return { app: 'web', appVersion, browser, device, os, screen };
}

/**
 * JCS tekst: `clientContextFrom` gradi objekt sa šest ključeva redom kodnih točaka, a vrijednosti
 * su ASCII riječi, pa je `JSON.stringify` i njihov JCS oblik.
 */
export const clientContextBody = (c: ClientContext): string => JSON.stringify(c);

/** Ista provjera kao `pattern` polja `appVersion` u ugovoru, kraće zapisana (test ih uspoređuje na vektorima). */
export const APP_VERSION_RE = /^(0|[1-9]\d{0,5})(\.(0|[1-9]\d{0,5})){2}$/;

/**
 * Šalje jednom i uvijek vraća odmah; loša verzija ne šalje ništa. S ispravnom verzijom tijelo
 * stane u `x-max-body-bytes` rute (test to provjerava).
 */
export function sendClientContext(send: Fetch, s: Signals, width: number, appVersion: string): void {
  if (!APP_VERSION_RE.test(appVersion)) return;
  try {
    send(CLIENT_CONTEXT_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: clientContextBody(clientContextFrom(s, width, appVersion)),
      credentials: 'omit',
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Nema mreže ili fetcha: korisnik svejedno nastavlja.
  }
}
