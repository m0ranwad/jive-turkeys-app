import { expect, signIn, test } from './helpers';

test('the profile button sits at the top right, not in the tab bar', async ({ page }) => {
  await signIn(page);
  await expect(page.locator('[data-bottom-nav] a[href="/profile"]')).toHaveCount(0);

  const button = page.getByRole('link', { name: 'My profile' });
  await expect(button).toHaveText('CC');
  await button.click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByText('captain@demo.test')).toBeVisible();
});

test('the menu works from the keyboard and with screen readers', async ({ page }) => {
  await signIn(page);
  const button = page.getByRole('button', { name: 'Menu', exact: true });
  await button.click();
  const menu = page.getByRole('dialog', { name: 'Menu' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Announcements' })).toBeVisible();

  // Tab goes round the menu, not the page behind it.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await menu.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }

  // Escape closes it and puts you back on the Menu button.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();

  // So do the close button and tapping outside.
  await button.click();
  await menu.getByRole('button', { name: 'Close menu' }).click();
  await expect(menu).toHaveCount(0);
  await button.click();
  await page.mouse.click(10, 300);
  await expect(menu).toHaveCount(0);
});

test("five tabs, and the menu holds only what isn't a tab", async ({ page }) => {
  await signIn(page);
  const tabs = page.locator('[data-bottom-nav] a:visible, header nav a:visible');
  await expect(tabs.filter({ hasText: /Rules/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Menu' });
  for (const name of ['Announcements', 'Field Rules', 'Team Settings', 'How to Use']) {
    await expect(menu.getByRole('link', { name }).or(menu.getByRole('button', { name }))).toBeVisible();
  }
  for (const name of ['Team Chat', 'Dues', 'My Profile']) {
    await expect(menu.getByRole('link', { name, exact: true })).toHaveCount(0);
  }
  // Your name at the top opens My Profile.
  await menu.getByRole('link', { name: /Casey Captain/ }).click();
  await expect(page).toHaveURL(/\/profile$/);
});

