// Slanje konteksta klijenta (P-0.8).
export {
  CLIENT_APP_VERSION_PATTERN, CLIENT_CONTEXT_MAX_BYTES, CLIENT_CONTEXT_PATH, CLIENT_CONTEXT_VALUES,
  type ClientContext,
} from './contract.ts';
export { APP_VERSION_RE, clientContextBody, clientContextFrom, sendClientContext, type Fetch } from './send.ts';
