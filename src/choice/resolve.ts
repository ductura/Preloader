// Spaja automatsku odluku (P-0.2) i ručni izbor. Ručni izbor uvijek pobjeđuje.
import type { DesktopPackage } from '../detect.ts';
import type { View } from '../detect/view.ts';
import type { Choice } from './store.ts';

export interface Decision {
  readonly view: View;
  readonly package: DesktopPackage | null;
}

export function resolveChoice(auto: Decision, manual: Choice): Decision {
  const view = manual.view ?? auto.view;
  // Automatski paket ne ide uz mobilni prikaz; ručno odabran paket ide uvijek.
  const pkg = manual.package ?? (view === 'mobile' ? null : auto.package);
  return { view, package: pkg };
}
