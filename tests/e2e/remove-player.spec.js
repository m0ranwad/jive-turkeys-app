// Captains take a signed-up player off the team: they come off the roster and
// the counts, can't get back in with the team code, and can be added back.
// The database enforces who can do what (supabase/tests/membership.test.sql).
import { enterTeamCode, expect, signIn, test } from './helpers';

async function openTeam(page) {
  await page.locator('a[href="/team"]:visible').first().click();
  await expect(page.getByRole('heading', { name: 'Team', exact: true })).toBeVisible();
}

async function signOutAndIn(page, email) {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /Sign out/ }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Log in' }).click();
}

test('players cannot remove anyone', async ({ page }) => {
  await signIn(page, 'jordan@demo.test');
  await openTeam(page);
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0);
});

test('a captain removes a signed-up player, who loses access until added back', async ({ page }) => {
  await signIn(page);
  await openTeam(page);
  await expect(page.getByText('12 playing · 1 available to sub · 1 unavailable · 2 not joined yet')).toBeVisible();
  // Not themselves.
  await expect(page.getByRole('button', { name: 'Remove Casey Captain' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Remove Jordan Rivera' }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove Jordan Rivera?' });
  await expect(dialog).toContainText("the team code won't let them back in");
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText('Jordan Rivera removed from the team')).toBeVisible();
  await expect(page.getByText('11 playing · 1 available to sub · 1 unavailable · 2 not joined yet')).toBeVisible();
  const removed = page.getByTestId('removed-players');
  await expect(removed).toContainText('Jordan Rivera');

  // Jordan is asked for the team code, and it doesn't let them in.
  await signOutAndIn(page, 'jordan@demo.test');
  await enterTeamCode(page);
  await expect(page.getByText('A captain took this account off the team.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Enter the team code' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.locator('#email').fill('captain@demo.test');
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Log in' }).click();
  await openTeam(page);
  await page.getByTestId('removed-players').getByRole('button', { name: 'Add back' }).click();
  await expect(page.getByText('Jordan Rivera added back')).toBeVisible();
  await expect(page.getByText('12 playing · 1 available to sub · 1 unavailable · 2 not joined yet')).toBeVisible();
  await expect(page.getByTestId('removed-players')).toHaveCount(0);
});
