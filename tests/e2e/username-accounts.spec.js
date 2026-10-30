import { expect, signIn, test } from './helpers';

const PASSWORD = 'password123';
async function startSignup(page, username = 'new_player') {
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('link', { name: 'Create one' }).click();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await page.getByRole('button', { name: 'Username (no email)' }).click();
  await expect(page.locator('#email')).toHaveCount(0);
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Team code', { exact: true }).fill('TURKEY');
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#confirm').fill(PASSWORD);
}
async function saveCode(page, button = 'Continue to the team') {
  await expect(page.getByLabel('Your recovery code')).toBeVisible();
  const code = await page.getByLabel('Your recovery code').inputValue();
  await expect(page.getByRole('button', { name: button, exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: "I've saved my recovery code somewhere safe." }).check();
  await page.getByRole('button', { name: button, exact: true }).click();
  return code;
}

test('a new player signs up with no email, the team code, and a saved recovery code', async ({ page }) => {
  await startSignup(page);
  await page.getByLabel('Team code', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByText('That team code is not right. Ask a captain for the code.')).toBeVisible();
  await page.getByLabel('Team code', { exact: true }).fill('TURKEY');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await saveCode(page);
  // The normal roster-name/profile setup comes next; username signup has
  // already checked the team code, and gives no access to captain settings.
  await expect(page.getByRole('heading', { name: 'Join the team' })).toBeVisible();
  await page.goto('/login');
  await page.getByLabel('Email or username').fill('NEW_PLAYER');
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Join the team' })).toBeVisible();
});

test('an existing Google/email player can add a username without a second profile', async ({ page }) => {
  await signIn(page);
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Add a username', exact: true }).click();
  await page.getByLabel('Current password').fill('wrong-password');
  await page.getByLabel('Username', { exact: true }).fill('casey_cap');
  await page.locator('#username-password').fill(PASSWORD);
  await page.locator('#username-confirm').fill(PASSWORD);
  await page.getByRole('button', { name: 'Add username', exact: true }).click();
  await expect(page.getByText('Your current password is not right.')).toBeVisible();
  await page.getByLabel('Current password').fill('demo1234');
  await page.locator('#username-password').fill(PASSWORD);
  await page.locator('#username-confirm').fill(PASSWORD);
  await page.getByRole('button', { name: 'Add username', exact: true }).click();
  // The code comes before everything else: no tabs to wander off with, even by going back.
  await expect(page.getByLabel('Your recovery code')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Schedule' })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByLabel('Your recovery code')).toBeVisible();
  await saveCode(page);
  await page.goto('/profile');
  await expect(page.getByText('casey_cap', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('Email or username').fill('CASEY_CAP');
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Casey Captain', exact: true })).toBeVisible();
  await expect(page.getByText('captain@demo.test', { exact: true })).toBeVisible();
  await expect(page.getByText('Captain', { exact: true })).toBeVisible();
});

test('a recovery code resets the password once and replaces the saved code', async ({ page }) => {
  await startSignup(page, 'recover_player');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  const code = await saveCode(page);
  await page.goto('/forgot-password');
  await page.getByRole('button', { name: 'Use a recovery code instead' }).click();
  await page.getByLabel('Username', { exact: true }).fill('recover_player');
  await page.getByLabel('Recovery code', { exact: true }).fill(code);
  await page.locator('#password').fill('replacement123');
  await page.locator('#confirm').fill('replacement123');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  // Signed in with the new password; the new code comes first.
  const replacement = await saveCode(page);
  expect(replacement).not.toBe(code);
  await expect(page.getByRole('heading', { name: 'Join the team' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('Email or username').fill('recover_player');
  await page.locator('#password').fill('replacement123');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Join the team' })).toBeVisible();
  await page.goto('/forgot-password');
  await page.getByRole('button', { name: 'Use a recovery code instead' }).click();
  await page.getByLabel('Username', { exact: true }).fill('recover_player');
  await page.getByLabel('Recovery code', { exact: true }).fill(code);
  await page.locator('#password').fill('another-password');
  await page.locator('#confirm').fill('another-password');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByText('Invalid username or recovery code.', { exact: true })).toBeVisible();
});

test("a reload or another tab can't lose a new recovery code", async ({ page }) => {
  await startSignup(page, 'reload_player');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  const code = await page.getByLabel('Your recovery code').inputValue();
  // Safari often reloads a tab after switching to Notes and back.
  await page.reload();
  await expect(page.getByLabel('Your recovery code')).toHaveValue(code);
  await page.goto('/team');
  await expect(page.getByLabel('Your recovery code')).toHaveValue(code);
  expect(await saveCode(page)).toBe(code);
  await page.reload();
  await expect(page.getByLabel('Your recovery code')).toHaveCount(0);
});

test('the sample player Jordan signs in with a username', async ({ page }) => {
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  const login = page.getByLabel('Email or username');
  await expect(login).toHaveAttribute('autocapitalize', 'none');
  await expect(login).toHaveAttribute('autocorrect', 'off');
  await expect(login).toHaveAttribute('inputmode', 'email');
  await login.fill('jordan');
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.goto('/profile');
  await expect(page.getByText('Your username is')).toContainText('jordan');
  await expect(page.getByRole('button', { name: 'Replace recovery code' })).toBeVisible();
});

test("if the browser won't store the code, it's shown before leaving the page", async ({ page }) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'jt_unsaved_recovery_code') throw new DOMException('Storage is full', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  });
  await startSignup(page, 'full_storage');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(/\/register/);
  const code = await saveCode(page);
  await expect(page.getByRole('heading', { name: 'Join the team' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  await page.goto('/forgot-password');
  await page.getByRole('button', { name: 'Use a recovery code instead' }).click();
  await page.getByLabel('Username', { exact: true }).fill('full_storage');
  await page.getByLabel('Recovery code', { exact: true }).fill(code);
  await page.locator('#password').fill('replacement123');
  await page.locator('#confirm').fill('replacement123');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page).toHaveURL(/\/forgot-password/);
  expect(await saveCode(page)).not.toBe(code);
  await expect(page.getByRole('heading', { name: 'Join the team' })).toBeVisible();
});
