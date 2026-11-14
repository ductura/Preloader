// Sve na jednoj domeni: ductura.org. Putanje se mogu promijeniti varijablama okoline.
export const defaultConfig = {
  frontends: {
    chrome: process.env.FRONTEND_CHROME ?? '/app/chrome/',
    mobile: process.env.FRONTEND_MOBILE ?? '/app/mobile/',
    other: process.env.FRONTEND_OTHER ?? '/app/web/',
  },
  downloads: {
    windows: process.env.DOWNLOAD_WINDOWS ?? '/download/Ductura-Setup-x64.exe',
    macos: process.env.DOWNLOAD_MACOS ?? '/download/Ductura-macOS.dmg',
  },
};
