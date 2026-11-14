// Pomoćne funkcije: prepoznavanje uređaja, preglednika i odgovarajućeg sučelja.

/** @returns {'android'|'ios'|'windows'|'macos'|'linux'|'other'} */
export function detectOs(ua = '') {
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Windows NT/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macos';
  if (/Linux|X11/i.test(ua)) return 'linux';
  return 'other';
}

/** Redoslijed je bitan: Edge i Opera u UA-u sadrže i "Chrome". */
export function detectBrowser(ua = '') {
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'edge';
  if (/OPR\/|Opera/.test(ua)) return 'opera';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}

export function isMobile(ua = '') {
  // iPadOS 13+ se predstavlja kao Mac; takav se prepoznaje po klijentu (vidi README).
  return /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
}

/** @returns {'chrome'|'mobile'|'other'} */
export function chooseFrontend(ua = '') {
  if (isMobile(ua)) return 'mobile';
  return detectBrowser(ua) === 'chrome' ? 'chrome' : 'other';
}

/** @returns {'windows'|'macos'|null} desktop paket koji se nudi, ako postoji */
export function desktopPackageFor(ua = '') {
  if (isMobile(ua)) return null;
  const os = detectOs(ua);
  return os === 'windows' || os === 'macos' ? os : null;
}

export function route(ua, config) {
  const frontend = chooseFrontend(ua);
  const desktopPackage = desktopPackageFor(ua);
  return {
    frontend,
    url: config.frontends[frontend],
    desktopPackage,
    downloadUrl: desktopPackage ? config.downloads[desktopPackage] : null,
  };
}
