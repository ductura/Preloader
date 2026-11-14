// Tekst sučelja (hrvatski, oslovljavanje s „Vi”).
import type { DesktopPackage } from './detect.ts';

export const PACKAGE_LABELS: Record<DesktopPackage, string> = { windows: 'Windows', macos: 'macOS' };

export const text = {
  title: 'Ductura',
  lead: 'Otvaramo Ducturu prilagođenu Vašem uređaju i pregledniku.',
  openApp: 'Otvori Ducturu u pregledniku',
  download: (pkg: DesktopPackage) => `Preuzmi Ducturu za ${PACKAGE_LABELS[pkg]}`,
  noscript: 'Bez JavaScripta odaberite sami:',
  frontends: { chrome: 'Sučelje za Chrome', mobile: 'Sučelje za mobitel i tablet', other: 'Sučelje za ostale preglednike' },
} as const;
