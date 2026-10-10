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
