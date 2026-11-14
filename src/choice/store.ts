// Pamćenje ručnog izbora u pregledniku (localStorage, nikad kolačić). Upisuje se samo na klik korisnika.
import type { DesktopPackage } from '../detect.ts';
import type { View } from '../detect/view.ts';

/** Najmanji dio `Storage` sučelja koji se koristi; zamjenjiv u testovima. */
export interface ChoiceStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Ručni izbor; polje koje nedostaje znači da korisnik nije birao. */
export interface Choice {
  readonly view?: View | undefined;
  readonly package?: DesktopPackage | undefined;
}

export const STORAGE_KEY = 'ductura.choice';
/** Promjena oblika zapisa povećava verziju; stariji zapisi se zanemaruju. */
export const CHOICE_VERSION = 1;

const VIEWS: readonly string[] = ['desktop', 'mobile'];
const PACKAGES: readonly string[] = ['windows', 'macos'];

const isView = (v: unknown): v is View => typeof v === 'string' && VIEWS.includes(v);
const isPackage = (v: unknown): v is DesktopPackage => typeof v === 'string' && PACKAGES.includes(v);

/** Privatni prozor ili blokirana pohrana mogu baciti već pri čitanju `localStorage`. */
export function browserStore(win: { readonly localStorage?: ChoiceStore }): ChoiceStore | null {
  try {
    return win.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Zapamćeni izbor; nevaljan, zastario ili nedostupan zapis daje prazan izbor. Nikad ne baca. */
export function readChoice(store: ChoiceStore | null): Choice {
  try {
    const data: unknown = JSON.parse(store?.getItem(STORAGE_KEY) ?? 'null');
    if (typeof data === 'object' && data !== null) {
      const { v, view, package: pkg } = data as Record<string, unknown>;
      if (v === CHOICE_VERSION) return { view: isView(view) ? view : undefined, package: isPackage(pkg) ? pkg : undefined };
    }
  } catch {
    // Privatni prozor ili krivi JSON: kao da izbora nema.
  }
  return {};
}

/** Pamti izbor; `false` ako pohrana nije dostupna (izbor tada vrijedi samo na ovoj stranici). */
export function writeChoice(store: ChoiceStore | null, choice: Choice): boolean {
  if (!store) return false;
  try {
    // `JSON.stringify` izostavlja polja bez vrijednosti.
    store.setItem(STORAGE_KEY, JSON.stringify({ v: CHOICE_VERSION, view: choice.view, package: choice.package }));
    return true;
  } catch {
    return false;
  }
}
