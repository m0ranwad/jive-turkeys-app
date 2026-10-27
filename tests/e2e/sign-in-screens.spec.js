// The sign-in screens show the team's turkey and name, so a new teammate
// opening the link from an invite knows they're in the right place, and
// sign-up says the team code comes next.
import { expect, test } from './helpers';

test('sign-in and sign-up say Jive Turkeys, with empty password boxes', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('Jive Turkeys', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.locator('#password')).not.toHaveAttribute('placeholder', /•/);

  await page.goto('/register');
  await expect(page.getByText('Jive Turkeys', { exact: true })).toBeVisible();
  await expect(page.getByText("Next, you'll enter the team code from your invite.")).toBeVisible();
  await expect(page.locator('#password')).toHaveAttribute('placeholder', 'At least 6 characters');
  await expect(page.locator('#confirm')).not.toHaveAttribute('placeholder', /•/);
});

test('the privacy and terms pages keep their plain look', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy' })).toBeVisible();
  await expect(page.getByText('Jive Turkeys', { exact: true })).toHaveCount(0);
});
