// When a save doesn't go through (no signal at the complex, an expired
// sign-in), captains are told, and what they entered stays on screen to try
// again. A result saves whole or not at all (save_game_result; checked in
// supabase/tests/games.test.sql). The demo backend acts out a dropped
// connection when jt_demo_offline is set.
import { expect, signIn, test } from './helpers';

const goOffline = (page) => page.evaluate(() => localStorage.setItem('jt_demo_offline', '1'));
const goOnline = (page) => page.evaluate(() => localStorage.removeItem('jt_demo_offline'));

async function openNextGame(page) {
  await page.getByRole('link', { name: /vs Goal Diggers/ }).filter({ hasNotText: 'Vote for Player of the Match' }).click();
  await expect(page.getByRole('heading', { name: 'vs Goal Diggers' })).toBeVisible();
}

test('a result that fails to save says so, keeps what was entered, and saves on the next try', async ({ page }) => {
  await signIn(page);
  await openNextGame(page);
  await page.getByRole('button', { name: 'Enter result' }).click();
  const result = page.getByRole('dialog', { name: 'Game result' });
  await result.getByRole('button', { name: 'Add a goal for Alex Chen' }).click();

  await goOffline(page);
  await result.getByRole('button', { name: 'Save result' }).click();
  await expect(page.getByText("That didn't save")).toBeVisible();
  await expect(page.getByText('No connection. Check your signal and try again.')).toBeVisible();
  await expect(result).toBeVisible();
  await expect(result.getByLabel('Alex Chen goals')).toHaveText('1');
  // Nothing was half-saved.
  await expect(page.locator('section').filter({ has: page.getByRole('heading', { name: 'Result', exact: true }) })).toHaveCount(0);

  await goOnline(page);
  await result.getByRole('button', { name: 'Save result' }).click();
  await expect(page.getByText('Result saved')).toBeVisible();
  await expect(result).toHaveCount(0);
});

test('editing a game that fails to save says so and stays open', async ({ page }) => {
  await signIn(page);
  await openNextGame(page);
  await page.getByRole('button', { name: /^Edit game$|^Edit$/ }).first().click();
  const form = page.getByRole('dialog');
  await goOffline(page);
  await form.getByRole('button', { name: /Save/ }).click();
  await expect(page.getByText("That didn't save")).toBeVisible();
  await expect(form).toBeVisible();
});

test('changing your roster status with no signal says so', async ({ page }) => {
  await signIn(page);
  await page.goto('/profile');
  await goOffline(page);
  await page.getByRole('button', { name: 'Sub Pool' }).click();
  await expect(page.getByText("That didn't save")).toBeVisible();
});
