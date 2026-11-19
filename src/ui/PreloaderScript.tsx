'use client';
// Logika prvog ekrana u pregledniku (`src/main.ts`), nakon hidracije. Ništa ne iscrtava.
import { useEffect } from 'react';
import { startPreloader } from '../main.ts';

export function PreloaderScript() {
  useEffect(startPreloader, []);
  return null;
}
