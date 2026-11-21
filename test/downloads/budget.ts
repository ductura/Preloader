import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { gzipSync } from 'node:zlib';
import next from 'next';
import { contentSecurityPolicyFor } from '../../deploy/edge/content-security-policy.ts';
import { checkSizes, nextPageSizes, parseBudget } from '../../scripts/budget.ts';
import { fullManifest } from './fixture.ts';

async function listen(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Nedostaje adresa testnog poslužitelja');
  return `http://127.0.0.1:${address.port}`;
}

const manifest = {
  packages: fullManifest.packages.map((entry) => ({
    ...entry,
    // Četiri slabo stlačive poveznice maksimalne duljine iz ugovora.
    url: '/' + createHash('shake256', { outputLength: 1536 }).update(entry.url).digest('base64url').slice(0, 2047),
  })),
};

const api = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/v1/downloads/manifest') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(manifest));
  } else {
    res.writeHead(404).end();
  }
});
const app = next({ dev: false, hostname: '127.0.0.1' });
const page = createServer(app.getRequestHandler());

try {
  process.env.INSTITUTION_SERVER_URL = await listen(api);
  await app.prepare();
  const origin = await listen(page);
  const response = await fetch(`${origin}/preuzimanje`, { signal: AbortSignal.timeout(15000) });
  if (response.status !== 200) throw new Error(`/preuzimanje odgovara statusom ${response.status}`);
  const html = await response.text();
  if (manifest.packages.some(({ url }) => !html.includes(`href="${url}"`))) {
    throw new Error('/preuzimanje ne prikazuje puni testni manifest');
  }
  const csp = await contentSecurityPolicyFor(html, { scriptOptional: true });
  if (!csp.includes("script-src 'none'") || /<(?:link|img)\b/i.test(html)) {
    throw new Error('/preuzimanje mora imati samo HTML i ugrađeni stil');
  }

  const budget = parseBudget(readFileSync('budget.json', 'utf8'));
  const route = 'preuzimanje.html';
  const statics = Object.keys(budget.files).filter((name) => name !== route);
  const { sizes, total } = nextPageSizes('.next', statics);
  const downloadBytes = gzipSync(html, { level: 9 }).length;
  sizes.set(route, downloadBytes);
  for (const [name, size] of sizes) console.log(`${name}: ${size} B gzip (granica ${budget.files[name]} B)`);
  console.log(`ukupno: ${total + downloadBytes} B gzip (granica ${budget.total} B)`);
  const problems = checkSizes(sizes, total + downloadBytes, budget);
  if (problems.length) throw new Error(problems.join('\n'));
} finally {
  page.close();
  api.close();
  await app.close();
}
