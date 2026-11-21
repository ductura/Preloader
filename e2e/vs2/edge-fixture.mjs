import { once } from 'node:events';
import { createServer } from 'node:http';
import { main } from '../../deploy/edge/dev-proxy.mjs';
import { PRELOADER_ORIGIN } from '../matrix/server.ts';

// Stvarne TCP veze između edgea i triju odvojenih HTTP poslužitelja.
async function fixture(name, prefix) {
  const server = createServer((req, res) => {
    if (req.url !== `${prefix}/`) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-VS2-Frontend': name });
    res.end(`<!doctype html><html lang="hr"><title>${name}</title><h1>${name}</h1></html>`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

try {
  await main({
    DUCTURA_EDGE_PRELOADER: PRELOADER_ORIGIN,
    DUCTURA_EDGE_FRONT: await fixture('chrome', '/app/chrome'),
    DUCTURA_EDGE_MOBILE: await fixture('mobile', '/app/mobile'),
    DUCTURA_EDGE_OTHER: await fixture('other', '/o'),
  });
} catch (error) {
  console.error(error);
  process.exit(1);
}
