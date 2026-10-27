// Team Settings saves each change as it's made (a choice when tapped, a typed
// field when you leave it), so leaving the page never loses a change, and a
// failed save says so and keeps what was typed.
import { expect, signIn, test } from './helpers';

async function openSettings(page) {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('link', { name: 'Team Settings' }).click();
  await expect(page.getByRole('button', { name: 'Menu' })).toBeFocused();
}

test('a typed change is saved when you leave the page, with no Save button', async ({ page }) => {
  await signIn(page);
  await openSettings(page);
  await expect(page.getByRole('button', { name: 'Save team settings' })).toHaveCount(0);
  await expect(page.getByTestId('settings-status')).toHaveText('Changes save as you make them.');

  await page.getByLabel('Primary jersey').fill('Lime');
  // Straight to another tab, without pressing Enter.
  await page.locator('a[href="/"]:visible').first().click();
  await expect(page.getByText('Team settings saved')).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByLabel('Primary jersey')).toHaveValue('Lime');
});

test("a change that doesn't save says so, keeps what was typed, and saves on the next try", async ({ page }) => {
  await signIn(page);
  await openSettings(page);
  await page.evaluate(() => localStorage.setItem('jt_demo_offline', '1'));
  await page.getByLabel('Backup jersey').fill('Navy');
  await page.getByLabel('Backup jersey').press('Enter');
  await expect(page.getByText("That didn't save")).toBeVisible();
  await expect(page.getByLabel('Backup jersey')).toHaveValue('Navy');
  await expect(page.getByTestId('settings-status')).not.toHaveText('All changes saved');

  await page.evaluate(() => localStorage.removeItem('jt_demo_offline'));
  await page.getByLabel('Backup jersey').focus();
  await page.getByLabel('Backup jersey').press('Enter');
  await expect(page.getByTestId('settings-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(page.getByLabel('Backup jersey')).toHaveValue('Navy');
});
