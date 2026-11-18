// DAN-1096 L-2: only a refused connection counts as a server that is down
// (review and QA finding 2 on 3e05a73b: a health redirect to a dead target
// read as "no answer"). Real sockets, no precomputed value.
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { createServer as createHttp } from 'node:http';
import { type Server, createServer } from 'node:net';

import { probePort } from '../scripts/lab/probe.ts';

const open: Server[] = [];
afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

function listen(server: Server): Promise<number> {
  open.push(server);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)));
}

/** A port that just stopped listening. */
async function closedPort(): Promise<number> {
  const server = createServer();
  const port = await new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)));
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('a closed port is refused', async () => {
  assert.equal(await probePort(await closedPort()), 'refused');
});

test('a health answer of 200 is not down', async () => {
  const port = await listen(createHttp((_, res) => res.end('ok')));
  assert.equal(await probePort(port), 'open');
});

test('a redirect to a dead target is not down', async () => {
  const dead = await closedPort();
  const port = await listen(createHttp((_, res) => res.writeHead(302, { location: `http://127.0.0.1:${dead}/` }).end()));
  assert.equal(await probePort(port), 'open');
});

test('a socket reset after accept is not down', async () => {
  const port = await listen(createServer((socket) => socket.resetAndDestroy()));
  assert.notEqual(await probePort(port), 'refused');
});

test('a silent socket is not down', async () => {
  const port = await listen(createServer(() => undefined));
  assert.notEqual(await probePort(port, '127.0.0.1', 200), 'refused');
});
