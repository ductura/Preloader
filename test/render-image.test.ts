// Neobavezna Render slika (deploy/render) i vercel.json: ista pravila kao lokalni edge.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contentSecurityPolicyFor } from '../deploy/edge/index.ts';
import { cspMap, PAGES } from '../deploy/render/csp-map.ts';
import { build } from '../scripts/build.ts';

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('CSP mapa za nginx', () => {
  let dist = '';
  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), 'preloader-render-'));
    await build(dist);
  });
  afterAll(() => rmSync(dist, { recursive: true, force: true }));

  it('svaka stranica dobiva točno politiku lokalnog edgea', async () => {
    const map = await cspMap(dist);
    for (const [file, paths] of Object.entries(PAGES)) {
      const policy = await contentSecurityPolicyFor(readFileSync(join(dist, file), 'utf8'));
      for (const path of paths) expect(map).toContain(`  ${path} "${policy}";\n`);
    }
    expect(map.startsWith('map $uri $ductura_csp {\n  default "";\n')).toBe(true);
    expect(map.endsWith('}\n')).toBe(true);
  });

  it('stranica s drugom skriptom ruši gradnju slike', async () => {
    const bad = mkdtempSync(join(tmpdir(), 'preloader-render-bad-'));
    try {
      writeFileSync(join(bad, 'index.html'), '<style>a{}</style><script>1</script><script>2</script>');
      writeFileSync(join(bad, 'greska.html'), readFileSync(join(dist, 'greska.html')));
      await expect(cspMap(bad)).rejects.toThrow(/exactly one <script>/);
    } finally {
      rmSync(bad, { recursive: true, force: true });
    }
  });
});

describe('vercel.json', () => {
  const config = JSON.parse(read('vercel.json')) as {
    outputDirectory: string;
    rewrites: { source: string; destination: string }[];
  };

  it('poslužuje dist kao postojeći projekt', () => {
    expect(config.outputDirectory).toBe('dist');
  });

  it('prosljeđuje rute ugovora samo na https rezervirane hostove .invalid dok se ne upišu prave adrese', () => {
    const sources = config.rewrites.map((r) => r.source);
    expect(sources).toEqual([
      '/admin',
      '/admin/:path*',
      '/api/v1/:path*',
      '/app/web',
      '/app/web/:path*',
      '/app/chrome',
      '/app/chrome/:path*',
    ]);
    for (const { source, destination } of config.rewrites) {
      const url = new URL(destination);
      expect(url.protocol).toBe('https:');
      expect(url.hostname.endsWith('.invalid') || !url.hostname.startsWith('zamijeni-')).toBe(true);
      // Putanja se prosljeđuje nepromijenjena, kao na lokalnom edgeu.
      expect(url.pathname.replace(/\/$/, '')).toBe(source);
    }
  });
});

describe('deploy/render', () => {
  const dockerfile = read('deploy/render/Dockerfile');
  const template = read('deploy/render/default.conf.template');

  it('slika radi kao neprivilegirani korisnik, a bazne slike su prikvačene digestom', () => {
    expect(dockerfile).toMatch(/^USER 101\s*$/m);
    for (const from of dockerfile.match(/^FROM .+$/gm) ?? []) expect(from).toMatch(/@sha256:[0-9a-f]{64}/);
  });

  it('nginx sluša na $PORT i ima rute lokalnog edgea', () => {
    expect(template).toContain('listen ${PORT};');
    for (const route of ['= /admin', '/admin/', '/api/v1/', '= /app/web', '/app/web/', '= /app/chrome', '/app/chrome/']) {
      expect(template).toContain(`location ${route} {`);
    }
    expect(template).toContain('add_header Content-Security-Policy $ductura_csp always;');
  });

  it('kontekst gradnje ne uključuje .env datoteke', () => {
    const ignore = read('.dockerignore').split(/\r?\n/);
    for (const entry of ['.env', '.env.*', '**/.env', '**/.env.*', 'node_modules']) expect(ignore).toContain(entry);
  });
});
