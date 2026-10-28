// Team Settings saves each change as it's made (a choice when tapped, a typed
// field after a pause or when you leave it), so leaving the page never loses a change, and a
// failed save says so and keeps what was typed.
import { expect, signIn, test } from './helpers';

async function openSettings(page) {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('link', { name: 'Team Settings' }).click();
  await expect(page.getByRole('button', { name: 'Menu' })).toBeFocused();
}

async function storedSettings(page) {
  return page.evaluate(async () => {
    const { api } = await import('/src/api/index.js');
    return (await api.entities.TeamSettings.list())[0];
  });
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

test('browser Back saves a focused draft and returning shows it', async ({ page }) => {
  await signIn(page);
  await openSettings(page);
  await page.getByLabel('Primary jersey').fill('Lime');
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Schedule', exact: true })).toBeVisible();
  await expect.poll(async () => (await storedSettings(page)).primary_jersey).toBe('Lime');
  await openSettings(page);
  await expect(page.getByLabel('Primary jersey')).toHaveValue('Lime');
});

test('a focused typed draft saves after a pause without leaving the field', async ({ page }) => {
  await signIn(page);
  await openSettings(page);
  await page.getByLabel('Primary jersey').fill('Lime');
  await expect.poll(async () => (await storedSettings(page)).primary_jersey).toBe('Lime');
  await expect(page.getByLabel('Primary jersey')).toBeFocused();
  await expect(page.getByTestId('settings-status')).toHaveText('All changes saved');
});

test('the latest choice survives a slow earlier save', async ({ page }) => {
  await signIn(page);
  await openSettings(page);
  await page.evaluate(async () => {
    const { api } = await import('/src/api/index.js');
    const update = api.entities.TeamSettings.update;
    let first = true;
    api.entities.TeamSettings.update = async (...args) => {
      if (first) {
        first = false;
        await new Promise((resolve) => { window.releaseSettingsSave = resolve; });
      }
      return update(...args);
    };
  });
  const choice = page.getByRole('group', { name: 'Tell the team when voting opens', exact: true });
  await choice.getByRole('button', { name: 'Off', exact: true }).click();
  await page.waitForFunction(() => typeof window.releaseSettingsSave === 'function');
  await choice.getByRole('button', { name: 'On', exact: true }).click();
  await expect(choice.getByRole('button', { name: 'On', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // Leaving and returning before the slow write finishes keeps the same draft
  // and queue instead of loading the old stored value into a competing form.
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Schedule', exact: true })).toBeVisible();
  await openSettings(page);
  await expect(choice.getByRole('button', { name: 'On', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.releaseSettingsSave());
  await expect(page.getByTestId('settings-status')).toHaveText('All changes saved');
  await expect(choice.getByRole('button', { name: 'On', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect((await storedSettings(page)).potm_notify).toBe(true);
  await page.reload();
  await expect(choice.getByRole('button', { name: 'On', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('a later failed save stays unsaved until Retry succeeds', async ({ page }) => {
  await signIn(page);
  await openSettings(page);
  await page.getByLabel('Primary jersey').fill('Lime');
  await page.getByLabel('Primary jersey').press('Enter');
  await expect(page.getByTestId('settings-status')).toHaveText('All changes saved');
  await page.evaluate(() => localStorage.setItem('jt_demo_offline', '1'));
  await page.getByLabel('Backup jersey').fill('Navy');
  await page.getByLabel('Backup jersey').press('Enter');
  await expect(page.getByText("That didn't save")).toBeVisible();
  await expect(page.getByTestId('settings-status')).toContainText('Some changes haven’t saved.');
  await expect(page.getByLabel('Backup jersey')).toHaveValue('Navy');
  // The failed draft also survives leaving Settings and returning.
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Schedule', exact: true })).toBeVisible();
  await openSettings(page);
  await expect(page.getByLabel('Backup jersey')).toHaveValue('Navy');
  await expect(page.getByTestId('settings-status')).toContainText('Some changes haven’t saved.');
  await page.evaluate(() => localStorage.removeItem('jt_demo_offline'));
  await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
  await expect(page.getByTestId('settings-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(page.getByLabel('Backup jersey')).toHaveValue('Navy');
});
