// Ulaz u odluke: samo zatvoren skup signala iz preglednika, bez otiska preglednika.

/** Client hints niske entropije (`navigator.userAgentData`). */
export interface ClientHints {
  readonly mobile: boolean;
  readonly platform: string;
}

/** Sve što odluke smiju znati o okruženju. Ništa drugo ne ulazi. */
export interface Signals {
  readonly userAgent: string;
  readonly hints?: ClientHints | undefined;
  readonly maxTouchPoints?: number | undefined;
}

/** Dio `navigator` objekta koji se čita; `userAgentData` nije u svim preglednicima. */
export interface NavigatorLike {
  readonly userAgent: string;
  readonly maxTouchPoints?: number;
  readonly userAgentData?: unknown;
}

function readHints(data: unknown): ClientHints | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const { mobile, platform } = data as Record<string, unknown>;
  return typeof mobile === 'boolean' && typeof platform === 'string' ? { mobile, platform } : undefined;
}

/** Čita signale iz preglednika i propušta samo dopuštena polja ispravnog tipa. */
export function signalsFrom(nav: NavigatorLike): Signals {
  const touch = nav.maxTouchPoints;
  return {
    userAgent: typeof nav.userAgent === 'string' ? nav.userAgent : '',
    hints: readHints(nav.userAgentData),
    maxTouchPoints: typeof touch === 'number' && Number.isFinite(touch) && touch >= 0 ? touch : undefined,
  };
}
