// The team code: a new account enters it before seeing anything about the
// team, captains see and change it, and Copy invite includes it. The database
// enforces it (supabase/tests/membership.test.sql). The sample data's code is
// TURKEY; Nia Newcomer signed up earlier but hasn't entered it.
import { enterTeamCode, expect, signIn, test } from './helpers';

async function createAccount(page, email) {
  await page.goto('/register');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('demo1234');
  await page.locator('#confirm').fill('demo1234');
  await page.getByRole('button', { name: 'Create account' }).click();
}

async function signOutFromMenu(page) {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /Sign out/ }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test('a new account enters the team code before it sees anything', async ({ page }) => {
  await createAccount(page, 'newbie@demo.test');
  await expect(page.getByRole('heading', { name: 'Enter the team code' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Schedule' })).toHaveCount(0);
  await expect(page.getByText('Demo mode: the team code is TURKEY.')).toBeVisible();

  // Still there after a reload, or going straight to another page.
  await page.goto('/team');
  await expect(page.getByRole('heading', { name: 'Enter the team code' })).toBeVisible();

  await page.getByLabel('Team code').fill('NOPE');
  await page.getByRole('button', { name: 'Join the team' }).click();
  await expect(page.getByText("That code isn't right. Check the invite from your captain.")).toBeVisible();

  await enterTeamCode(page, ' turkey ');
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('button', { name: "I'm not on the list" }).click();
  await page.getByLabel('Display name').fill('Newbie Nguyen');
  await page.getByRole('button', { name: 'Female' }).click();
  await page.getByRole('button', { name: 'Start using the app' }).click();
  // In, on the page they asked for.
  await expect(page.getByRole('heading', { name: 'Team', exact: true })).toBeVisible();
  await expect(page.getByText('Newbie Nguyen').first()).toBeVisible();
});

test('someone who signed up earlier still needs the code, and can sign out instead', async ({ page }) => {
  await page.goto('/login');
  await page.locator('#email').fill('nia@demo.test');
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Enter the team code' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('captains see the code, change it, and invites with the old one stop working', async ({ page }) => {
  await signIn(page);
  // The Team page reminds captains while a new session is starting.
  await page.locator('a[href="/team"]:visible').first().click();
  const reminder = page.getByTestId('session-answers').getByTestId('team-code-stale');
  await expect(reminder).toContainText('New session: change the team code');
  await reminder.getByRole('link', { name: 'Team Settings' }).click();
  const card = page.getByTestId('team-code');
  await expect(card.getByTestId('team-code-value')).toHaveText('TURKEY');
  await expect(card.getByTestId('team-code-stale')).toContainText('Session 2 has started since the code last changed');

  await card.getByRole('button', { name: 'Choose my own' }).click();
  await card.getByLabel('Your code (4 or more letters or numbers)').fill('gobble2');
  await card.getByRole('button', { name: 'Save code' }).click();
  await expect(page.getByText('Team code changed')).toBeVisible();
  await expect(card.getByTestId('team-code-value')).toHaveText('GOBBLE2');
  await expect(card.getByTestId('team-code-stale')).toHaveCount(0);

  await card.getByRole('button', { name: 'New code' }).click();
  await expect(card.getByTestId('team-code-value')).not.toHaveText('GOBBLE2');
  await expect(card.getByTestId('team-code-value')).toHaveText(/^[A-Z2-9]{6}$/);
  const code = await card.getByTestId('team-code-value').textContent();

  await signOutFromMenu(page);
  await createAccount(page, 'late@demo.test');
  await page.getByLabel('Team code').fill('TURKEY');
  await page.getByRole('button', { name: 'Join the team' }).click();
  await expect(page.getByText("That code isn't right.")).toBeVisible();
  await enterTeamCode(page, code);
  await expect(page.getByRole('button', { name: 'Skip' })).toBeVisible();
});

test('players do not see the team code settings', async ({ page }) => {
  await signIn(page, 'jordan@demo.test');
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('link', { name: 'Team Settings' })).toHaveCount(0);
});

test('someone who already has an account is asked before making a second one', async ({ page }) => {
  // Jordan forgot she signed up with Google and makes an email account.
  await createAccount(page, 'jordan.rivera@demo.test');
  await enterTeamCode(page);
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('button', { name: "I'm not on the list" }).click();
  await page.getByLabel('Display name').fill('Jordan Rivera');
  await page.getByRole('button', { name: 'Female' }).click();
  await page.getByRole('button', { name: 'Start using the app' }).click();
  const ask = page.getByTestId('already-on-site');
  await expect(ask).toContainText('Jordan Rivera has an account here already');
  await ask.getByRole('button', { name: 'Sign out and use my other account' }).click();
  await expect(page).toHaveURL(/\/login$/);

  // A different Jordan says so and carries on.
  await createAccount(page, 'jordan.r@demo.test');
  await enterTeamCode(page);
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('button', { name: "I'm not on the list" }).click();
  await page.getByLabel('Display name').fill('Jordan R');
  await page.getByRole('button', { name: 'Male', exact: true }).click();
  await page.getByRole('button', { name: 'Start using the app' }).click();
  const reloaded = page.waitForEvent('load');
  await page.getByTestId('already-on-site').getByRole('button', { name: "No, that's someone else" }).click();
  await reloaded;
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
});
