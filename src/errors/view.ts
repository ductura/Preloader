// Ključ teksta za stanje greške (DAN-993, dio 1 P-0.5). Čista funkcija, bez DOM-a.
import type { errorText } from '../text.ts';

export type ErrorTextKey = keyof typeof errorText;

/**
 * Tablica prema `errors` iz `@ductura/contracts/errors/catalog.json` (ERROR_CATALOG); ključ je zadnji dio
 * `messageKey`. 401 ima dva unosa: status 401 je `unauthenticated`, a kod `session_expired` bira se nizom.
 * `offline` nije u katalogu: stanje klijenta kad mreža ne odgovori. Test uspoređuje tablicu s katalogom.
 */
const VIEWS: ReadonlyMap<number | string, ErrorTextKey> = new Map<number | string, ErrorTextKey>([
  [400, 'badRequest'],
  [401, 'unauthenticated'],
  [403, 'forbidden'],
  [404, 'notFound'],
  [408, 'timeout'],
  [429, 'tooManyRequests'],
  [500, 'internal'],
  [502, 'badGateway'],
  [503, 'unavailable'],
  [504, 'gatewayTimeout'],
  ['session_expired', 'sessionExpired'],
  ['offline', 'offline'],
]);

/** Svi ulazi koje tablica prepoznaje. */
export const ERROR_VIEW_INPUTS: readonly (number | string)[] = [...VIEWS.keys()];

/**
 * Pozivatelj predaje `body.code` kad je `session_expired`, inače HTTP status; `offline` kad mreža ne odgovori.
 * Sve ostalo (drugi status, broj kao niz, niz s razmakom, naslijeđeni ključ) daje opći prikaz.
 */
export function errorViewFor(status: number | string): ErrorTextKey {
  return VIEWS.get(status) ?? 'general';
}
