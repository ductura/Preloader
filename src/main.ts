import { browserStore } from './choice/store.ts';
import { applyRoute } from './client.ts';
import { sendClientContext } from './client-context/index.ts';
import { APP_VERSION, defaultConfig } from './config.ts';
import { signalsFrom } from './detect/index.ts';

const signals = signalsFrom(navigator);
applyRoute(document, signals, defaultConfig, (url, delayMs) => {
  const id = setTimeout(() => location.assign(url), delayMs);
  return () => clearTimeout(id);
}, browserStore(window));
// Nakon zakazanog preusmjeravanja; ne čeka odgovor (P-0.8).
sendClientContext((path, init) => fetch(path, init), signals, innerWidth, APP_VERSION);
