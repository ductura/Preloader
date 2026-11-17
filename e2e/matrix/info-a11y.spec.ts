// Pristupačnost stranice /info/ (docs/PLAN.md §6): axe u svakom projektu matrice (DAN-969-2).
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const infoHtml = readFileSync(new URL('../../dist/info/index.html', import.meta.url), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function serious(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} ${v.impact} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test.beforeEach(async ({ page }) => {
  await page.route('https://preloader.test/info/', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: infoHtml }));
  await page.goto('/info/');
});

test('axe reports link-name when the link label on /info/ is removed', async ({ page }) => {
  await page.evaluate(() => {
    document.querySelector('a.button')!.textContent = '';
  });
  const found = await serious(page);
  expect(found.some((v) => v.startsWith('link-name '))).toBe(true);
});

test('/info/ has no serious or critical axe violations', async ({ page }) => {
  await expect(page.locator('h1')).toHaveText('Kako Ductura radi');
  expect(await serious(page)).toEqual([]);
});
