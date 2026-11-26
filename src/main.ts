// Prvi ekran u pregledniku: odluke (P-0.2), ručni izbor (P-0.3) i kontekst klijenta (P-0.8).
// Ugrađena skripta stranice `/` poziva `startPreloader` (scripts/page-assets.ts); uvoz sam ništa ne pokreće.
import { browserStore } from './choice/store.ts';
import { applyRoute } from './client.ts';
import { sendClientContext } from './client-context/index.ts';
import { APP_VERSION, defaultConfig } from './config.ts';
import { signalsFrom } from './detect/index.ts';

let started = false;

/** Jednom po učitavanju stranice. */
export function startPreloader(): void {
  if (started) return;
  started = true;
  const signals = signalsFrom(navigator);
  applyRoute(document, signals, defaultConfig, (url, delayMs, replace) => {
    if (replace) {
      location.replace(url);
      return;
    }
    const id = setTimeout(() => location.assign(url), delayMs);
    return () => clearTimeout(id);
  }, browserStore(window), { chooseOnly: new URLSearchParams(location.search).has('izbor') });
  // Nakon zakazanog preusmjeravanja; ne čeka odgovor (P-0.8).
  sendClientContext((path, init) => fetch(path, init), signals, innerWidth, APP_VERSION);
}
