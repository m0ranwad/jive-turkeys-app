// Game day in the browser: answering IN updates the headcount, a captain's
// result shows on the game and in Stats, and a Player of the Match vote can be
// changed. docs/games.md lists each rule and where it's checked.
//
// Sample data: the next game is vs Goal Diggers (6 IN, 3 No reply, the captain
// among them). Last week's game vs The Hat Tricks has voting open.
import { expect, signIn, test } from './helpers';

async function openGame(page, opponent) {
  await page.getByRole('link', { name: new RegExp(`vs ${opponent}`) }).filter({ hasNotText: 'Vote for Player of the Match' }).first().click();
  await expect(page.getByRole('heading', { name: `vs ${opponent}` })).toBeVisible();
}

const group = (page, label) => page.locator(`[data-group="${label}"]`);

test('tapping IN moves you into the headcount', async ({ page }) => {
  await signIn(page);
  await openGame(page, 'Goal Diggers');
  await expect(group(page, 'IN')).toContainText('IN · 6');
  await expect(group(page, 'No reply')).toContainText('No reply · 3');

  await page.getByRole('button', { name: 'IN', exact: true }).click();
  await expect(group(page, 'IN')).toContainText('IN · 7');
  await expect(group(page, 'IN').locator('[data-player="Casey Captain"]')).toBeVisible();
  await expect(group(page, 'No reply')).toContainText('No reply · 2');

  // Changing your mind moves you again, and it sticks after a reload.
  await page.getByRole('button', { name: 'OUT', exact: true }).click();
  await expect(group(page, 'OUT').locator('[data-player="Casey Captain"]')).toBeVisible();
  await page.reload();
  await expect(group(page, 'OUT').locator('[data-player="Casey Captain"]')).toBeVisible();
  await expect(group(page, 'IN')).toContainText('IN · 6');
});

test("a captain's result shows on the game and in Stats", async ({ page }) => {
  await signIn(page);
  await openGame(page, 'Goal Diggers');
  await page.getByRole('button', { name: 'Enter result' }).click();
  const result = page.getByRole('dialog', { name: 'Game result' });
  await result.getByRole('button', { name: 'Add a goal for Alex Chen' }).click();
  await result.getByRole('button', { name: 'Save result' }).click();

  const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Result', exact: true }) });
  await expect(card).toContainText('1');
  await expect(card).toContainText('Alex Chen');

  await page.locator('a[href="/stats"]:visible').first().click();
  await page.getByRole('tab', { name: 'Opponents' }).click();
  await expect(page.getByText('Goal Diggers', { exact: true })).toBeVisible();
});

test('a Player of the Match vote can be changed', async ({ page }) => {
  await signIn(page);
  await openGame(page, 'The Hat Tricks');
  const man = page.locator('section', { hasText: 'Player of the Match' }).locator('div.rounded-2xl.bg-zinc-50', { hasText: 'Man of the Match' }).first();
  const choices = man.locator('button.rounded-full.border-2');
  const first = (await choices.first().textContent()).trim();
  const second = (await choices.nth(1).textContent()).trim();
  await choices.first().click();
  await expect(page.getByText('Vote counted')).toBeVisible();
  await expect(man).toContainText(first);

  await man.getByRole('button', { name: 'Change vote' }).click();
  await expect(man.getByRole('button', { name: first, exact: true })).toHaveClass(/bg-lime-400/);
  await man.getByRole('button', { name: second, exact: true }).click();
  await expect(page.getByText('Vote counted').last()).toBeVisible();
  await man.getByRole('button', { name: 'Change vote' }).click();
  await expect(man.getByRole('button', { name: second, exact: true })).toHaveClass(/bg-lime-400/);
  await expect(man.getByRole('button', { name: first, exact: true })).not.toHaveClass(/bg-lime-400/);
});

test("before kickoff a captain answers first, and Call for subs leads when we're short", async ({ page }) => {
  await signIn(page);
  await openGame(page, 'Goal Diggers');
  // Your RSVP comes before the captain's tools.
  const rsvp = page.getByRole('heading', { name: 'Your RSVP' });
  const tools = page.getByRole('region', { name: 'Captain tools' });
  expect((await rsvp.boundingBox()).y).toBeLessThan((await tools.boundingBox()).y);
  const buttons = tools.getByRole('button');
  await expect(buttons.first()).toHaveText('Call for subs');
  await expect(buttons.first()).toHaveClass(/bg-lime-400/);
  // Enter result is still there, last and plain, in case the game's time is wrong.
  await expect(buttons.last()).toHaveText('Enter result');
  await expect(buttons.last()).not.toHaveClass(/bg-lime-400/);

  // Once it's started, Enter result leads.
  await page.clock.fastForward('72:00:00');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Captain tools' }).getByRole('button').first()).toHaveText('Enter result');
});
