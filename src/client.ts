// Logika u pregledniku: odluke iz P-0.2, ručni izbor (P-0.3) i upis u stranicu.
import { resolveChoice, type Decision } from './choice/resolve.ts';
import { readChoice, writeChoice, type Choice, type ChoiceStore } from './choice/store.ts';
import type { Config } from './config.ts';
import { detectBrowser, type DesktopPackage, type Frontend, type Route } from './detect.ts';
import { choosePackage, chooseView, type Signals, type View } from './detect/index.ts';
import { clientText as text } from './text.ts';

/** Zakazuje odlazak na web; može vratiti funkciju koja ga otkazuje. */
export type Navigate = (url: string, delayMs: number) => (() => void) | void;

/**
 * Prije preusmjeravanja korisnik uvijek ima vremena za preuzimanje ili ručni izbor,
 * i u mobilnom prikazu i kad je izbor zapamćen, da ga može promijeniti (P-0.3).
 */
export const REDIRECT_DELAY_MS = 4000;

/** Putanje weba još su iz P-0.1 (odluka 1 otvorena): prikaz računala bira prema pregledniku. */
function frontendFor(view: View, userAgent: string): Frontend {
  if (view === 'mobile') return 'mobile';
  return detectBrowser(userAgent) === 'chrome' ? 'chrome' : 'other';
}

function toRoute(d: Decision, userAgent: string, config: Config): Route {
  const frontend = frontendFor(d.view, userAgent);
  return {
    frontend,
    url: config.frontends[frontend],
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
): Route {
  const auto: Decision = { view: chooseView(signals), package: choosePackage(signals) };
  let manual: Choice = readChoice(store);
  let decision = resolveChoice(auto, manual);
  const route = toRoute(decision, signals.userAgent, config);
  render(doc, route, decision);

  const section = doc.getElementById('choice');
  let cancel = navigate(route.url, REDIRECT_DELAY_MS);
  const stop = (): void => {
    cancel?.();
    cancel = undefined;
  };
  // Prijava (#2028 §3.1): fokus ili dodir na njoj otkazuje automatsko preusmjeravanje,
  // da odlazak na web ne preteče izbor administracije ili AAI@EduHr.
  const signIn = doc.getElementById('sign-in');
  for (const type of ['focusin', 'pointerdown'] as const) signIn?.addEventListener(type, stop);
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
    render(doc, toRoute(decision, signals.userAgent, config), decision);
    const status = doc.getElementById('choice-status');
    if (status) status.textContent = saved ? text.choiceSaved : text.choiceNotSaved;
  });
  return route;
}
