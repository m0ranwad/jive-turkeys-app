// Game day in the browser: answering IN updates the headcount, a captain's
// result shows on the game and in Stats, and a Player of the Match vote can be
// changed. docs/games.md lists each rule and where it's checked.
//
// Sample data: the next game is vs Goal Diggers (6 IN, 3 No reply, the captain
// among them). Last week's game vs The Hat Tricks has voting open.
import { expect, openResult, signIn, test, whoTab } from './helpers';

async function openGame(page, opponent) {
  await page.getByRole('link', { name: new RegExp(`vs ${opponent}`) }).filter({ hasNotText: 'Vote for Player of the Match' }).first().click();
  await expect(page.getByRole('heading', { name: `vs ${opponent}` })).toBeVisible();
}

const group = (page, label) => page.locator(`[data-group="${label}"]`);

test('tapping IN moves you into the headcount', async ({ page }) => {
  await signIn(page);
  await openGame(page, 'Goal Diggers');
  await expect(whoTab(page, 'In')).toHaveText('In 6');
  await whoTab(page, 'Not in yet').click();
  await expect(group(page, 'No reply')).toContainText('No reply · 3');

  await page.getByRole('button', { name: 'IN', exact: true }).click();
  await expect(whoTab(page, 'In')).toHaveText('In 7');
  await expect(group(page, 'No reply')).toContainText('No reply · 2');
  await whoTab(page, 'In').click();
  await expect(group(page, 'IN').locator('[data-player="Casey Captain"]')).toBeVisible();
  await expect(group(page, 'IN').locator('[data-player="Casey Captain"]')).toContainText('You');

  // Changing your mind moves you again, and it sticks after a reload.
  await page.getByRole('button', { name: 'OUT', exact: true }).click();
  await whoTab(page, 'Out').click();
  await expect(group(page, 'OUT').locator('[data-player="Casey Captain"]')).toBeVisible();
  await page.reload();
  await whoTab(page, 'Out').click();
  await expect(group(page, 'OUT').locator('[data-player="Casey Captain"]')).toBeVisible();
  await expect(whoTab(page, 'In')).toHaveText('In 6');
});

test('Who\'s coming shows the spots on the field, and what each game still needs', async ({ page }) => {
  await signIn(page);
  const spots = page.getByRole('img', { name: /spots filled/ });

  // Goal Diggers: 2 girls and 4 guys, Taylor in goal.
  await openGame(page, 'Goal Diggers');
  await expect(spots).toHaveAccessibleName('6 of 8 spots filled, goal covered, 2 of 3 girls\' spots, 3 of 4 open spots');
  await expect(page.getByText('Need 2 more, including a girl')).toBeVisible();
  await expect(page.getByText('No goalie yet')).toHaveCount(0);
  await expect(group(page, 'Guys').locator('[data-player="Taylor Brooks"]')).toContainText('GK');

  // Net Ninjas: a full team, Taylor and Sam sharing goal. The second keeper isn't extra; the 6th guy is.
  await page.goBack();
  await openGame(page, 'Net Ninjas');
  await expect(spots).toHaveAccessibleName('8 of 8 spots filled, goal covered, 3 of 3 girls\' spots, 4 of 4 open spots, 1 on the bench');
  await expect(page.getByText('Full team')).toBeVisible();
  await expect(group(page, 'Guys').locator('[data-player="Sam Okafor"]')).toContainText('GK');
  await expect(group(page, 'Guys').locator('[data-player="Taylor Brooks"]')).toContainText('GK');

  // Grass Kickers: 1 girl and 5 guys, nobody has offered to play GK.
  await page.goBack();
  await openGame(page, 'Grass Kickers');
  await expect(spots).toHaveAccessibleName('6 of 8 spots filled, no goalie yet, 1 of 3 girls\' spots, 4 of 4 open spots');
  await expect(page.getByText('Need 2 more girls')).toBeVisible();
  await expect(page.getByText('No goalie yet')).toBeVisible();

  // Saying you'll play GK covers the goal.
  await page.getByRole('button', { name: 'IN', exact: true }).click();
  await page.getByRole('button', { name: "I'll play GK" }).click();
  await expect(page.getByRole('button', { name: "I'll play GK" })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('No goalie yet')).toHaveCount(0);
  await expect(spots).toHaveAccessibleName(/goal covered/);
});

test("a captain's result shows on the game and in Stats", async ({ page }) => {
  await signIn(page);
  await openGame(page, 'Goal Diggers');
  await openResult(page);
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
  // Your answer comes before the captain's tools.
  const rsvp = page.getByRole('group', { name: 'Your answer' });
  const tools = page.getByRole('region', { name: 'Captain tools' });
  expect((await rsvp.boundingBox()).y).toBeLessThan((await tools.boundingBox()).y);
  const buttons = tools.getByRole('button');
  await expect(buttons.first()).toHaveText('Call for subs');
  await expect(buttons.first()).toHaveClass(/bg-lime-400/);
  // Enter result is still there under More, plain, in case the game's time is wrong; so are Edit and Delete.
  await expect(buttons.last()).toHaveAccessibleName('More');
  await expect(tools.getByRole('button', { name: 'Enter result' })).toHaveCount(0);
  await buttons.last().click();
  await expect(buttons.last()).toHaveText('Delete game');
  await expect(tools.getByRole('button', { name: 'Edit game' })).toBeVisible();
  await expect(tools.getByRole('button', { name: 'Enter result' })).not.toHaveClass(/bg-lime-400/);

  // Once it's started, Enter result leads, without reloading a page left open since before kickoff.
  await page.clock.fastForward(72 * 60 * 60 * 1000);
  await expect(buttons.first()).toHaveText('Enter result');
  await expect(buttons.first()).toHaveClass(/bg-lime-400/);
});

test('a played game leads with the result and the vote, with who said IN folded away', async ({ page }) => {
  await signIn(page);
  await openGame(page, 'Ball Busters');
  const result = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Result', exact: true }) });
  const vote = page.locator('#vote');
  const rsvps = page.locator('details', { hasText: 'Who said they were in' });
  const y = async (locator) => (await locator.boundingBox()).y;
  expect(await y(result)).toBeLessThan(await y(vote));
  expect(await y(vote)).toBeLessThan(await y(rsvps));
  // Folded until tapped, and no shortage on a game that's been played.
  await expect(rsvps.locator('[data-group="IN"]')).toBeHidden();
  await rsvps.getByText('Who said they were in').click();
  await expect(rsvps.locator('[data-group="IN"]')).toBeVisible();
  await expect(rsvps).not.toContainText('Short');
});

