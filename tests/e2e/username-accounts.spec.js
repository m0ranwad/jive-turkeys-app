import { expect, playerOptions, signIn, test } from './helpers';

const PASSWORD = 'password123';
async function signOutFromProfile(page) {
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
}
async function logIn(page, login, password) {
  await page.getByLabel('Email or username').fill(login);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
}

test('a new player signs up with a username and the team code, and goes straight in', async ({ page }) => {
  await signOutFromProfile(page);
  await page.getByRole('link', { name: 'Create one' }).click();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  // Username is the first choice and already picked, with one password box.
  await expect(page.getByRole('button', { name: 'Username (no email)' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#email')).toHaveCount(0);
  await expect(page.locator('#confirm')).toHaveCount(0);

  await page.getByLabel('Username', { exact: true }).fill('Josh Smith');
  await page.getByLabel('Team code', { exact: true }).fill('turkey');
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByText("Usernames can't have spaces or symbols. How about josh_smith?")).toBeVisible();
  await page.getByLabel('Username', { exact: true }).fill('josh.smith');
  await page.getByLabel('Team code', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByText('That team code is not right. Ask a captain for the code.')).toBeVisible();
  await page.getByLabel('Team code', { exact: true }).fill('turkey');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  // No codes to save: the usual roster-name setup comes next.
  await expect(page.getByRole('heading', { name: 'Join the team' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await logIn(page, 'Josh.Smith ', PASSWORD);
  await expect(page.getByRole('heading', { name: 'Join the team' })).toBeVisible();
});

test('a failed log in says what usually went wrong', async ({ page }) => {
  await signOutFromProfile(page);
  const login = page.getByLabel('Email or username');
  await expect(login).toHaveAttribute('autocapitalize', 'none');
  await expect(login).toHaveAttribute('autocorrect', 'off');
  await expect(login).toHaveAttribute('inputmode', 'email');
  await logIn(page, 'Jordan Rivera', 'demo1234');
  await expect(page.getByText("Your username isn't your name on the team. Forgot it, or your password? Ask a captain.")).toBeVisible();
  await logIn(page, 'jordan@demo.test', 'wrong-password');
  await expect(page.getByText('Signed up with Google? Use Continue with Google. Forgot your password? Tap Forgot password.')).toBeVisible();
  await logIn(page, 'jordan', 'demo1234');
  await page.goto('/profile');
  await expect(page.getByText('Your username is')).toContainText('jordan');
});

test('an email player adds a username and keeps their password', async ({ page }) => {
  await signIn(page);
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Add a username', exact: true }).click();
  await page.getByLabel('Username', { exact: true }).fill('casey_cap');
  await page.getByLabel('Your password').fill('wrong-password');
  await page.getByRole('button', { name: 'Add username', exact: true }).click();
  await expect(page.getByText("That isn't your password.")).toBeVisible();
  await page.getByLabel('Your password').fill('demo1234');
  await page.getByRole('button', { name: 'Add username', exact: true }).click();
  await expect(page.getByText('casey_cap', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await logIn(page, 'CASEY_CAP', 'demo1234');
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Casey Captain', exact: true })).toBeVisible();
  await expect(page.getByText('captain@demo.test', { exact: true })).toBeVisible();
});

test('a captain resets a teammate’s password, and the teammate uses the code once', async ({ page }) => {
  await signIn(page);
  await page.goto('/team');
  // Players without a username have nothing to reset here.
  await expect((await playerOptions(page, 'Sam Okafor')).getByRole('button', { name: /password/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  const options = await playerOptions(page, 'Jordan Rivera');
  await expect(options.getByText('Signs in with the username jordan')).toBeVisible();
  await options.getByRole('button', { name: "Reset Jordan's password" }).click();
  const code = await options.getByTestId('reset-code').innerText();
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const text = options.getByRole('link', { name: 'Text it' });
  await expect(text).toHaveAttribute('href', new RegExp(`^sms:.*${code}`));
  await expect(options.getByRole('button', { name: 'Copy message' })).toBeVisible();
  await page.keyboard.press('Escape');

  await signOutFromProfile(page);
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await page.getByRole('button', { name: 'Signed up with a username? Use a code from a captain' }).click();
  await page.getByLabel('Username', { exact: true }).fill('jordan');
  await page.getByLabel('Code from your captain').fill('ABCD-EFGH');
  await page.locator('#password').fill('fresh-pass');
  await page.getByRole('button', { name: 'Set new password', exact: true }).click();
  await expect(page.getByText("That code isn't right, or it has run out. Ask a captain for a new one.")).toBeVisible();
  await page.getByLabel('Code from your captain').fill(code.toLowerCase());
  await page.getByRole('button', { name: 'Set new password', exact: true }).click();
  // Signed straight in with the new password.
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();

  await signOutFromProfile(page);
  await logIn(page, 'jordan', 'demo1234');
  await expect(page.getByText('Invalid email, username, or password')).toBeVisible();
  await logIn(page, 'jordan', 'fresh-pass');
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  await page.goto('/forgot-password');
  await page.getByRole('button', { name: 'Signed up with a username? Use a code from a captain' }).click();
  await page.getByLabel('Username', { exact: true }).fill('jordan');
  await page.getByLabel('Code from your captain').fill(code);
  await page.locator('#password').fill('another-pass');
  await page.getByRole('button', { name: 'Set new password', exact: true }).click();
  await expect(page.getByText("That code isn't right, or it has run out. Ask a captain for a new one.")).toBeVisible();
});

test('a captain sees a failed save without signal and can retry', async ({ page }) => {
  await signIn(page);
  await page.goto('/team');
  const options = await playerOptions(page, 'Jordan Rivera');
  await page.evaluate(() => localStorage.setItem('jt_demo_offline', '1'));
  await options.getByRole('button', { name: "Reset Jordan's password" }).click();
  await expect(page.getByText("That didn't save", { exact: true })).toBeVisible();
  await expect(options.getByTestId('reset-code')).toHaveCount(0);
  await page.evaluate(() => localStorage.removeItem('jt_demo_offline'));
  await options.getByRole('button', { name: "Reset Jordan's password" }).click();
  await expect(options.getByTestId('reset-code')).toBeVisible();
});

test('a code replaced in a second tab cannot reset the password in the older tab', async ({ page }) => {
  await signIn(page);
  await page.goto('/team');
  const options = await playerOptions(page, 'Jordan Rivera');
  await options.getByRole('button', { name: "Reset Jordan's password" }).click();
  const first = await options.getByTestId('reset-code').innerText();

  const captain = await page.context().newPage();
  const errors = [];
  captain.on('pageerror', (err) => errors.push(err.message));
  captain.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  try {
    await captain.clock.install({ time: new Date('2026-10-08T12:00:00') });
    await captain.goto('/team');
    const otherOptions = await playerOptions(captain, 'Jordan Rivera');
    await page.goto('/forgot-password');
    await page.getByRole('button', { name: 'Signed up with a username? Use a code from a captain' }).click();
    await page.getByLabel('Username', { exact: true }).fill('jordan');
    await page.getByLabel('Code from your captain').fill(first);
    await page.locator('#password').fill('fresh-password');

    await otherOptions.getByRole('button', { name: "Reset Jordan's password" }).click();
    const second = await otherOptions.getByTestId('reset-code').innerText();
    await page.getByRole('button', { name: 'Set new password', exact: true }).click();
    await expect(page.getByText("That code isn't right, or it has run out. Ask a captain for a new one.")).toBeVisible();
    await page.getByLabel('Code from your captain').fill(second);
    await page.getByRole('button', { name: 'Set new password', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Schedule', exact: true })).toBeVisible();
    await signOutFromProfile(page);
    await logIn(page, 'jordan', 'demo1234');
    await expect(page.getByText('Invalid email, username, or password')).toBeVisible();
    await logIn(page, 'jordan', 'fresh-password');
    await expect(page.getByRole('heading', { name: 'Schedule', exact: true })).toBeVisible();
    expect(errors, 'the second tab reported errors').toEqual([]);
  } finally {
    await captain.close();
  }
});
