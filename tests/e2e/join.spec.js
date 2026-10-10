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

  // Not one of the names the captain put on the roster.
  await page.getByRole('button', { name: "I'm not on the list" }).click();
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

// Mike Russo is on the roster (with a paid session) but hasn't joined yet in the sample data.
test('a new player picks their name on the roster, and their spot and dues come with them', async ({ page }) => {
  await page.goto('/register');
  await page.locator('#email').fill('mike@demo.test');
  await page.locator('#password').fill('demo1234');
  await page.locator('#confirm').fill('demo1234');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();

  await expect(page.getByText('Find your name.')).toBeVisible();
  await page.getByRole('button', { name: 'Mike Russo' }).click();
  await expect(page.getByText("You're joining as Mike Russo.")).toBeVisible();
  await expect(page.getByLabel('Display name')).toHaveValue('Mike Russo');
  // Finishing the profile reloads the page; wait for that before moving on.
  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Start using the app' }).click();
  await reloaded;
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();

  // On the roster as a joined player, no longer a grey card.
  await page.locator('a[href="/team"]:visible').first().click();
  await expect(page.getByText('12 active · 2 subs (incl. on break) · 1 not joined yet')).toBeVisible();
  await expect(page.getByTestId('not-joined')).toContainText("1 hasn't joined yet");

  // His paid session came with him.
  await page.locator('a[href="/dues"]:visible').first().click();
  await expect(page.getByText('Other sessions')).toBeVisible();
  await expect(page.locator('section', { hasText: 'Other sessions' })).toContainText('Paid');
  await page.getByRole('tab', { name: 'Team dues' }).click();
  await expect(page.getByTestId('dues-unpaid')).toContainText('Mike Russo');
  await expect(page.getByTestId('dues-unpaid')).not.toContainText('Mike Russonot joined yet');
});

test('a name someone already picked is no longer on the list', async ({ page }) => {
  // Dana Wells is still on the list; once picked, she's gone from it.
  await page.goto('/register');
  await page.locator('#email').fill('dana@demo.test');
  await page.locator('#password').fill('demo1234');
  await page.locator('#confirm').fill('demo1234');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('button', { name: 'Dana Wells' }).click();
  // Finishing the profile reloads the page; wait for that before using the menu.
  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Start using the app' }).click();
  await reloaded;
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /Sign out/ }).click();
  // Signing out finishes by opening the sign-in page; wait for it before signing up again.
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/register');
  await page.locator('#email').fill('someone@demo.test');
  await page.locator('#password').fill('demo1234');
  await page.locator('#confirm').fill('demo1234');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('button', { name: 'Mike Russo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dana Wells' })).toHaveCount(0);
});

async function register(page, email) {
  await page.goto('/register');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('demo1234');
  await page.locator('#confirm').fill('demo1234');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
}

async function finishProfile(page) {
  // Finishing the profile reloads the page; wait for that before moving on.
  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Start using the app' }).click();
  await reloaded;
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
}

test('a new player who taps the wrong name, or says they are not on the list, can go back', async ({ page }) => {
  await register(page, 'rosa@demo.test');
  await page.getByRole('button', { name: 'Mike Russo' }).click();
  await expect(page.getByText("You're joining as Mike Russo.")).toBeVisible();
  await page.getByRole('button', { name: 'Not you?' }).click();
  await expect(page.getByText('Find your name.')).toBeVisible();

  await page.getByRole('button', { name: "I'm not on the list" }).click();
  await expect(page.getByLabel('Display name')).toHaveValue('');
  await page.getByRole('button', { name: 'Back to the names' }).click();
  await page.getByRole('button', { name: 'Dana Wells' }).click();
  await expect(page.getByLabel('Display name')).toHaveValue('Dana Wells');
  // What the captain entered can still be corrected.
  await page.getByLabel('Display name').fill('Dana W.');
  await finishProfile(page);

  await page.locator('a[href="/team"]:visible').first().click();
  await expect(page.getByText('Dana W.', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Dana Wells', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('not-joined')).toContainText("1 hasn't joined yet");
  await expect(page.getByText('Mike Russo', { exact: true }).last()).toBeVisible();
});

test('once every name is picked, new players go straight to their profile', async ({ page }) => {
  for (const [email, name] of [
    ['dana@demo.test', 'Dana Wells'],
    ['mike@demo.test', 'Mike Russo'],
  ]) {
    await register(page, email);
    await page.getByRole('button', { name }).click();
    await finishProfile(page);
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: /Sign out/ }).click();
    await expect(page).toHaveURL(/\/login$/);
  }

  await register(page, 'latecomer@demo.test');
  await expect(page.getByLabel('Display name')).toBeVisible();
  await expect(page.getByText('Find your name.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Back to the names' })).toHaveCount(0);
});
