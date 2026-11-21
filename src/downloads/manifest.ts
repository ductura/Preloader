import type { Operations } from '@ductura/contracts';
import openapi from '@ductura/contracts/openapi/v1.json';
import Ajv from 'ajv';
import { serviceOrigin, type ServiceEnv } from '../rewrites.ts';

const MANIFEST_PATH = '/api/v1/downloads/manifest';
const SERVER_URL = 'INSTITUTION_SERVER_URL';
type Manifest = Operations['downloads.manifest.get']['success']['body'];
export type DesktopDownload = Manifest['packages'][number];

const successSchema = openapi.paths[MANIFEST_PATH].get.responses['200'].content['application/json'].schema;
const isManifest = new Ajv({ ownProperties: true }).compile<Manifest>(successSchema);

export function parseManifest(body: unknown): Manifest | null {
  if (!isManifest(body)) return null;
  // Server jamči strogi poredak po sustavu pa arhitekturi, ujedno i jedinstvenost svakog para.
  let previous = '';
  for (const { system, architecture } of body.packages) {
    const target = `${system}/${architecture}`;
    if (target <= previous) return null;
    previous = target;
  }
  return body;
}

export async function loadManifest(
  get: typeof fetch = fetch,
  env: ServiceEnv = process.env,
): Promise<DesktopDownload[]> {
  const upstream = env[SERVER_URL];
  if (!upstream) return [];
  try {
    const response = await get(serviceOrigin(SERVER_URL, upstream) + MANIFEST_PATH, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'manual',
      signal: AbortSignal.timeout(3000),
    });
    const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (response.status !== 200 || response.redirected || mediaType !== 'application/json') return [];
    return parseManifest(await response.json())?.packages ?? [];
  } catch {
    return [];
  }
}
