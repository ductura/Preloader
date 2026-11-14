// Sve na jednoj domeni: ductura.org. Putanje su relativne, pa stranica ne zove drugi poslužitelj.
export interface Config {
  frontends: { chrome: string; mobile: string; other: string };
  downloads: { windows: string; macos: string };
}

export const defaultConfig: Config = {
  frontends: {
    chrome: '/app/chrome/',
    mobile: '/app/mobile/',
    other: '/app/web/',
  },
  downloads: {
    windows: '/download/Ductura-Setup-x64.exe',
    macos: '/download/Ductura-macOS.dmg',
  },
};
