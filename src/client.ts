// Logika u pregledniku: odabire sučelje i paket prema UA-u i upisuje ih u stranicu.
import type { Config } from './config.ts';
import { route, type Route } from './detect.ts';
import { text } from './text.ts';

export type Navigate = (url: string, delayMs: number) => void;

/** S ponuđenim paketom korisnik ima vremena kliknuti preuzimanje prije preusmjeravanja. */
export const REDIRECT_DELAY_WITH_PACKAGE_MS = 4000;

export function applyRoute(doc: Document, ua: string, config: Config, navigate: Navigate): Route {
  const r = route(ua, config);
  doc.body.dataset['frontend'] = r.frontend;
  doc.getElementById('open-app')?.setAttribute('href', r.url);
  const offer = doc.getElementById('desktop-offer');
  const link = doc.getElementById('desktop-download');
  if (offer && link && r.desktopPackage && r.downloadUrl) {
    link.setAttribute('href', r.downloadUrl);
    link.textContent = text.download(r.desktopPackage);
    offer.hidden = false;
  }
  navigate(r.url, r.desktopPackage ? REDIRECT_DELAY_WITH_PACKAGE_MS : 0);
  return r;
}
