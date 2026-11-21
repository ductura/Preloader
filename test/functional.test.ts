// @vitest-environment happy-dom
// Funkcionalna provjera: Chrome na Macu otvara Chrome sučelje i nudi macOS paket.
// Chrome na Androidu otvara mobilno sučelje. Sve se odlučuje u pregledniku, bez servera.
import { describe, expect, test, vi } from 'vitest';
import { applyRoute } from '../src/client.ts';
import { defaultConfig } from '../src/config.ts';
import { renderPage } from '../src/page.ts';
import { UA } from './user-agents.ts';

function visit(ua: string) {
  const doc = new DOMParser().parseFromString(renderPage({ script: '', css: '' }), 'text/html');
  const go = vi.fn<(url: string, delayMs: number) => void>();
  const route = applyRoute(doc, { userAgent: ua }, defaultConfig, go);
  return { doc, go, route };
}

const href = (doc: Document, id: string) => doc.getElementById(id)?.getAttribute('href');

describe('stranica preloadera', () => {
  test('Chrome na Macu: Chrome sučelje + macOS paket', () => {
    const { doc, go } = visit(UA.chromeMac);
    expect(doc.body.dataset['frontend']).toBe('chrome');
    expect(href(doc, 'open-app')).toBe(defaultConfig.frontends.chrome);
    // PRE-1301: gumb vodi na /preuzimanje (manifest servera), ne na tvrdo upisanu datoteku.
    expect(href(doc, 'desktop-download')).toBe('/preuzimanje?sustav=macos');
    expect(doc.getElementById('desktop-offer')?.hidden).toBe(false);
    expect(doc.getElementById('desktop-download')?.textContent).toContain('za macOS');
    expect(go).toHaveBeenCalledWith(defaultConfig.frontends.chrome, 4000);
  });

  test('Chrome na Androidu: mobilno sučelje, bez desktop paketa, vrijeme za ručni izbor', () => {
    const { doc, go } = visit(UA.chromeAndroid);
    expect(doc.body.dataset['frontend']).toBe('mobile');
    expect(href(doc, 'open-app')).toBe(defaultConfig.frontends.mobile);
    expect(doc.getElementById('desktop-offer')?.hidden).toBe(true);
    expect(go).toHaveBeenCalledWith(defaultConfig.frontends.mobile, 4000);
  });

  test('Edge na Windowsu: ostala sučelja + Windows paket', () => {
    expect(visit(UA.edgeWindows).route).toEqual({
      frontend: 'other',
      url: defaultConfig.frontends.other,
      desktopPackage: 'windows',
      downloadUrl: defaultConfig.downloads.windows,
    });
  });

  test('bez skripte stranica nudi sve izbore na hrvatskom', () => {
    const html = renderPage({ script: '', css: '' });
    expect(html).toContain('<html lang="hr">');
    for (const url of [...Object.values(defaultConfig.frontends), ...Object.values(defaultConfig.downloads)]) {
      expect(html).toContain(`href="${url}"`);
    }
    expect(html).toContain('<noscript>');
  });

  test('vrijednosti se escapiraju u HTML-u', () => {
    const html = renderPage({ script: '', css: '' }, {
      frontends: { chrome: '/a"><x>', mobile: '/m', other: '/o' },
      downloads: { windows: '/w', macos: '/m' },
      signIn: { returnTo: '/app/web/', admin: '/adm"><y>' },
    });
    expect(html).not.toContain('"><x>');
    expect(html).toContain('/a&quot;&gt;&lt;x&gt;');
    expect(html).not.toContain('"><y>');
    expect(html).toContain('/adm&quot;&gt;&lt;y&gt;');
  });
});

// Ugovor #2028 §3.1: dva ulaza u prijavu, bez skripte i prije preusmjeravanja.
describe('prijava s preloadera', () => {
  const signIn = (doc: Document) => [...doc.querySelectorAll<HTMLAnchorElement>('#sign-in a')];

  test('AAI@EduHr vodi na prijavu s povratkom na /app/web/, administracija na /admin/prijava', () => {
    const { doc } = visit(UA.chromeMac);
    expect(signIn(doc).map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Prijava preko AAI@EduHr', '/api/v1/auth/login?returnTo=%2Fapp%2Fweb%2F'],
      ['Administracija platforme', '/admin/prijava'],
    ]);
    const login = new URL(href(doc, 'sign-in-aai') ?? '', 'http://localhost:8000');
    expect(login.pathname).toBe('/api/v1/auth/login');
    expect(login.searchParams.get('returnTo')).toBe('/app/web/');
    expect(doc.getElementById('sign-in')?.getAttribute('aria-label')).toBe('Prijava');
  });

  test('jedini ulaz za studente je AAI@EduHr (D-09): nema obrasca ni drugog pružatelja', () => {
    const html = renderPage({ script: '', css: '' });
    expect(html).not.toMatch(/<form|<input|type="password"/i);
    const logins = html.match(/\/api\/v1\/auth\/[a-z-]+/g) ?? [];
    expect(new Set(logins)).toEqual(new Set(['/api/v1/auth/login']));
  });

  test('nesigurna povratna adresa iz konfiguracije pada na početnu stranicu', () => {
    const html = renderPage({ script: '', css: '' }, { ...defaultConfig, signIn: { returnTo: '//evil.example/', admin: '/admin/prijava' } });
    expect(html).toContain('href="/api/v1/auth/login?returnTo=%2F"');
  });

  for (const type of ['focusin', 'pointerdown'] as const) {
    test(`${type} na prijavi otkazuje automatsko preusmjeravanje`, () => {
      const doc = new DOMParser().parseFromString(renderPage({ script: '', css: '' }), 'text/html');
      const cancel = vi.fn();
      applyRoute(doc, { userAgent: UA.chromeMac }, defaultConfig, () => cancel);
      expect(cancel).not.toHaveBeenCalled();
      doc.getElementById('sign-in-admin')?.dispatchEvent(new Event(type, { bubbles: true }));
      expect(cancel).toHaveBeenCalledTimes(1);
      doc.getElementById('sign-in-aai')?.dispatchEvent(new Event(type, { bubbles: true }));
      expect(cancel).toHaveBeenCalledTimes(1);
    });
  }

  test('bez interakcije s prijavom preusmjeravanje ostaje zakazano', () => {
    const doc = new DOMParser().parseFromString(renderPage({ script: '', css: '' }), 'text/html');
    const cancel = vi.fn();
    applyRoute(doc, { userAgent: UA.chromeMac }, defaultConfig, () => cancel);
    doc.getElementById('open-app')?.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(cancel).not.toHaveBeenCalled();
  });
});
