// Provjera javnog teksta za /info/: bez imena ustanove (PLAN §1 (3e), D-302) i bez zabranjenih izraza
// (Ductus docs/PRODUCT.md §5 „Rječnik sučelja”, b36c82b9, hrvatski stupac). Izraz je regex (`u`) nad
// sklopljenim tekstom (bez dijakritika, mala slova), bez granice riječi; `\p{L}{0,4}` je padežni nastavak.

/** Korijeni imena ustanova. Ostale kratice (npr. `fer`) nisu pokrivene: davale bi lažne pogotke. */
export const INSTITUTION_TERMS: readonly string[] = [
  'fpzg', 'ffzg', 'unizg', 'fakultet', 'facult', 'sveucilis', 'veleucilis', 'univerzitet', 'universit',
  'visokoskol', 'akademij', 'institut', 'ustanov',
];

/**
 * Jednorječni korijeni iz Rječnika: svi oblici i složenice retka (PRODUCT §5), pa namjerno obaraju i dopuštene
 * radnje („Kopiraj navod”, „Sakrij”). Sami `ljudsk`, `dokaz`, `izvor` i `ai` nisu na popisu: redak ih zabranjuje
 * samo u kontekstu koji podniz ne vidi („ni ljudski ni strojno” je dopušteno), pa su u parovima.
 */
export const FORBIDDEN_TERMS: readonly string[] = [
  'sumnj', 'rizi', 'anomal', 'vjerojatn', 'autentic', 'kopira', 'prepis', 'nesta', 'skriv', 'sakri', 'prikri',
  'nedostaj', 'izgub', 'plagi', 'izvornos', 'originalnos', 'integritet', 'neobic', 'neuobicajen', 'nepravil',
  // Broj ili % uz AI, ljudsko, podrijetlo ili izvor, u oba reda.
  '(\\d|%)\\s?(ai|ljudsk|podrijet|izvor)', '(ai|ljudsk|podrijet|izvor)\\p{L}{0,4}\\s?(\\d|%)',
];

/**
 * Višerječni izrazi kao par korijena: oba reda riječi, nastavak na svakom korijenu, do dvije kratke riječi
 * između („Tekst je tuđi.”) i spojena slova bez razmaka („tuđitekst”).
 */
export const TERM_PAIRS: readonly (readonly [string, string])[] = [
  ['visok', 'skol'], ['upozor', 'student'], ['tud', 'tekst'], ['tud', 'rijec'], ['nije', '(vlastit|njegov|njezin)'],
  ['napisa', 'ai'], ['ai', 'postot'], ['ai', 'ud(i|j)'], ['ljudsk', 'ud(i|j)'], ['ljudskos', 'postot'],
  ['(verificir|verifikac)', 'autorstv'], ['dokaz', 'autorstv'], ['ljudsk', 'napisa'], ['covjek', 'napisa'],
];

/** Bez nevidljivih znakova (`\p{Cf}`), kontrolni znak je razmak, NFKD bez oznaka (`\p{M}`), mala slova, jedan razmak. */
export function normalizeText(text: string): string {
  return text
    .replace(/\p{Cf}/gu, '')
    .replace(/\p{Cc}/gu, ' ')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ı/gu, 'i')
    .replace(/đ/gu, 'd')
    .replace(/\s+/gu, ' ');
}

const pairPattern = (x: string, y: string, between: string): string => `${x}\\p{L}{0,5}${between}${y}`;
const patterns = [
  ...[...INSTITUTION_TERMS, ...FORBIDDEN_TERMS].map((term) => ({
    term,
    spaced: new RegExp(term, 'u'),
    // I nad tekstom samo od slova (`fakul-tet`, `F.P.Z.G.`).
    compact: new RegExp(term, 'u') as RegExp | null,
  })),
  ...TERM_PAIRS.map(([x, y]) => ({
    term: `${x} + ${y}`,
    // Do dvije kratke riječi između („AI ga je napisao”) ili ništa unutar iste riječi („aipostotak”).
    spaced: new RegExp(`${pairPattern(x, y, ' ?(\\p{L}{1,4} ){0,2}')}|${pairPattern(y, x, ' ?(\\p{L}{1,4} ){0,2}')}`, 'u'),
    // Spojena slova pokriva prazno „između”; nad tekstom samo od slova par bi hvatao preko granica riječi.
    compact: null,
  })),
];

/** Jedna poruka po nalazu; prazan niz znači da je tekst dopušten. */
export function publicTextProblems(texts: readonly string[]): string[] {
  const problems: string[] = [];
  for (const raw of texts) {
    if (/[\p{Co}\p{Cn}\p{Cs}]/u.test(raw)) problems.push(`privatni, nedodijeljeni ili osamljeni znak: ${raw}`);
    const text = normalizeText(raw);
    const words = text.replace(/[^\p{L}\d% ]/gu, ' ').replace(/ +/g, ' ');
    const letters = text.replace(/\P{L}/gu, '');
    // Slovo izvan latinice (npr. ćirilično „а”) moglo bi sakriti izraz.
    if (/(?!\p{Script=Latin})\p{L}/u.test(text)) problems.push(`slovo izvan latinice: ${raw}`);
    for (const { term, spaced, compact } of patterns) {
      if (spaced.test(words) || compact?.test(letters)) problems.push(`„${term}”: ${raw}`);
    }
    // „Spremljeno” uvijek kaže gdje (Rječnik: „spremljeno (bez pojašnjenja)”).
    for (const m of text.matchAll(/spremljen\p{L}*/gu)) {
      const rest = text.slice(m.index + m[0].length);
      if (!rest.startsWith(' na uredaju') && !rest.startsWith(' na posluzitelju')) {
        problems.push(`„spremljeno” bez mjesta: ${raw}`);
      }
    }
  }
  return problems;
}

/** Svi nizovi bloka teksta; dopušteni su samo niz znakova, polje i običan objekt, inače greška. */
export function textsOf(block: unknown, seen: ReadonlySet<object> = new Set()): string[] {
  if (typeof block === 'string') return [block];
  const fail = (why: string): never => {
    throw new Error(`tekst za /info/ nije dopušten: ${why}`);
  };
  if (block === null || typeof block !== 'object') return fail(`vrijednost ${String(block)}`);
  if (seen.has(block)) return fail('ciklus');
  const proto = Object.getPrototypeOf(block) as unknown;
  if (!Array.isArray(block) && proto !== Object.prototype && proto !== null) return fail('objekt koji nije običan');
  if (Object.getOwnPropertySymbols(block).length > 0) return fail('simbolni ključ');
  if (!Array.isArray(block) && Object.getOwnPropertyNames(block).length !== Object.keys(block).length) {
    return fail('skriveni ključ');
  }
  const next = new Set(seen).add(block);
  return Object.values(block).flatMap((value) => textsOf(value, next));
}

/** Baca grešku s popisom nalaza; izgradnja tada pada. */
export function assertPublicText(texts: readonly string[]): void {
  const problems = publicTextProblems(texts);
  if (problems.length > 0) throw new Error(`tekst za /info/ nije dopušten:\n${problems.join('\n')}`);
}
