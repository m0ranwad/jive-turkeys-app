// The Stats page on a phone: season and session names are never cut off, and
// the season filters only show where they apply (not on Legacy).
import { expect, signIn, test } from './helpers';

test('season and session names show in full, even on a phone', async ({ page }) => {
  await signIn(page);
  await page.goto('/stats');
  const bySession = page.locator('section').filter({ has: page.getByRole('heading', { name: 'By session' }) });
  await expect(bySession).toContainText('2026–27 · Session 1');
  await expect(bySession).toContainText('2025–26 · Session 3');
  // Session 2 hasn't had a game yet, so it has no row (no "0-0-0 · 0 GF · 0 GA").
  await expect(bySession).not.toContainText('2026–27 · Session 2');
  // Nothing in the list is clipped with "…".
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('section span')]
      .filter((el) => el.children.length === 0 && /^20\d\d/.test(el.textContent) && el.scrollWidth > el.clientWidth)
      .map((el) => el.textContent),
  );
  expect(clipped).toEqual([]);
});

test('the season filters hide on Legacy, which covers every season', async ({ page }) => {
  await signIn(page);
  await page.goto('/stats');
  await expect(page.getByRole('combobox', { name: 'Season' })).toBeVisible();
  await page.getByRole('tab', { name: 'Legacy' }).click();
  await expect(page.getByRole('combobox', { name: 'Season' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Players' }).click();
  await expect(page.getByRole('combobox', { name: 'Season' })).toBeVisible();
});

test('session names stay readable on a 320px phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await signIn(page);
  await page.goto('/stats');
  const bySession = page.locator('section').filter({ has: page.getByRole('heading', { name: 'By session' }) });
  const label = bySession.getByText('2026–27 · Session 1', { exact: true });
  await expect(label).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  // A readable label takes at most two lines; the old 50px column split it across four.
  const size = await label.evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    lineHeight: parseFloat(getComputedStyle(el).lineHeight),
    width: el.clientWidth,
    scrollWidth: el.scrollWidth,
  }));
  expect(size.height).toBeLessThanOrEqual(size.lineHeight * 2);
  expect(size.scrollWidth).toBeLessThanOrEqual(size.width);

  const row = label.locator('..');
  await expect(row.getByText('2-1-1', { exact: true })).toBeVisible();
  await expect(row.getByText('10 GF', { exact: true })).toBeVisible();
  await expect(row.getByText('9 GA', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
