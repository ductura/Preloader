// @vitest-environment happy-dom
// DAN-967: property test nad src/detect i src/choice s nasumičnim UA-ovima i client hintovima.
// Svi ulazi su izmišljeni. iPad u desktop načinu (DAN-744) ovdje se ne provjerava posebno.
import fc from 'fast-check';
import { describe, expect, test, vi } from 'vitest';
import { resolveChoice } from '../src/choice/resolve.ts';
import { writeChoice, type Choice, type ChoiceStore } from '../src/choice/store.ts';
import { applyRoute } from '../src/client.ts';
import { defaultConfig, type Config } from '../src/config.ts';
import { choosePackage, chooseView, type Signals, type View } from '../src/detect/index.ts';
import { renderPage } from '../src/page.ts';
import { UA } from './user-agents.ts';

/** Funkcije pod testom; mutanti zamjenjuju jednu, pa se `src/` ne mijenja. */
interface Impl {
  readonly chooseView: typeof chooseView;
  readonly choosePackage: typeof choosePackage;
  readonly resolveChoice: typeof resolveChoice;
  readonly applyRoute: typeof applyRoute;
}
const real: Impl = { chooseView, choosePackage, resolveChoice, applyRoute };

/** Izbor prikaza postoji samo kad postoji /mobilna/ (D-318): svojstva nad prikazom koriste tu konfiguraciju. */
const withMobile: Config = { ...defaultConfig, frontends: { web: '/aplikacija/prijava', mobile: '/mobilna/prijava' } };

const RUNS = { seed: 967, numRuns: 200 } as const;
const VIEWS: readonly unknown[] = ['desktop', 'mobile'];
const PACKAGES: readonly unknown[] = [null, 'windows', 'macos'];
const DOWNLOADS: readonly string[] = Object.values(defaultConfig.downloads);

// --- Generatori ---
const knownUa = fc.constantFrom(...Object.values(UA), '');
/** Šum s rubnim znakovima: CRLF, tab, NBSP, DEL. */
const noise = fc.string({ unit: fc.constantFrom('a', 'Z', ' ', '\r\n', '\t', ' ', '\u007f', '/', ';', 'Mobi') });
const userAgent = fc.oneof(knownUa, fc.string(), fc.tuple(knownUa, noise, knownUa).map((p) => p.join('')));
const mixedCase = (s: string) =>
  fc.array(fc.boolean(), { minLength: s.length, maxLength: s.length })
    .map((up) => [...s].map((c, i) => (up[i] ? c.toUpperCase() : c.toLowerCase())).join(''));
const platform = fc.oneof(
  fc.tuple(
    fc.constantFrom('', ' ', '\t'),
    fc.constantFrom('Windows', 'macOS', 'Android', 'iOS', 'Linux', 'Chrome OS', 'Chromium OS').chain(mixedCase),
    fc.constantFrom('', ' ', ' '),
  ).map((p) => p.join('')),
  // Naslijeđeni ključevi i nepoznate vrijednosti: hints u neskladu s UA-om.
  fc.constantFrom('toString', '__proto__', 'constructor', 'hasOwnProperty', ''),
  fc.string(),
);
const signals: fc.Arbitrary<Signals> = fc.record({
  userAgent,
  hints: fc.option(fc.record({ mobile: fc.boolean(), platform }), { nil: undefined }),
  maxTouchPoints: fc.option(fc.integer({ min: 0, max: 20 }), { nil: undefined }),
});
const manual: fc.Arbitrary<Choice> = fc.record({
  view: fc.option(fc.constantFrom<View>('desktop', 'mobile'), { nil: undefined }),
  package: fc.option(fc.constantFrom('windows' as const, 'macos' as const), { nil: undefined }),
});
const BUTTONS = ['[data-view="desktop"]', '[data-view="mobile"]', '[data-package="windows"]', '[data-package="macos"]'];
const clicks = fc.array(fc.constantFrom(...BUTTONS), { maxLength: 4 });

