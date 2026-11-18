// Pristupačnost prvog ekrana (docs/PLAN.md §6, red „Pristupačnost”): axe u svakom projektu matrice
// i ručni izbor samo tipkovnicom. Kontrast prstena fokusa (D-188) axe ne provjerava.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { REDIRECT_DELAY_MS } from '../../src/client.ts';
import { clientText } from '../../src/text.ts';
import { matrixDevice, type MatrixDevice } from './devices.ts';
import { openFirstScreen } from './open.ts';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** Svako kršenje razine serious ili critical, bez obzira na pravilo; `id impact selektori` po retku. */
async function seriousViolations(page: Page): Promise<string[]> {
  // axe završava svako pravilo kroz `setTimeout`: sat se pokreće tek kad je preusmjeravanje otkazano.
  await page.locator('#choice button[aria-pressed="true"][data-view]').click();
  await page.clock.resume();
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(new URL(page.url()).pathname).toBe('/');
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} ${v.impact} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

let d: MatrixDevice;

test.beforeEach(async ({ page, context }, info) => {
  d = matrixDevice(info.project.name);
  await openFirstScreen(page, context, d);
  await expect(page.locator('#choice')).toBeVisible();
});

test('axe reports button-name and link-name when a label is removed', async ({ page }) => {
  await page.evaluate(() => {
    document.querySelector('#choice button[data-package="windows"]')!.textContent = '';
    document.getElementById('open-app')!.textContent = '';
    document.getElementById('sign-in-admin')!.textContent = '';
  });
  const found = await seriousViolations(page);
  expect(found.some((v) => v.startsWith('button-name ') && v.includes('data-package="windows"'))).toBe(true);
  expect(found.some((v) => v.startsWith('link-name ') && v.includes('#open-app'))).toBe(true);
  expect(found.some((v) => v.startsWith('link-name ') && v.includes('#sign-in-admin'))).toBe(true);
});

test('sign-in links are reached first with the keyboard and stop the redirect', async ({ page }) => {
  await tabTo(page, '#sign-in-aai', 1);
  await tabTo(page, '#sign-in-admin', 1);
  await page.clock.runFor(REDIRECT_DELAY_MS * 2);
  expect(new URL(page.url()).pathname).toBe('/');
  await page.keyboard.press('Enter');
  await page.waitForURL('**/admin/prijava');
});

test('first screen has no serious or critical axe violations', async ({ page }) => {
  expect(await seriousViolations(page)).toEqual([]);
});

/** `presses` pritisaka tipke Tab; fokus mora biti točno na cilju i vidljiv. */
async function tabTo(page: Page, selector: string, presses: number): Promise<void> {
  for (let i = 0; i < presses; i++) await page.keyboard.press('Tab');
  const target = page.locator(selector);
  expect(await target.evaluate((el) => el === document.activeElement)).toBe(true);
  const ring = await target.evaluate((el) => {
    const s = getComputedStyle(el);
    return { visible: el.matches(':focus-visible'), style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
  });
  expect(ring.visible).toBe(true);
  expect(ring.style).not.toBe('none');
  expect(ring.width).toBeGreaterThanOrEqual(2);
}

test('manual choice works with the keyboard alone, focus visible', async ({ page }) => {
  // Redom: dvije poveznice prijave, „Otvori”, poveznica za preuzimanje (samo kad je paket ponuđen), prikazi, paketi.
  const before = 2 + (d.pkg ? 2 : 1);
  const view = d.view === 'desktop' ? 'mobile' : 'desktop';
  const pkg = d.pkg === 'windows' ? 'macos' : 'windows';
  const viewAt = view === 'desktop' ? 0 : 1;
  const pkgAt = pkg === 'windows' ? 2 : 3;

  await tabTo(page, `#choice button[data-view="${view}"]`, before + viewAt + 1);
  await page.keyboard.press('Enter');
  await expect(page.locator(`#choice button[data-view="${view}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('body')).toHaveAttribute('data-frontend', view === 'mobile' ? 'mobile' : d.desktopFrontend);
  await expect(page.locator('#choice-status')).toHaveText(clientText.choiceSaved);

  await tabTo(page, `#choice button[data-package="${pkg}"]`, pkgAt - viewAt);
  await page.keyboard.press(' ');
  await expect(page.locator(`#choice button[data-package="${pkg}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(`#choice button[data-view="${view}"]`)).toHaveAttribute('aria-pressed', 'true');
});
