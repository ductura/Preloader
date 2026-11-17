// Preneseno iz Ductus src/components/auth/sign-in-link.ts (DAN-994), bez
// signedInRedirect: njemu treba poslužitelj koji čita sesijski kolačić.
import { DEFAULT_RETURN_TO, safeReturnTo } from './return-to.ts';

/**
 * Where /prijava sends a person after sign-in when nothing else is asked for:
 * the home page, which sends a signed-in person on to their own page by the
 * role the database knows (DAN-325).
 */
export const SIGN_IN_DEFAULT_TARGET = DEFAULT_RETURN_TO;

/**
 * The page to return to after sign-in, from the untrusted `returnTo` query of
 * /prijava. The login route checks it again (safeReturnTo); this only keeps
 * the link on the page from carrying what that route would discard.
 */
export function signInTarget(raw: unknown): string {
  return safeReturnTo(raw);
}

/** The login flow (S-1E-a): a plain link, answered with a redirect to AAI@EduHr (D-09). */
export function signInHref(target: string): string {
  return `/api/v1/auth/login?returnTo=${encodeURIComponent(target)}`;
}
