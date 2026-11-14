// Pomoćne funkcije: prepoznavanje uređaja, preglednika i odgovarajućeg sučelja.
import type { Config } from './config.ts';

export type Os = 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'other';
export type Browser = 'edge' | 'opera' | 'firefox' | 'chrome' | 'safari' | 'other';
export type Frontend = 'chrome' | 'mobile' | 'other';
export type DesktopPackage = 'windows' | 'macos';

export interface Route {
  frontend: Frontend;
  url: string;
  desktopPackage: DesktopPackage | null;
  downloadUrl: string | null;
}

export function detectOs(ua = ''): Os {
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Windows NT/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macos';
  if (/Linux|X11/i.test(ua)) return 'linux';
  return 'other';
}

/** Redoslijed je bitan: Edge i Opera u UA-u sadrže i "Chrome". */
export function detectBrowser(ua = ''): Browser {
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'edge';
  if (/OPR\/|Opera/.test(ua)) return 'opera';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}

export function isMobile(ua = ''): boolean {
  // iPadOS 13+ se predstavlja kao Mac; takav se prepoznaje po klijentu (vidi README).
  return /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
}

export function chooseFrontend(ua = ''): Frontend {
  if (isMobile(ua)) return 'mobile';
  return detectBrowser(ua) === 'chrome' ? 'chrome' : 'other';
}

/** Desktop paket koji se nudi, ako postoji. */
export function desktopPackageFor(ua = ''): DesktopPackage | null {
  if (isMobile(ua)) return null;
  const os = detectOs(ua);
  return os === 'windows' || os === 'macos' ? os : null;
}

export function route(ua: string, config: Config): Route {
  const frontend = chooseFrontend(ua);
  const desktopPackage = desktopPackageFor(ua);
  return {
    frontend,
    url: config.frontends[frontend],
    desktopPackage,
    downloadUrl: desktopPackage ? config.downloads[desktopPackage] : null,
  };
}
