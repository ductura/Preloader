// Tekst sučelja (hrvatski, oslovljavanje s „Vi”).
import type { DesktopPackage } from './detect.ts';

export const PACKAGE_LABELS: Record<DesktopPackage, string> = { windows: 'Windows', macos: 'macOS' };

/** Tekst koji treba skripta u pregledniku; odvojen da izgradnja ne ugrađuje ostatak (proračun P-0.1). */
export const clientText = {
  download: (pkg: DesktopPackage) => `Preuzmi Ducturu za ${PACKAGE_LABELS[pkg]}`,
  choiceSaved: 'Izbor je zapamćen u ovom pregledniku.',
  choiceNotSaved: 'Preglednik ne pamti izbor; vrijedi samo na ovoj stranici.',
} as const;

export const text = {
  title: 'Ductura',
  lead: 'Otvaramo Ducturu prilagođenu Vašem uređaju i pregledniku.',
  openApp: 'Otvori Ducturu u pregledniku',
  noscript: 'Bez JavaScripta odaberite sami:',
  choiceTitle: 'Odaberite sami',
  choiceView: 'Prikaz',
  views: { desktop: 'Računalo', mobile: 'Mobitel' },
  choicePackage: 'Desktop paket',
  frontends: { chrome: 'Sučelje za Chrome', mobile: 'Sučelje za mobitel i tablet', other: 'Sučelje za ostale preglednike' },
} as const;

/**
 * „Kako Ductura radi” za /info/ (P-0.9), doslovno iz Ductusa `messagesHr.howItWorks`
 * (src/lib/i18n/messages.hr.ts, b36c82b9). Bez odjeljka „Pravila fakulteta”: info stranica
 * ne spominje fakultete ni ustanove (PLAN §1 (3e), D-302). Izgradnja ga provjerava (`src/info/`).
 */
export const infoText = {
  title: 'Kako Ductura radi',
  lead: 'Što Ductura bilježi dok pišete, što ne bilježi, tko što vidi i kako se rad sprema.',
  recorded: {
    heading: 'Što se bilježi',
    changes: 'Promjene teksta u dokumentu, da se vidi kako je rad nastajao.',
    changesConditional: 'Prikaz slovo po slovo: uvjetno, pravno mišljenje prije pilota',
    sources: 'Izvor svake promjene: pisanje, umetanje iz drugog dokumenta ili prijedlog AI pomoćnika.',
    versions: 'Verzije koje ste poslali mentoru ili predali.',
    access: 'Tko je otvorio Vaš rad i kada.',
  },
  notRecorded: {
    heading: 'Što se ne bilježi',
    keys: 'Tipke. Bilježe se promjene teksta, ne pritisci tipki.',
    outside: 'Ništa izvan editora: zaslon, kamera i druge kartice preglednika nisu dio rada.',
    rhythm: 'Mjere iz vremena pisanja: iz vremena promjena ne računaju se brzina, stanke ni bilo kakva druga mjera.',
    authorship: 'Ocjena o tome tko je napisao tekst. Ductura je ne izvodi ni ljudski ni strojno.',
  },
  seen: {
    heading: 'Tko što vidi',
    columns: { view: 'Prikaz', you: 'Vi', mentor: 'Mentor ili nastavnik zadatka', others: 'Drugi' },
    rows: {
      live: 'Tekst uživo',
      replay: 'Ponovni prikaz nastanka',
      compare: 'Usporedba dviju poslanih verzija',
    },
    yes: 'Da',
    no: 'Ne',
    othersNote: '„Drugi” su ostali studenti i nastavnici bez zadatka.',
  },
  saving: {
    heading: 'Kako se rad sprema',
    device: 'Spremljeno na uređaju: tekst je zapisan u ovom pregledniku. Ova oznaka ne govori je li ga poslužitelj već primio.',
    server: 'Spremljeno na poslužitelju: poslužitelj je potvrdio da je tekst primio.',
    offline: 'Bez mreže pisanje se nastavlja i tekst se sprema na uređaju. Ono što je napisano bez mreže ostaje tako označeno u zapisu i nakon što se veza vrati.',
    submitted: 'Predano: rad je predan na zadatak. Predaja je moguća samo kad se predani tekst može točno složiti iz zapisa.',
  },
  check: {
    heading: 'Provjera predanog rada',
    body: 'Ispravna provjera znači da zapis rada nije mijenjan nakon predaje. Ne dokazuje tko je tekst napisao.',
  },
} as const;
