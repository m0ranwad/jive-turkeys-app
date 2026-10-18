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
  await expect(menu.getByRole('link', { name: 'Team Chat' })).toBeVisible();

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
