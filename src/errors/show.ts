// Prikaz stanja greške na stranici `greska.html` (DAN-935-2). Ulaz je samo `?status=` iz adrese.
import { errorText } from '../text.ts';
import { errorViewFor, type ErrorTextKey } from './view.ts';

/** Broj samo za točno tri ASCII znamenke; sve ostalo ostaje niz, pa nepoznat ulaz daje opći prikaz. */
export function errorInputFrom(search: string): number | string {
  const value = new URLSearchParams(search).get('status') ?? '';
  return /^[0-9]{3}$/.test(value) ? Number(value) : value;
}

/** Upisuje naslov i tekst stanja iz `errorText`; vraća prikazani ključ. */
export function showError(doc: Document, search: string): ErrorTextKey {
  const key = errorViewFor(errorInputFrom(search));
  const { title, body } = errorText[key];
  const heading = doc.getElementById('error-title');
  const paragraph = doc.getElementById('error-body');
  if (heading) heading.textContent = title;
  if (paragraph) paragraph.textContent = body;
  doc.title = `${title} · Ductura`;
  return key;
}
