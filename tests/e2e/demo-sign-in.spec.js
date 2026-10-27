// Previews (and local development) open already signed in as the sample captain,
// so nobody has to type or save a demo password.
import { expect, test } from './helpers';

const profileButton = (page) => page.getByRole('link', { name: 'My profile' });

async function skipWelcome(page) {
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
}

test('the demo opens signed in as the captain; signing out sticks, and one tap signs back in', async ({ page }) => {
  await page.goto('/');
  await skipWelcome(page);
  await expect(profileButton(page)).toHaveText('CC');

  await profileButton(page).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByRole('button', { name: 'Sign in as a player' }).click();
  await skipWelcome(page);
  await expect(profileButton(page)).toHaveText('JR');

  await profileButton(page).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Sign in as the captain' }).click();
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  await expect(profileButton(page)).toHaveText('CC');
});

test('a link to a page opens that page, signed in', async ({ page }) => {
  await page.goto('/rules');
  await expect(page).toHaveURL(/\/rules$/);
  await expect(profileButton(page)).toHaveText('CC');
});
