import { expect, test } from 'vitest';
import { GET } from '../../../app/(ulaz)/stranica-ne-postoji/route.ts';
import { contentSecurityPolicyFor } from '../../../deploy/edge/content-security-policy.ts';

test('hrvatski 404 ima status 404 i stil koji lokalni edge može hashirati', async () => {
  const response = await GET();
  expect(response.status).toBe(404);
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  const html = await response.text();
  expect(html).toContain('<html lang="hr">');
  expect(html).toContain('<h1 id="error-title">Stranica ne postoji</h1>');
  const policy = await contentSecurityPolicyFor(html, { scriptOptional: true });
  expect(policy).toMatch(/script-src 'none'; style-src 'sha256-[\w+/]{43}='/);
});
