// @vitest-environment happy-dom
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import Page, { getServerSideProps } from '../../pages/preuzimanje.tsx';
import { defaultConfig } from '../../src/config.ts';
import { parseManifest } from '../../src/downloads/manifest.ts';
import { fullManifest } from './fixture.ts';

const [first, , ...windows] = fullManifest.packages;
const continueOnWeb = ['Nastavi u webu', defaultConfig.frontends.web, false];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function visit(sustav: string | string[] | undefined, response: Response) {
  const request = vi.fn<typeof fetch>().mockResolvedValue(response);
  vi.stubEnv('INSTITUTION_SERVER_URL', 'http://127.0.0.1:4000/');
  vi.stubGlobal('fetch', request);
  const req = Object.assign(new IncomingMessage(new Socket()), { cookies: {} });
  const res = new ServerResponse(req);
  const result = await getServerSideProps({
    req,
    res,
    resolvedUrl: '/preuzimanje',
    query: sustav === undefined ? {} : { sustav },
  });
  if (!('props' in result)) throw new Error('Očekuje se HTML stranica');
  const html = renderToStaticMarkup(createElement(Page, await result.props));
  const document = new DOMParser().parseFromString(html, 'text/html');
  expect(document.querySelector('script, form, iframe, [http-equiv="refresh"]')).toBeNull();
  expect(res.getHeader('Cache-Control')).toBe('no-store');
  expect(request).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:4000/api/v1/downloads/manifest',
    expect.objectContaining({ method: 'GET', redirect: 'manual', cache: 'no-store', credentials: 'omit' }));
  return [...document.querySelectorAll('main a')].map((a) => [
    a.textContent, a.getAttribute('href'), a.hasAttribute('download'),
  ]);
}

test('prvi ekran nudi odabir sustava kroz stranicu manifesta', () => {
  expect(defaultConfig.downloads).toEqual({
    macos: '/preuzimanje?sustav=macos',
    windows: '/preuzimanje?sustav=windows',
  });
});

test('puni manifest nudi četiri paketa, a odabir sustava sužava popis', async () => {
  const mac = [
    ['Preuzmi za macOS (arm64)', fullManifest.packages[0]!.url, true],
    ['Preuzmi za macOS (x64)', fullManifest.packages[1]!.url, true],
  ];
  expect(await visit(undefined, Response.json(fullManifest))).toEqual([
    ...mac,
    ['Preuzmi za Windows (arm64)', windows[0]!.url, true],
    ['Preuzmi za Windows (x64)', windows[1]!.url, true],
    continueOnWeb,
  ]);
  expect(await visit('macos', Response.json(fullManifest))).toEqual([...mac, continueOnWeb]);
});

test.each([
  ['prazan manifest', { packages: [] }],
  ['manifest bez macOS retka', { packages: windows }],
  ['neispravan manifest', { packages: [{ ...first, architecture: 'mips' }, ...windows] }],
])('%s nudi nastavak u webu za macOS', async (_label, body) => {
  expect(await visit('macos', Response.json(body))).toEqual([continueOnWeb]);
});

test('503 i nevaljani JSON nude nastavak u webu', async () => {
  expect(await visit('windows', Response.json(fullManifest, { status: 503 }))).toEqual([continueOnWeb]);
  expect(await visit(undefined, new Response('{', { headers: { 'content-type': 'application/json' } })))
    .toEqual([continueOnWeb]);
});

test.each([
  ['višak ključa manifesta', { ...fullManifest, extra: true }],
  ['manjak ključa manifesta', {}],
  ['višak ključa retka', { packages: [{ ...first, extra: true }, ...windows] }],
  ['manjak ključa retka', { packages: [{ ...first, sha256: undefined }, ...windows] }],
  ['krivi sustav', { packages: [{ ...first, system: 'linux' }, ...windows] }],
  ['kriva arhitektura', { packages: [{ ...first, architecture: 'x86' }, ...windows] }],
  ['krivi oblik poveznice', { packages: [{ ...first, url: '//paketi.example.invalid/proba.dmg' }, ...windows] }],
  ['ponovljen par', { packages: [first, first] }],
  ['krivi redoslijed', { packages: [...windows, first] }],
])('provjera odbija cijeli manifest za %s', (_label, body) => {
  expect(parseManifest(body)).toBeNull();
});
