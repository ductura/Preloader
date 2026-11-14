// True when the module at `moduleUrl` is the script node was started with.
// Compares encoded file URLs, so paths with spaces or other escaped characters match.
import { pathToFileURL } from 'node:url';

export function isMain(moduleUrl: string, argv1: string | undefined = process.argv[1]): boolean {
  return argv1 !== undefined && pathToFileURL(argv1).href === moduleUrl;
}
