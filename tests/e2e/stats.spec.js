// The Stats page on a phone: season and session names are never cut off, and
// the season filters only show where they apply (not on Legacy).
import { expect, signIn, test } from './helpers';

test('season and session names show in full, even on a phone', async ({ page }) => {
  await signIn(page);
  await page.goto('/stats');
  const bySession = page.locator('section').filter({ has: page.getByRole('heading', { name: 'By session' }) });
  await expect(bySession).toContainText('2026–27 · Session 2');
  await expect(bySession).toContainText('2026–27 · Session 1');
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
