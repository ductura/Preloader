// Preneseno iz Ductus src/components/auth/sign-in-link.ts (DAN-994), bez
// signedInRedirect: njemu treba poslužitelj koji čita sesijski kolačić.
import { DEFAULT_RETURN_TO, safeReturnTo } from './return-to.ts';

/**
 * Where a person goes after sign-in when nothing else is asked for: "/".
 * In Ductus that page forwards by role (DAN-325); in the preloader "/" is the
 * entry page itself, which opens the right interface.
 */
export const SIGN_IN_DEFAULT_TARGET = DEFAULT_RETURN_TO;

/**
 * The page to return to after sign-in, from an untrusted `returnTo` value.
 * The login route checks it again (safeReturnTo) and decides: a value that
 * grows past 512 characters once encoded is dropped there, which fails closed.
 */
export function signInTarget(raw: unknown): string {
  return safeReturnTo(raw);
}

/** The login flow (S-1E-a): a plain link, answered with a redirect to AAI@EduHr (D-09). */
export function signInHref(target: string): string {
  return `/api/v1/auth/login?returnTo=${encodeURIComponent(target)}`;
}
