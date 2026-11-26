// Logika u pregledniku: odluke iz P-0.2, ručni izbor (P-0.3) i upis u stranicu.
import { resolveChoice, type Decision } from './choice/resolve.ts';
import { readChoice, writeChoice, type Choice, type ChoiceStore } from './choice/store.ts';
import type { Config } from './config.ts';
import { availableFrontend, frontendUrl, type DesktopPackage, type Route } from './detect.ts';
import { choosePackage, chooseView, type Signals, type View } from './detect/index.ts';
import { clientText as text } from './client-text.ts';

/**
 * Zakazuje odlazak na web; može vratiti funkciju koja ga otkazuje. `replace` znači odmah i bez
 * unosa u povijest (`location.replace`); tada je `delayMs` 0.
 */
export type Navigate = (url: string, delayMs: number, replace?: boolean) => (() => void) | void;

/** Zakazuje ponavljanje; vraća funkciju koja ga zaustavlja (zamjenjivo u testovima). */
export type Every = (tick: () => void, intervalMs: number) => () => void;

export interface RouteOptions {
  /** `/ulaz?izbor`: uvijek se prikazuje izbor, bez automatskog prijelaza (put za promjenu izbora). */
  readonly chooseOnly?: boolean;
  readonly every?: Every;
}

/**
 * Prvi posjet uz automatsko prepoznavanje čeka toliko, uz vidljivo odbrojavanje i gumb „Ostani ovdje”
 * (P-0.3, odluka 27. 11. 2026.; ranije 4 s). Zapamćen izbor ne čeka (`location.replace`).
 */
export const REDIRECT_DELAY_MS = 1500;
const COUNTDOWN_STEP_MS = 500;

const defaultEvery: Every = (tick, ms) => {
  const id = setInterval(tick, ms);
  return () => clearInterval(id);
};

/** Ima li zapamćenog ručnog izbora (prikaza ili paketa). */
const hasChoice = (c: Choice): boolean => c.view !== undefined || c.package !== undefined;

/** Preloader uvijek vodi na ekran prijave; mobitel ide na web dok ne postoji `/mobilna/` (D-318). */
function toRoute(d: Decision, config: Config): Route {
  const frontend = availableFrontend(d.view === 'mobile' ? 'mobile' : 'web', config);
  return {
    frontend,
    url: frontendUrl(frontend, config),
    desktopPackage: d.package,
    downloadUrl: d.package ? config.downloads[d.package] : null,
  };
}

function render(doc: Document, r: Route, d: Decision): void {
  doc.body.dataset['frontend'] = r.frontend;
  doc.getElementById('open-app')?.setAttribute('href', r.url);
  const offer = doc.getElementById('desktop-offer');
  const link = doc.getElementById('desktop-download');
  if (offer && link) {
    // Samo poveznica: preuzimanje počinje tek na klik korisnika.
    link.setAttribute('href', r.downloadUrl ?? '');
    link.textContent = r.desktopPackage ? text.download(r.desktopPackage) : '';
    offer.hidden = !r.desktopPackage;
  }
  for (const b of doc.querySelectorAll<HTMLElement>('#choice button')) {
    const on = b.dataset['view'] ? b.dataset['view'] === d.view : b.dataset['package'] === d.package;
    b.setAttribute('aria-pressed', String(on));
  }
}

export function applyRoute(
  doc: Document,
  signals: Signals,
  config: Config,
  navigate: Navigate,
  store: ChoiceStore | null = null,
  options: RouteOptions = {},
): Route {
  const auto: Decision = { view: chooseView(signals), package: choosePackage(signals) };
  let manual: Choice = readChoice(store);
  let decision = resolveChoice(auto, manual);
  const route = toRoute(decision, config);
  render(doc, route, decision);

  const section = doc.getElementById('choice');
  const countdown = doc.getElementById('countdown');
  const stay = doc.getElementById('stay-here');
  let cancel: (() => void) | void = undefined;
  let stopTicking: (() => void) | undefined;
  let prefetch: HTMLLinkElement | null = null;
  const stop = (): void => {
    cancel?.();
    cancel = undefined;
    stopTicking?.();
    stopTicking = undefined;
    prefetch?.remove();
    prefetch = null;
    if (countdown && !countdown.hidden) countdown.textContent = text.stayed;
    if (stay) stay.hidden = true;
  };

  if (options.chooseOnly) {
    // Bez automatskog prijelaza.
  } else if (hasChoice(manual)) {
    // Zapamćen izbor: bez čekanja i bez unosa u povijest, da „natrag” ne vrati na ulaz.
    navigate(route.url, 0, true);
  } else {
    cancel = navigate(route.url, REDIRECT_DELAY_MS);
    // Prefetch ciljne stranice dok korisnik čeka.
    prefetch = doc.createElement('link');
    prefetch.rel = 'prefetch';
    prefetch.href = route.url;
    doc.head.append(prefetch);
    if (countdown) {
      let left = REDIRECT_DELAY_MS;
      countdown.hidden = false;
      countdown.textContent = text.countdown(Math.ceil(left / 1000));
      if (stay) stay.hidden = false;
      stopTicking = (options.every ?? defaultEvery)(() => {
        left = Math.max(0, left - COUNTDOWN_STEP_MS);
        countdown.textContent = text.countdown(Math.max(1, Math.ceil(left / 1000)));
      }, COUNTDOWN_STEP_MS);
    }
  }
  // Klik, tipka ili fokus bilo gdje na ekranu zaustavlja odbrojavanje: prijelaz ne smije preteći korisnika.
  const screen = doc.querySelector('main') ?? doc.body;
  for (const type of ['click', 'keydown', 'focusin']) screen.addEventListener(type, stop);
  if (!section) return route;
  section.hidden = false;
  section.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest?.('button');
    if (!button) return;
    const view = button.getAttribute('data-view') as View | null;
    const pkg = button.getAttribute('data-package') as DesktopPackage | null;
    if (!view && !pkg) return;
    // Korisnik bira: automatsko preusmjeravanje više ne smije preteći njegov klik.
    stop();
    manual = view ? { ...manual, view } : { ...manual, package: pkg ?? undefined };
    const saved = writeChoice(store, manual);
    decision = resolveChoice(auto, manual);
    render(doc, toRoute(decision, config), decision);
    const status = doc.getElementById('choice-status');
    if (status) status.textContent = saved ? text.choiceSaved : text.choiceNotSaved;
  });
  return route;
}
