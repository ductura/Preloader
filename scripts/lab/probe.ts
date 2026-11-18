// DAN-1096 L-2: whether anything still listens on the server's port. Only a
// refused connection is proof that the server is down. Any answer at all, a
// redirect, an error page, a reset after connect, a silent socket or a
// timeout, is not: the claim then fails rather than pass on a guess.
import { connect } from 'node:net';

export type Probe = 'refused' | 'open' | 'unknown';

export function probePort(port: number, host = '127.0.0.1', timeoutMs = 2_000): Promise<Probe> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (result: Probe): void => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => done('unknown'));
    socket.once('connect', () => done('open'));
    socket.once('error', (e: NodeJS.ErrnoException) => done(e.code === 'ECONNREFUSED' ? 'refused' : 'unknown'));
  });
}
