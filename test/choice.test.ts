// @vitest-environment happy-dom
// P-0.3: ručni izbor prikaza i paketa, pamćenje u pregledniku. Svi podaci su izmišljeni.
import { describe, expect, test, vi } from 'vitest';
import { resolveChoice, type Decision } from '../src/choice/resolve.ts';
import {
  browserStore, CHOICE_VERSION, readChoice, STORAGE_KEY, writeChoice, type Choice, type ChoiceStore,
} from '../src/choice/store.ts';
import { applyRoute, REDIRECT_DELAY_MS } from '../src/client.ts';
import { defaultConfig } from '../src/config.ts';
import { choosePackage, chooseView, type Signals } from '../src/detect/index.ts';
import { renderPage } from '../src/page.ts';
import { clientText, text } from '../src/text.ts';
import { UA } from './user-agents.ts';

class MemoryStore implements ChoiceStore {
  readonly data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

/** Privatni prozor ili blokirana pohrana: svaki pristup baca. */
const throwingStore: ChoiceStore = {
  getItem() { throw new DOMException('blocked', 'SecurityError'); },
  setItem() { throw new DOMException('quota', 'QuotaExceededError'); },
};

const stored = (value: unknown) => {
  const s = new MemoryStore();
  s.data.set(STORAGE_KEY, typeof value === 'string' ? value : JSON.stringify(value));
  return s;
};

describe('pohrana izbora', () => {
  test('zapis i čitanje', () => {
    const s = new MemoryStore();
    expect(writeChoice(s, { view: 'mobile', package: 'macos' })).toBe(true);
    expect(JSON.parse(s.data.get(STORAGE_KEY) ?? '')).toEqual({ v: CHOICE_VERSION, view: 'mobile', package: 'macos' });
    expect(readChoice(s)).toEqual({ view: 'mobile', package: 'macos' });
  });

  test('prazna pohrana i bez pohrane daju prazan izbor', () => {
    expect(readChoice(new MemoryStore())).toEqual({});
    expect(readChoice(null)).toEqual({});
    expect(writeChoice(null, { view: 'desktop' })).toBe(false);
  });

  test.each([
    ['krivi JSON', '{view:'],
    ['broj', '7'],
    ['null', 'null'],
    ['zastarjela verzija', { v: 0, view: 'mobile', package: 'windows' }],
    ['buduća verzija', { v: 2, view: 'mobile' }],
    ['bez verzije', { view: 'mobile' }],
  ])('nevaljan ili zastario zapis (%s) se zanemaruje', (_name, value) => {
    expect(readChoice(stored(value))).toEqual({});
  });

  test('nepoznata vrijednost polja se zanemaruje, valjano polje ostaje', () => {
    expect(readChoice(stored({ v: 1, view: 'tablet', package: 'macos' }))).toEqual({ view: undefined, package: 'macos' });
    expect(readChoice(stored({ v: 1, view: 'desktop', package: 'linux' }))).toEqual({ view: 'desktop', package: undefined });
    expect(readChoice(stored({ v: 1, view: 'constructor', package: '__proto__' }))).toEqual({ view: undefined, package: undefined });
  });

  test('pohrana koja baca (privatni prozor): čitanje i pisanje ne bacaju', () => {
    expect(readChoice(throwingStore)).toEqual({});
    expect(writeChoice(throwingStore, { view: 'mobile' })).toBe(false);
  });

  test('browserStore vraća null kad pristup localStorage baci', () => {
    const win = Object.defineProperty({}, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });
    expect(browserStore(win)).toBeNull();
    expect(browserStore({})).toBeNull();
    const s = new MemoryStore();
    expect(browserStore({ localStorage: s })).toBe(s);
  });
});

const views = ['desktop', 'mobile'] as const;
const packages = ['windows', 'macos'] as const;
// Automatska odluka nikad ne daje paket uz mobilni prikaz (P-0.2).
const autos: Decision[] = [
  ...[null, ...packages].map((p) => ({ view: 'desktop' as const, package: p })),
  { view: 'mobile', package: null },
];
const manuals: Choice[] = [undefined, ...views].flatMap((view) => [undefined, ...packages].map((p) => ({ view, package: p })));

