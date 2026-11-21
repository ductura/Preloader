import type { DesktopDownload } from '../../src/downloads/manifest.ts';

export const fullManifest = {
  packages: [
    { system: 'macos', architecture: 'arm64', url: '/preuzimanje/proba-arm64.dmg', version: '1.0.0', sha256: 'a'.repeat(64) },
    { system: 'macos', architecture: 'x64', url: '/preuzimanje/proba-x64.dmg', version: '1.0.0', sha256: 'b'.repeat(64) },
    { system: 'windows', architecture: 'arm64', url: '/preuzimanje/proba-arm64.msi', version: '1.0.0', sha256: 'c'.repeat(64) },
    { system: 'windows', architecture: 'x64', url: 'https://paketi.example.invalid/proba-x64.msi', version: '1.0.0', sha256: 'd'.repeat(64) },
  ] satisfies DesktopDownload[],
};
