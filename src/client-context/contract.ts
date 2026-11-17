// Vendorirana kopija iz ductura/server `server/contracts/routes/client.ts` (ruta `client.context.post`),
// main 7c0b8ec949b48ee337a94f2ce6453f1643267851. Paket `@ductura/contracts` se ne objavljuje;
// kad se počne objavljivati, kopija se zamjenjuje paketom (zaseban zadatak). Ne mijenjati ručno.

/** Zatvorene liste vrijednosti tijela; server odbija sve ostalo (400 invalid_input). */
export const CLIENT_CONTEXT_VALUES = {
  app: ['web', 'desktop'],
  os: ['windows', 'macos', 'linux', 'android', 'ios', 'other'],
  browser: ['chromium', 'firefox', 'safari', 'other'],
  device: ['desktop', 'tablet', 'phone', 'other'],
  // Širina prozora: compact ispod 600 px, medium 600 do 839, expanded od 840.
  screen: ['compact', 'medium', 'expanded'],
} as const;

/** major.minor.patch, samo znamenke, bez vodeće nule. */
export const CLIENT_APP_VERSION_PATTERN =
  '^(?:0|[1-9][0-9]{0,5})\\.(?:0|[1-9][0-9]{0,5})\\.(?:0|[1-9][0-9]{0,5})$';

export const CLIENT_CONTEXT_PATH = '/api/v1/client-context';
/** `request.maxBodyBytes` rute. */
export const CLIENT_CONTEXT_MAX_BYTES = 256;

type Lists = typeof CLIENT_CONTEXT_VALUES;
/** Tijelo rute (kao `ClientContext` u `server/http/client-context.ts`). */
export type ClientContext = { readonly [K in keyof Lists]: Lists[K][number] } & { readonly appVersion: string };
