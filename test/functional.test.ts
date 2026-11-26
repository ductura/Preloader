// @vitest-environment happy-dom
// Funkcionalna provjera: Chrome na Macu otvara Chrome sučelje i nudi macOS paket.
// Chrome na Androidu otvara mobilno sučelje. Sve se odlučuje u pregledniku, bez servera.
import { describe, expect, test, vi } from 'vitest';
import { applyRoute, REDIRECT_DELAY_MS } from '../src/client.ts';
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
  test('Chrome na Macu: web + macOS paket', () => {
    const { doc, go } = visit(UA.chromeMac);
    expect(doc.body.dataset['frontend']).toBe('web');
    expect(href(doc, 'open-app')).toBe(defaultConfig.frontends.web);
    // PRE-1301: gumb vodi na /preuzimanje (manifest servera), ne na tvrdo upisanu datoteku.
    expect(href(doc, 'desktop-download')).toBe('/preuzimanje?sustav=macos');
    expect(doc.getElementById('desktop-offer')?.hidden).toBe(false);
    expect(doc.getElementById('desktop-download')?.textContent).toContain('za macOS');
    expect(go).toHaveBeenCalledWith(defaultConfig.frontends.web, REDIRECT_DELAY_MS);
  });

  test('Chrome na Androidu: web (mobilne inačice još nema), bez desktop paketa, vrijeme za ručni izbor', () => {
    const { doc, go } = visit(UA.chromeAndroid);
    expect(doc.body.dataset['frontend']).toBe('web');
    expect(href(doc, 'open-app')).toBe(defaultConfig.frontends.web);
    expect(doc.getElementById('desktop-offer')?.hidden).toBe(true);
    expect(go).toHaveBeenCalledWith(defaultConfig.frontends.web, REDIRECT_DELAY_MS);
  });

  test('Edge na Windowsu: web + Windows paket', () => {
    expect(visit(UA.edgeWindows).route).toEqual({
      frontend: 'web',
      url: defaultConfig.frontends.web,
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
      frontends: { web: '/a"><x>' },
      downloads: { windows: '/w', macos: '/m' },
    });
    expect(html).not.toContain('"><x>');
    expect(html).toContain('/a&quot;&gt;&lt;x&gt;');
  });
});

// Karta adresa D-318: preloader na /ulaz nema gumbe za prijavu i administraciju, sam vodi na prijavu aplikacije.
describe('ulaz bez prijave i administracije', () => {
  test('nema gumba ni poveznica za prijavu i administraciju, ni prijavnog obrasca (D-09)', () => {
    const html = renderPage({ script: '', css: '' });
    expect(html).not.toMatch(/id="sign-in|AAI@EduHr|Administracija platforme|\/api\/v1\/auth|\/admin|<form|<input|type="password"/i);
  });

  test('sam vodi na /aplikacija/prijava, i mobitel dok /mobilna ne postoji', () => {
    expect(defaultConfig.frontends).toEqual({ web: '/aplikacija/prijava' });
    for (const ua of [UA.chromeMac, UA.edgeWindows, UA.firefoxLinux, UA.chromeAndroid, UA.safariIphone]) {
      const { doc, go } = visit(ua);
      expect(go).toHaveBeenCalledWith('/aplikacija/prijava', REDIRECT_DELAY_MS);
      expect(href(doc, 'open-app')).toBe('/aplikacija/prijava');
    }
  });

  test('inačica koja ne postoji se ne nudi: nema izbora prikaza, ostaje izbor paketa', () => {
    const { doc } = visit(UA.chromeWindows);
    expect(doc.querySelector('[data-view]')).toBeNull();
    expect(doc.querySelector('[data-package="windows"]')).not.toBeNull();
    expect(renderPage({ script: '', css: '' })).not.toContain('/app/');
  });

  test('kad /mobilna postoji, mobitel ide na nju i izbor prikaza se nudi', () => {
    const withMobile = { ...defaultConfig, frontends: { web: '/aplikacija/prijava', mobile: '/mobilna/prijava' } };
    const doc = new DOMParser().parseFromString(renderPage({ script: '', css: '' }, withMobile), 'text/html');
    const go = vi.fn<(url: string, delayMs: number) => void>();
    applyRoute(doc, { userAgent: UA.chromeAndroid }, withMobile, go);
    expect(go).toHaveBeenCalledWith('/mobilna/prijava', REDIRECT_DELAY_MS);
    expect(doc.querySelector('[data-view="mobile"]')).not.toBeNull();
  });

  test('klik, tipka ili fokus unutar ekrana zaustavljaju odbrojavanje (P-0.3)', () => {
    for (const type of ['click', 'keydown', 'focusin']) {
      const doc = new DOMParser().parseFromString(renderPage({ script: '', css: '' }), 'text/html');
      const cancel = vi.fn();
      applyRoute(doc, { userAgent: UA.chromeMac }, defaultConfig, () => cancel);
      doc.getElementById('open-app')?.dispatchEvent(new Event(type, { bubbles: true }));
      expect(cancel, type).toHaveBeenCalledOnce();
    }
  });
});
