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