describe('resolveChoice', () => {
  test('bez ručnog izbora vrijedi automatska odluka', () => {
    for (const auto of autos) expect(resolveChoice(auto, {})).toEqual(auto);
  });

  test('ručno mobilno bez ručnog paketa nema paket', () => {
    expect(resolveChoice({ view: 'desktop', package: 'windows' }, { view: 'mobile' })).toEqual({ view: 'mobile', package: null });
  });

  test('ručni paket vrijedi i u mobilnom prikazu', () => {
    expect(resolveChoice({ view: 'mobile', package: null }, { package: 'macos' })).toEqual({ view: 'mobile', package: 'macos' });
  });
});

const signalSpace: Signals[] = [...Object.values(UA), ''].flatMap((userAgent) =>
  [undefined, { mobile: false, platform: 'Windows' }, { mobile: true, platform: 'Android' }, { mobile: false, platform: 'Linux' }]
    .flatMap((hints) => [undefined, 0, 5].map((maxTouchPoints) => ({ userAgent, hints, maxTouchPoints }))));

test('property: ručni izbor uvijek pobjeđuje automatsku odluku', () => {
  for (const s of signalSpace) {
    const auto: Decision = { view: chooseView(s), package: choosePackage(s) };
    for (const manual of manuals) {
      const d = resolveChoice(auto, manual);
      if (manual.view) expect(d.view).toBe(manual.view);
      if (manual.package) expect(d.package).toBe(manual.package);
      expect(views).toContain(d.view);
      expect([null, ...packages]).toContain(d.package);
    }
  }
});

test('property: zapamćeni izbor kroz pohranu pobjeđuje na stranici, a krivi zapis ne mijenja odluku', () => {
  for (const s of signalSpace.filter((_, i) => i % 7 === 0)) {
    for (const manual of manuals) {
      const store = new MemoryStore();
      writeChoice(store, manual);
      const r = visit(s, store).route;
      const auto = { view: chooseView(s), package: choosePackage(s) };
      const expected = resolveChoice(auto, manual);
      expect(r.frontend === 'mobile').toBe(expected.view === 'mobile');
      expect(r.desktopPackage).toBe(expected.package);
      expect(visit(s, stored('{oops')).route.desktopPackage).toBe(auto.package);
    }
  }
});

function visit(s: Signals, store: ChoiceStore | null = null) {
  const doc = new DOMParser().parseFromString(renderPage({ script: '', css: '' }), 'text/html');
  const cancel = vi.fn();
  const go = vi.fn<(url: string, delayMs: number) => () => void>(() => cancel);
  const route = applyRoute(doc, s, defaultConfig, go, store);
  const click = (selector: string) => (doc.querySelector(selector) as HTMLElement).click();
  const pressed = (selector: string) => doc.querySelector(selector)?.getAttribute('aria-pressed');
  return { doc, go, cancel, route, click, pressed };
}

