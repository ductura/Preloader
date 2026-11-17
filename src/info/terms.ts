// Provjera javnog teksta za /info/: bez imena ustanove (PLAN §1 (3e), D-302) i bez zabranjenih izraza
// (Ductus docs/PRODUCT.md §5 „Rječnik sučelja”, b36c82b9). Izraz je regex (`u`) nad normaliziranim tekstom, bez granice riječi.

/** Korijeni imena ustanova. */
export const INSTITUTION_TERMS: readonly string[] = [
  'fpzg', 'fakultet', 'sveučiliš', 'veleučiliš', 'visok\\p{L}* škol', 'akademij', 'institut', 'ustanov',
];

/**
 * Zatvoren popis iz hrvatskog stupca Rječnika. Sami `ljudsk`, `dokaz`, `izvor` i `ai` nisu na popisu:
 * redak tablice ih zabranjuje samo u kontekstu koji podniz ne vidi („ni ljudski ni strojno” je dopušteno).
 */
export const FORBIDDEN_TERMS: readonly string[] = [
  'sumnj', 'rizi', 'anomalij', 'upozorenje o student', 'vjerojatn', 'autentičn', 'autenticitet',
  'kopiran', 'prepisan', 'prepisiv', 'tuđi tekst', 'tuđe riječi', 'nestal', 'skriven', 'sakriven', 'prikriven',
  'nedostajuć', 'izgubljen', 'plagij', 'plagir', 'izvornost', 'originalnost', 'integritet', 'neobičn',
  'neuobičajen', 'nepravilnost', 'napisao ai', 'ai postot', 'postotak ai', 'udio ai', 'ljudski udio',
  'postotak ljudskosti', 'verificirano autorstvo', 'dokaz autorstva', 'ljudski napisan', 'napisao čovjek',
];

/** NFKC, bez nevidljivih (`\p{Cf}`) i kontrolnih znakova, jedan razmak, mala slova. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\p{Cf}\u0000-\u0008\u000e-\u001f\u007f-\u009f]/gu, '')
    .replace(/\s+/gu, ' ')
    .toLowerCase();
}

/** Jedna poruka po nalazu; prazan niz znači da je tekst dopušten. */
export function publicTextProblems(texts: readonly string[]): string[] {
  const problems: string[] = [];
  for (const raw of texts) {
    const text = normalizeText(raw);
    // Slovo izvan latinice (npr. ćirilično „\u0430”) moglo bi sakriti izraz.
    if (/(?!\p{Script=Latin})\p{L}/u.test(text)) problems.push(`slovo izvan latinice: ${raw}`);
    for (const term of [...INSTITUTION_TERMS, ...FORBIDDEN_TERMS]) {
      if (new RegExp(term, 'u').test(text)) problems.push(`„${term}”: ${raw}`);
    }
    // „Spremljeno” uvijek kaže gdje (Rječnik: „spremljeno (bez pojašnjenja)”).
    for (const m of text.matchAll(/spremljen\p{L}*/gu)) {
      const rest = text.slice(m.index + m[0].length);
      if (!rest.startsWith(' na uređaju') && !rest.startsWith(' na poslužitelju')) {
        problems.push(`„spremljeno” bez mjesta: ${raw}`);
      }
    }
  }
  return problems;
}

/** Svi nizovi ugniježđenog bloka teksta. */
export const textsOf = (block: unknown): string[] =>
  typeof block === 'string' ? [block] : block && typeof block === 'object' ? Object.values(block).flatMap(textsOf) : [];

/** Baca grešku s popisom nalaza; izgradnja tada pada. */
export function assertPublicText(texts: readonly string[]): void {
  const problems = publicTextProblems(texts);
  if (problems.length > 0) throw new Error(`tekst za /info/ nije dopušten:\n${problems.join('\n')}`);
}
