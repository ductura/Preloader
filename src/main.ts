import { browserStore } from './choice/store.ts';
import { applyRoute } from './client.ts';
import { defaultConfig } from './config.ts';
import { signalsFrom } from './detect/index.ts';

applyRoute(document, signalsFrom(navigator), defaultConfig, (url, delayMs) => {
  const id = setTimeout(() => location.assign(url), delayMs);
  return () => clearTimeout(id);
}, browserStore(window));