describe('ručni izbor na stranici', () => {
  test('kontrole su vidljive, na hrvatskom, gumbi tipkovnicom i označeni', () => {
    const { doc, pressed } = visit({ userAgent: UA.chromeWindows });
    const section = doc.getElementById('choice');
    expect(section?.hidden).toBe(false);
    expect(section?.textContent).toContain(text.choiceTitle);
    for (const b of doc.querySelectorAll('#choice button')) {
      expect(b.getAttribute('type')).toBe('button');
      expect(b.hasAttribute('tabindex')).toBe(false);
    }
    expect(pressed('[data-view="desktop"]')).toBe('true');
    expect(pressed('[data-package="windows"]')).toBe('true');
    expect(doc.getElementById('choice-status')?.getAttribute('role')).toBe('status');
  });

  test('bez klika ništa se ne upisuje u pohranu', () => {
    const store = new MemoryStore();
    const setItem = vi.spyOn(store, 'setItem');
    visit({ userAgent: UA.chromeMac }, store);
    expect(setItem).not.toHaveBeenCalled();
    expect(document.cookie).toBe('');
  });

  test('Linux: nema automatskog paketa, ručni izbor nudi poveznicu, ne preuzimanje', () => {
    const store = new MemoryStore();
    const { doc, go, cancel, click } = visit({ userAgent: UA.firefoxLinux }, store);
    expect(doc.getElementById('desktop-offer')?.hidden).toBe(true);
    expect(go).toHaveBeenCalledWith(defaultConfig.frontends.other, 4000);
    click('[data-package="windows"]');
    expect(cancel).toHaveBeenCalledOnce();
    expect(go).toHaveBeenCalledOnce();
    expect(doc.getElementById('desktop-offer')?.hidden).toBe(false);
    expect(doc.getElementById('desktop-download')?.getAttribute('href')).toBe(defaultConfig.downloads.windows);
    expect(readChoice(store)).toEqual({ view: undefined, package: 'windows' });
    expect(doc.getElementById('choice-status')?.textContent).toBe(clientText.choiceSaved);
  });

  test('ručni prikaz mijenja poveznicu na web i pamti se za sljedeći posjet', () => {
    const store = new MemoryStore();
    const first = visit({ userAgent: UA.chromeWindows }, store);
    first.click('[data-view="mobile"]');
    expect(first.doc.getElementById('open-app')?.getAttribute('href')).toBe(defaultConfig.frontends.mobile);
    expect(first.pressed('[data-view="mobile"]')).toBe('true');
    expect(first.doc.getElementById('desktop-offer')?.hidden).toBe(true);
    const next = visit({ userAgent: UA.chromeWindows }, store);
    expect(next.route.frontend).toBe('mobile');
    expect(next.go).toHaveBeenCalledWith(defaultConfig.frontends.mobile, REDIRECT_DELAY_MS);
  });

  test('zapamćen „Mobitel”: prije odlaska korisnik može vratiti „Računalo” (pravi timer)', () => {
    vi.useFakeTimers();
    try {
      const doc = new DOMParser().parseFromString(renderPage({ script: '', css: '' }), 'text/html');
      const store = stored({ v: 1, view: 'mobile' });
      const assign = vi.fn<(url: string) => void>();
      // Isti oblik kao `src/main.ts`: setTimeout + clearTimeout.
      applyRoute(doc, { userAgent: UA.chromeWindows }, defaultConfig, (url, delayMs) => {
        const id = setTimeout(() => assign(url), delayMs);
        return () => clearTimeout(id);
      }, store);
      vi.advanceTimersByTime(REDIRECT_DELAY_MS - 1);
      expect(assign).not.toHaveBeenCalled();
      (doc.querySelector('[data-view="desktop"]') as HTMLElement).click();
      vi.runAllTimers();
      expect(assign).not.toHaveBeenCalled();
      expect(doc.getElementById('open-app')?.getAttribute('href')).toBe(defaultConfig.frontends.chrome);
      expect(readChoice(store).view).toBe('desktop');
    } finally {
      vi.useRealTimers();
    }
  });

  test('svaki prikaz, i automatski mobilni, čeka prije odlaska', () => {
    for (const s of signalSpace) for (const [, delay] of visit(s).go.mock.calls) expect(delay).toBe(REDIRECT_DELAY_MS);
  });

  test('zapamćeno računalo pobjeđuje automatski mobilni prikaz', () => {
    const { route } = visit({ userAgent: UA.chromeAndroid }, stored({ v: 1, view: 'desktop' }));
    expect(route.frontend).toBe('chrome');
  });

  test('pohrana koja baca: stranica radi, izbor vrijedi samo na stranici', () => {
    const { doc, click, route } = visit({ userAgent: UA.safariMac }, throwingStore);
    expect(route.desktopPackage).toBe('macos');
    click('[data-view="mobile"]');
    expect(doc.getElementById('open-app')?.getAttribute('href')).toBe(defaultConfig.frontends.mobile);
    expect(doc.getElementById('choice-status')?.textContent).toBe(clientText.choiceNotSaved);
  });

  test('ništa ne pokreće preuzimanje samo od sebe', () => {
    for (const s of signalSpace.filter((_, i) => i % 5 === 0)) {
      const { go } = visit(s, stored({ v: 1, package: 'macos' }));
      for (const [url] of go.mock.calls) expect(Object.values(defaultConfig.downloads)).not.toContain(url);
    }
  });
});
