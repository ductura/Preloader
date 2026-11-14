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
  const route = applyRoute(doc, ua, defaultConfig, go);
  return { doc, go, route };
}

const href = (doc: Document, id: string) => doc.getElementById(id)?.getAttribute('href');

describe('stranica preloadera', () => {
  test('Chrome na Macu: Chrome sučelje + macOS paket', () => {
    const { doc, go } = visit(UA.chromeMac);
    expect(doc.body.dataset['frontend']).toBe('chrome');
    expect(href(doc, 'open-app')).toBe(defaultConfig.frontends.chrome);
    expect(href(doc, 'desktop-download')).toMatch(/\.dmg$/);
    expect(doc.getElementById('desktop-offer')?.hidden).toBe(false);
    expect(doc.getElementById('desktop-download')?.textContent).toContain('za macOS');
    expect(go).toHaveBeenCalledWith(defaultConfig.frontends.chrome, 4000);
  });

  test('Chrome na Androidu: mobilno sučelje, bez desktop paketa, odmah dalje', () => {
    const { doc, go } = visit(UA.chromeAndroid);
    expect(doc.body.dataset['frontend']).toBe('mobile');
    expect(href(doc, 'open-app')).toBe(defaultConfig.frontends.mobile);
    expect(doc.getElementById('desktop-offer')?.hidden).toBe(true);
    expect(go).toHaveBeenCalledWith(defaultConfig.frontends.mobile, 0);
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
    });
    expect(html).not.toContain('"><x>');
    expect(html).toContain('/a&quot;&gt;&lt;x&gt;');
  });
});
