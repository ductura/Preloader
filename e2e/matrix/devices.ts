// Matrica P-0.11: uređaj, motor i očekivani ishod nakon A1 (docs/PLAN.md §6, red „e2e (P-0.11)”).
// Opera se provjerava ručno: Playwright nema njezin motor, a u Chromiumu bi bila samo drugi UA.
import { devices, type PlaywrightTestOptions } from '@playwright/test';

type Engine = 'chromium' | 'firefox' | 'webkit';
type Frontend = 'chrome' | 'mobile' | 'other';

export interface MatrixDevice {
  readonly name: string;
  readonly engine: Engine;
  readonly use: Partial<PlaywrightTestOptions> & Record<string, unknown>;
  /** Automatski prikaz weba. */
  readonly view: 'desktop' | 'mobile';
  /** Sučelje za prikaz računala na ovom pregledniku (putanje iz P-0.1 dok je odluka 1 otvorena). */
  readonly desktopFrontend: Exclude<Frontend, 'mobile'>;
  /** Istaknut paket; `null`: paket nije dostupan, korisnik nastavlja u webu. */
  readonly pkg: 'windows' | 'macos' | null;
  /** Pravi uređaj javlja više dodirnih točaka nego emulacija motora (iPad u desktop načinu). */
  readonly maxTouchPoints?: number;
}

const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
// iPadOS 13+ u zadanom (desktop) načinu šalje UA Safarija na Macu; razlikuje ga samo dodir.
const IPAD_DESKTOP_MODE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const NARROW = { width: 600, height: 900 };

/** Bez `defaultBrowserType`: motor bira projekt. */
function device(name: string): Partial<PlaywrightTestOptions> & Record<string, unknown> {
  const found = devices[name];
  if (!found) throw new Error(`unknown Playwright device: ${name}`);
  const { defaultBrowserType: _engine, ...use } = found;
  return use;
}

export const MATRIX: readonly MatrixDevice[] = [
  { name: 'chrome-windows', engine: 'chromium', use: device('Desktop Chrome'), view: 'desktop', desktopFrontend: 'chrome', pkg: 'windows' },
  { name: 'chrome-mac', engine: 'chromium', use: { ...device('Desktop Chrome'), userAgent: MAC_CHROME }, view: 'desktop', desktopFrontend: 'chrome', pkg: 'macos' },
  { name: 'edge-windows', engine: 'chromium', use: device('Desktop Edge'), view: 'desktop', desktopFrontend: 'other', pkg: 'windows' },
  { name: 'firefox-windows', engine: 'firefox', use: device('Desktop Firefox'), view: 'desktop', desktopFrontend: 'other', pkg: 'windows' },
  { name: 'safari-mac', engine: 'webkit', use: device('Desktop Safari'), view: 'desktop', desktopFrontend: 'other', pkg: 'macos' },
  { name: 'pixel-7', engine: 'chromium', use: device('Pixel 7'), view: 'mobile', desktopFrontend: 'chrome', pkg: null },
  { name: 'iphone', engine: 'webkit', use: device('iPhone 15'), view: 'mobile', desktopFrontend: 'other', pkg: null },
  { name: 'ipad', engine: 'webkit', use: device('iPad (gen 11)'), view: 'mobile', desktopFrontend: 'other', pkg: null },
  {
    name: 'ipad-desktop-mode',
    engine: 'webkit',
    use: { ...device('iPad (gen 11)'), userAgent: IPAD_DESKTOP_MODE, isMobile: false },
    view: 'mobile',
    desktopFrontend: 'other',
    pkg: null,
    maxTouchPoints: 5,
  },
  { name: 'window-600-chromium', engine: 'chromium', use: { ...device('Desktop Chrome'), viewport: NARROW }, view: 'desktop', desktopFrontend: 'chrome', pkg: 'windows' },
  { name: 'window-600-firefox', engine: 'firefox', use: { ...device('Desktop Firefox'), viewport: NARROW }, view: 'desktop', desktopFrontend: 'other', pkg: 'windows' },
  { name: 'window-600-webkit', engine: 'webkit', use: { ...device('Desktop Safari'), viewport: NARROW }, view: 'desktop', desktopFrontend: 'other', pkg: 'macos' },
];

export function matrixDevice(name: string): MatrixDevice {
  const found = MATRIX.find((d) => d.name === name);
  if (!found) throw new Error(`project ${name} is not in the matrix`);
  return found;
}
