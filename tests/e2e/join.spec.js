import { expect, test } from './helpers';

test('a new player has to set up their profile, which puts them on the team', async ({ page }) => {
  await page.goto('/register');
  await page.locator('#email').fill('newbie@demo.test');
  await page.locator('#password').fill('demo1234');
  await page.locator('#confirm').fill('demo1234');
  await page.getByRole('button', { name: 'Create account' }).click();

  // Skip jumps past the slides to the profile, which can't be skipped.
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('heading', { name: 'Join the team' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip' })).toHaveCount(0);

  await page.getByLabel('Display name').fill('Newbie Nguyen');
  await page.getByRole('button', { name: 'Female' }).click();
  await page.getByRole('button', { name: 'Start using the app' }).click();
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Join the team' })).toHaveCount(0);

  await page.locator('a[href="/team"]:visible').first().click();
  await expect(page.getByText('Newbie Nguyen').first()).toBeVisible();
});

test('a new player can sign out instead of setting up a profile', async ({ page }) => {
  await page.goto('/register');
  await page.locator('#email').fill('wrong@demo.test');
  await page.locator('#password').fill('demo1234');
  await page.locator('#confirm').fill('demo1234');
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