// --- Stranica ---
class MemoryStore implements ChoiceStore {
  readonly data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

/** Svaki posjet dobiva svjež dokument: `applyRoute` dodaje slušatelja na `#choice`. */
function visit(impl: Impl, s: Signals, chosen: Choice, userClicks: readonly string[], config: Config = withMobile) {
  const doc = new DOMParser().parseFromString(renderPage({ script: '', css: '' }, config), 'text/html');
  const store = new MemoryStore();
  writeChoice(store, chosen);
  const go = vi.fn<(url: string, delayMs: number) => () => void>(() => () => undefined);
  const link = doc.getElementById('desktop-download') as HTMLElement;
  const linkClick = vi.spyOn(link, 'click');
  impl.applyRoute(doc, s, config, go, store);
  const afterLoad = { view: pressed(doc, 'view'), package: pressed(doc, 'package') };
  // Klik korisnika kao događaj, ne `click()`, da se ne pomiješa s klikom na preuzimanje.
  for (const sel of userClicks) doc.querySelector(sel)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return { doc, go, link, linkClick, afterLoad };
}

const pressed = (doc: Document, key: 'view' | 'package') =>
  [...doc.querySelectorAll(`#choice [data-${key}][aria-pressed="true"]`)].map((b) => b.getAttribute(`data-${key}`));

// --- Svojstva ---
const oneViewAtMostOnePackage = (impl: Impl) =>
  fc.property(signals, manual, clicks, (s, chosen, userClicks) => {
    expect(VIEWS).toContain(impl.chooseView(s));
    expect(PACKAGES).toContain(impl.choosePackage(s));
    const { doc } = visit(impl, s, chosen, userClicks);
    expect(pressed(doc, 'view')).toHaveLength(1);
    const pkgs = pressed(doc, 'package');
    expect(pkgs.length).toBeLessThanOrEqual(1);
    const offer = doc.getElementById('desktop-offer') as HTMLElement;
    const href = doc.getElementById('desktop-download')?.getAttribute('href');
    if (!offer.hidden) expect(href).toBe(defaultConfig.downloads[pkgs[0] as 'windows' | 'macos']);
    else expect(pkgs).toHaveLength(0);
  });

const manualWins = (impl: Impl) =>
  fc.property(signals, manual, (s, chosen) => {
    const auto = { view: real.chooseView(s), package: real.choosePackage(s) };
    const d = impl.resolveChoice(auto, chosen);
    if (chosen.view) expect(d.view).toBe(chosen.view);
    if (chosen.package) expect(d.package).toBe(chosen.package);
    // Zapamćen izbor pobjeđuje i na stranici, prije ikakvog klika.
    const { afterLoad } = visit(impl, s, chosen, []);
    expect(afterLoad).toEqual({ view: [d.view], package: d.package ? [d.package] : [] });
  });

const noDownload = (impl: Impl, config: Config = withMobile) =>
  fc.property(signals, manual, clicks, (s, chosen, userClicks) => {
    const { go, link, linkClick } = visit(impl, s, chosen, userClicks, config);
    expect(go).toHaveBeenCalledOnce();
    expect(DOWNLOADS).not.toContain(go.mock.calls[0]?.[0]);
    expect(linkClick).not.toHaveBeenCalled();
    expect(link.hasAttribute('download')).toBe(false);
  });

describe('property (DAN-967): ulaz → odluka', () => {
  test('mutanti: svako namjerno kvarenje ruši odgovarajuće svojstvo', () => {
    const fails = <T extends [unknown, ...unknown[]]>(p: fc.IProperty<T>) => fc.check(p, RUNS).failed;
    // Prikaz izvan skupa za sve ulaze bez hintova (česta klasa).
    expect(fails(oneViewAtMostOnePackage({ ...real, chooseView: (s) => (s.hints ? chooseView(s) : 'tablet' as View) }))).toBe(true);
    // Oba paketa istaknuta.
    expect(fails(oneViewAtMostOnePackage({
      ...real,
      applyRoute: (doc, ...rest) => {
        const r = applyRoute(doc, ...rest);
        for (const b of doc.querySelectorAll('[data-package]')) b.setAttribute('aria-pressed', 'true');
        return r;
      },
    }))).toBe(true);
    // Prepoznavanje gazi ručni izbor.
    expect(fails(manualWins({ ...real, resolveChoice: (auto) => auto }))).toBe(true);
    // Stranica sama klikne preuzimanje.
    expect(fails(noDownload({
      ...real,
      applyRoute: (doc, ...rest) => {
        const r = applyRoute(doc, ...rest);
        doc.getElementById('desktop-download')?.click();
        return r;
      },
    }))).toBe(true);
    // Preusmjeravanje vodi na datoteku paketa.
    const broken: Config = { ...withMobile, frontends: { ...withMobile.frontends, web: defaultConfig.downloads.windows } };
    expect(fails(noDownload(real, broken))).toBe(true);
  });

  test('svaki ulaz daje točno jedan prikaz i najviše jedan istaknut paket', () => {
    fc.assert(oneViewAtMostOnePackage(real), RUNS);
  });

  test('ručni izbor uvijek pobjeđuje prepoznavanje', () => {
    fc.assert(manualWins(real), RUNS);
  });

  test('nijedan ishod ne pokreće preuzimanje', () => {
    fc.assert(noDownload(real), RUNS);
  });
});
