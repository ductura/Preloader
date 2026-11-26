// Tekst koji treba skripta prvog ekrana u pregledniku (hrvatski, oslovljavanje s „Vi”); ostatak je u `text.ts`.
import type { DesktopPackage } from './detect.ts';

export const PACKAGE_LABELS: Record<DesktopPackage, string> = { windows: 'Windows', macos: 'macOS' };

/** Tekst koji treba skripta u pregledniku; odvojen da izgradnja ne ugrađuje ostatak (proračun P-0.1). */
export const clientText = {
  download: (pkg: DesktopPackage) => `Preuzmi Ducturu za ${PACKAGE_LABELS[pkg]}`,
  countdown: (seconds: number) => `Otvaramo Ducturu za ${seconds} s.`,
  stayed: 'Ostajete na ovoj stranici.',
  stay: 'Ostani ovdje',
  choiceSaved: 'Izbor je zapamćen u ovom pregledniku.',
  choiceNotSaved: 'Preglednik ne pamti izbor; vrijedi samo na ovoj stranici.',
} as const;
