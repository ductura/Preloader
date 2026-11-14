import { applyRoute } from './client.ts';
import { defaultConfig } from './config.ts';

applyRoute(document, navigator.userAgent, defaultConfig, (url, delayMs) => {
  setTimeout(() => location.assign(url), delayMs);
});
