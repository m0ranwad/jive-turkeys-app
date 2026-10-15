// The Next game card at the top of Schedule: when and where, the headcount,
// and your answer right there; answers from the upcoming games list; earlier
// sessions folded away. docs/games.md lists the rules.
//
// Sample data: the next game is vs Goal Diggers (6 IN, the captain hasn't
// answered), in session 2; session 1 is over, and last season's game is older.
import { expect, signIn, test } from './helpers';

const nextGame = (page) => page.getByRole('region', { name: 'Next game' });

test('the next game is at the top of Schedule, and you answer right there', async ({ page }) => {
  await signIn(page);
  const card = nextGame(page);
  await expect(card).toContainText('vs Goal Diggers');
  await expect(card).toContainText('6 in');
  await expect(card).toContainText("You haven't answered");

  await card.getByRole('button', { name: 'IN', exact: true }).click();
  await expect(card.getByRole('button', { name: 'IN', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(card).toContainText('7 in');
  await expect(card).toContainText('Your answer');

  // The game page agrees, and so does a reload.
  await card.getByRole('link', { name: /Details/ }).click();
  await expect(page.locator('[data-group="IN"] [data-player="Casey Captain"]')).toBeVisible();
  await page.goBack();
  await page.reload();
  await expect(nextGame(page).getByRole('button', { name: 'IN', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('later games can be answered from the list', async ({ page }) => {
  await signIn(page);
  const answers = page.getByRole('group', { name: /^Your answer for vs / });
  await expect(answers.first()).toBeVisible();
  const first = answers.first();
  await first.getByRole('button', { name: 'OUT', exact: true }).click();
  await expect(first.getByRole('button', { name: 'OUT', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(answers.first().getByRole('button', { name: 'OUT', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('sessions before the last one are folded away until you open them', async ({ page }) => {
  await signIn(page);
  // This session and the one before stay open.
  await expect(page.getByRole('heading', { name: /· Session 2$/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /· Session 1$/ })).toBeVisible();
  // Last season's game is folded.
  const toggle = page.getByRole('button', { name: /^Past sessions/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('heading', { name: /· Session 3$/ })).toHaveCount(0);
  await toggle.click();
  await expect(page.getByRole('heading', { name: /· Session 3$/ })).toBeVisible();
});
