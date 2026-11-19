'use client';
// Tekst stanja greške iz `?status=` (`src/errors/main.ts`, DAN-935-2), nakon hidracije. Ništa ne iscrtava.
import { useEffect } from 'react';
import { startErrorPage } from '../errors/main.ts';

export function ErrorScript() {
  useEffect(startErrorPage, []);
  return null;
}
