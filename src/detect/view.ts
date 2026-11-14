// Prva odluka: prikaz weba (računalo ili mobitel). Redom: client hints, mogućnosti, UA zadnji.
import { detectOs, isMobile, type Os } from '../detect.ts';
import type { Signals } from './signals.ts';

export type View = 'desktop' | 'mobile';

const HINT_PLATFORMS: Readonly<Record<string, Os>> = {
  android: 'android',
  ios: 'ios',
  windows: 'windows',
  macos: 'macos',
  linux: 'linux',
  'chrome os': 'linux',
  'chromium os': 'linux',
};

/** iPadOS u desktop načinu šalje UA Maca; pravi Mac nema više dodirnih točaka. */
const isTouchMac = (s: Signals): boolean => (s.maxTouchPoints ?? 0) > 1;

/** Sustav iz signala; client hints pobjeđuju UA kad se ne slažu. */
export function resolvePlatform(s: Signals): Os {
  const hinted = s.hints ? HINT_PLATFORMS[s.hints.platform.trim().toLowerCase()] : undefined;
  const os = hinted ?? detectOs(s.userAgent);
  return os === 'macos' && isTouchMac(s) ? 'ios' : os;
}

export function chooseView(s: Signals): View {
  const os = resolvePlatform(s);
  // Tablet je mobilni prikaz: Android tablet u hintsima javlja `mobile: false`.
  if (os === 'android' || os === 'ios') return 'mobile';
  if (s.hints) return s.hints.mobile ? 'mobile' : 'desktop';
  return isMobile(s.userAgent) ? 'mobile' : 'desktop';
}
