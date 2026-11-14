// Druga odluka: ponuđeni desktop paket. Najviše jedan; mobilni prikaz ga nema.
import type { DesktopPackage } from '../detect.ts';
import type { Signals } from './signals.ts';
import { chooseView, resolvePlatform } from './view.ts';

/** `null`: nema ponuđenog paketa (mobilni prikaz, Linux ili nepoznat sustav, ručni izbor). */
export function choosePackage(s: Signals): DesktopPackage | null {
  if (chooseView(s) === 'mobile') return null;
  const os = resolvePlatform(s);
  return os === 'windows' || os === 'macos' ? os : null;
}
