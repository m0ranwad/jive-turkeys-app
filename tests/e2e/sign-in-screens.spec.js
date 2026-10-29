// The sign-in screens show the team's turkey and name, so a new teammate
// opening the link from an invite knows they're in the right place, and
// sign-up says they'll need the team code.
import { expect, test } from './helpers';

test('sign-in and sign-up say Jive Turkeys, with empty password boxes', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('Jive Turkeys', { exact: true })).toBeVisible();
  await expect(page.getByText('Est. 2015', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.locator('#password')).not.toHaveAttribute('placeholder', /•/);

  await page.goto('/register');
  await expect(page.getByText('Jive Turkeys', { exact: true })).toBeVisible();
  await expect(page.getByText('Est. 2015', { exact: true })).toBeVisible();
  await expect(page.getByText("You'll need the team code from your invite to join.")).toBeVisible();
  await expect(page.locator('#password')).toHaveAttribute('placeholder', 'At least 6 characters');
  await expect(page.locator('#confirm')).not.toHaveAttribute('placeholder', /•/);
});

test('a new password says how long it has to be', async ({ page }) => {
  // Demo mode is signed in, so the reset screen shows its form.
  await page.goto('/reset-password');
  await expect(page.getByRole('heading', { name: 'New password' })).toBeVisible();
  await expect(page.locator('#password')).toHaveAttribute('placeholder', 'At least 6 characters');
});

for (const [path, heading, icon] of [
  ['/privacy', 'Privacy', 'lucide-shield-check'],
  ['/terms', 'Terms', 'lucide-file-text'],
]) {
  test(`the ${heading.toLowerCase()} page keeps its plain look`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(page.locator(`svg.${icon}`)).toBeVisible();
    await expect(page.locator('img[src="/icon-192.png"]')).toHaveCount(0);
    await expect(page.getByText('Jive Turkeys', { exact: true })).toHaveCount(0);
  });
}
