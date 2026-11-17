// Tekst sučelja (hrvatski, oslovljavanje s „Vi”).
import type { DesktopPackage } from './detect.ts';

export const PACKAGE_LABELS: Record<DesktopPackage, string> = { windows: 'Windows', macos: 'macOS' };

/** Tekst koji treba skripta u pregledniku; odvojen da izgradnja ne ugrađuje ostatak (proračun P-0.1). */
export const clientText = {
  download: (pkg: DesktopPackage) => `Preuzmi Ducturu za ${PACKAGE_LABELS[pkg]}`,
  choiceSaved: 'Izbor je zapamćen u ovom pregledniku.',
  choiceNotSaved: 'Preglednik ne pamti izbor; vrijedi samo na ovoj stranici.',
} as const;

export const text = {
  title: 'Ductura',
  lead: 'Otvaramo Ducturu prilagođenu Vašem uređaju i pregledniku.',
  openApp: 'Otvori Ducturu u pregledniku',
  noscript: 'Bez JavaScripta odaberite sami:',
  choiceTitle: 'Odaberite sami',
  choiceView: 'Prikaz',
  views: { desktop: 'Računalo', mobile: 'Mobitel' },
  choicePackage: 'Desktop paket',
  frontends: { chrome: 'Sučelje za Chrome', mobile: 'Sučelje za mobitel i tablet', other: 'Sučelje za ostale preglednike' },
} as const;

/** Stanja greške (P-0.5); ključ bira `errorViewFor` iz `src/errors/`. */
export const errorText = {
  badRequest: { title: 'Zahtjev nije prihvaćen', body: 'Poslani podaci nisu ispravnog oblika. Učitajte stranicu ponovno.' },
  unauthenticated: { title: 'Potrebna je prijava', body: 'Za nastavak se prijavite.' },
  forbidden: { title: 'Pristup nije dopušten', body: 'Ova stranica nije dostupna Vašem računu.' },
  notFound: { title: 'Stranica ne postoji', body: 'Provjerite adresu ili se vratite na početnu stranicu.' },
  timeout: { title: 'Odgovor nije stigao na vrijeme', body: 'Pokušajte ponovno.' },
  tooManyRequests: { title: 'Previše zahtjeva', body: 'Pričekajte trenutak i pokušajte ponovno.' },
  internal: { title: 'Greška na poslužitelju', body: 'Zahtjev nije izvršen. Pokušajte ponovno za nekoliko minuta.' },
  badGateway: { title: 'Poslužitelj nije odgovorio', body: 'Pokušajte ponovno za nekoliko minuta.' },
  unavailable: { title: 'Ductura trenutačno nije dostupna', body: 'Pokušajte ponovno za nekoliko minuta.' },
  gatewayTimeout: { title: 'Poslužitelj nije odgovorio na vrijeme', body: 'Pokušajte ponovno za nekoliko minuta.' },
  sessionExpired: { title: 'Prijava je istekla', body: 'Za nastavak se ponovno prijavite.' },
  offline: { title: 'Nema veze s mrežom', body: 'Provjerite vezu i pokušajte ponovno.' },
  general: { title: 'Nešto nije u redu', body: 'Pokušajte ponovno ili se vratite na početnu stranicu.' },
} as const;
