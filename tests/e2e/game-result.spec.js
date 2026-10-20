// Captains enter a game's result: it fits a phone, goals go in with + and −,
// our score adds itself up, men stop at two goals (coed rule), and fill-ins
// from outside the team can score for us.
// In the sample data, Alex Chen, Jordan Rivera, Mike Russo (hasn't joined),
// Riley Novak, Sam Okafor and Taylor Brooks said IN for the next game.
import { expect, isPhone, signIn, test } from './helpers';

async function openResult(page) {
  await page.getByRole('link', { name: /vs Goal Diggers/ }).click();
  await expect(page.getByRole('heading', { name: 'vs Goal Diggers' })).toBeVisible();
  await page.getByRole('button', { name: /^(Enter|Edit) result$/ }).click();
  const result = page.getByRole('dialog', { name: 'Game result' });
  await expect(result).toBeVisible();
  return result;
}

const player = (result, name) => result.locator(`[data-player="${name}"]`);
const resultCard = (page) => page.locator('section').filter({ has: page.getByRole('heading', { name: 'Result', exact: true }) });

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('fits the screen, with the score and Save in reach', async ({ page }, testInfo) => {
  const result = await openResult(page);
  const viewport = page.viewportSize();
  // The screen zooms in as it opens; measure it once it has settled.
  await result.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));

  // Nothing slides sideways.
  for (const el of [result, result.locator('.overflow-y-auto')]) {
    const { scrollWidth, clientWidth } = await el.evaluate((n) => ({ scrollWidth: n.scrollWidth, clientWidth: n.clientWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  }
  const box = await result.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  if (isPhone(testInfo)) expect(box.width).toBe(viewport.width);

  // Both scores and Save show without scrolling, and no keyboard pops up.
  for (const el of [result.getByLabel('Jive Turkeys score'), result.getByLabel('Goal Diggers score'), result.getByRole('button', { name: 'Save result' })]) {
    await expect(el).toBeInViewport({ ratio: 1 });
  }
  await expect(result.getByLabel('Jive Turkeys score')).not.toBeFocused();

  // Only the people who played are listed.
  await expect(result).toContainText('Who played · 6');
  await expect(player(result, 'Taylor Brooks')).toBeVisible();
  await expect(player(result, 'Kelly Moss')).toHaveCount(0);
});

test('goals, assists and cards go in with + and −, and our score adds itself up', async ({ page }) => {
  const result = await openResult(page);
  const ourScore = result.getByLabel('Jive Turkeys score');
  await expect(ourScore).toHaveValue('0');

  await result.getByRole('button', { name: 'Add a goal for Jordan Rivera' }).click();
  await result.getByRole('button', { name: 'Add a goal for Mike Russo' }).click();
  await result.getByRole('button', { name: 'Add a goal for Mike Russo' }).click();
  await expect(ourScore).toHaveValue('3');

  // Men stop at two goals.
  await expect(result.getByRole('button', { name: 'Add a goal for Mike Russo' })).toBeDisabled();
  await expect(player(result, 'Mike Russo')).toContainText('2-goal limit');
  await expect(result.getByLabel('Mike Russo goals')).toHaveText('2');
  // Women don't.
  await result.getByRole('button', { name: 'Add a goal for Jordan Rivera' }).click();
  await result.getByRole('button', { name: 'Add a goal for Jordan Rivera' }).click();
  await expect(result.getByRole('button', { name: 'Add a goal for Jordan Rivera' })).toBeEnabled();
  await result.getByRole('button', { name: 'Take away a goal from Jordan Rivera' }).click();
  await result.getByRole('button', { name: 'Take away a goal from Jordan Rivera' }).click();
  await expect(ourScore).toHaveValue('3');

  await result.getByRole('button', { name: 'Add an assist for Riley Novak' }).click();
  await expect(result.getByLabel('Riley Novak assists')).toHaveText('1');

  // Cards are tucked away until asked for.
  await expect(result.getByRole('button', { name: 'Add a blue card for Alex Chen' })).toHaveCount(0);
  await result.getByRole('button', { name: 'Card for Alex Chen' }).click();
  await result.getByRole('button', { name: 'Add a blue card for Alex Chen' }).click();
  await expect(player(result, 'Alex Chen')).toContainText('1 blue');

  await result.getByRole('button', { name: 'Add a goal for Goal Diggers' }).click();
  await result.getByRole('button', { name: 'Add a goal for Goal Diggers' }).click();

  // A captain can change our score (say, an own goal), and put it back.
  await result.getByRole('button', { name: 'Add a goal for Jive Turkeys' }).click();
  await expect(ourScore).toHaveValue('4');
  await expect(result).toContainText("Players' goals: 3 · Score: 4");
  await result.getByRole('button', { name: 'Use 3' }).click();
  await expect(ourScore).toHaveValue('3');
  await expect(result).not.toContainText("Players' goals:");

  await result.getByRole('button', { name: 'Save result' }).click();
  await expect(page.getByText('Result saved')).toBeVisible();
  await expect(result).toBeHidden();
  const card = resultCard(page);
  await expect(card).toContainText('3–2');
  await expect(card).toContainText('Mike Russo2G');
  await expect(card).toContainText('Jordan Rivera1G');
  await expect(card).toContainText('Riley Novak1A');
  await expect(card).toContainText('Alex Chen1 blue');
});

test("take off a no-show, add someone who came anyway, and Edit result opens as saved", async ({ page }) => {
  let result = await openResult(page);

  await result.getByRole('button', { name: "Taylor Brooks didn't play" }).click();
  await expect(player(result, 'Taylor Brooks')).toHaveCount(0);
  await expect(result).toContainText('Who played · 5');

  await result.getByRole('button', { name: 'Add a player' }).click();
  await result.getByRole('button', { name: 'Add Kelly Moss' }).click();
  await expect(result.getByRole('button', { name: 'Add Kelly Moss' })).toHaveCount(0);
  await result.getByRole('button', { name: 'Done' }).click();
  await result.getByRole('button', { name: 'Add a goal for Kelly Moss' }).click();

  // A red card from the bench stays on the list.
  await result.getByRole('button', { name: 'Card for Sam Okafor' }).click();
  await result.getByRole('button', { name: 'Add a red card for Sam Okafor' }).click();
  await result.getByRole('button', { name: "Sam Okafor didn't play" }).click();
  await expect(player(result, 'Sam Okafor')).toContainText("Didn't play");
  await expect(player(result, 'Sam Okafor')).toContainText('1 red');

  // Our score doesn't match the goals: an own goal by the other team.
  await result.getByRole('button', { name: 'Add a goal for Jive Turkeys' }).click();
  await expect(result).toContainText("Players' goals: 1 · Score: 2");

  await result.getByRole('button', { name: 'Save result' }).click();
  await expect(page.getByText('Result saved')).toBeVisible();
  await expect(resultCard(page)).toContainText('Kelly Moss1G');
  await expect(resultCard(page)).not.toContainText('Taylor Brooks');

  await page.getByRole('button', { name: 'Edit result' }).click();
  result = page.getByRole('dialog', { name: 'Game result' });
  await expect(result.getByLabel('Jive Turkeys score')).toHaveValue('2');
  await expect(result).toContainText("Players' goals: 1 · Score: 2");
  await expect(result.getByLabel('Kelly Moss goals')).toHaveText('1');
  await expect(player(result, 'Taylor Brooks')).toHaveCount(0);
  await expect(player(result, 'Sam Okafor')).toContainText("Didn't play");
  await expect(result.getByLabel('Sam Okafor red cards')).toHaveText('1');
  await expect(result).toContainText('Who played · 5');

  // Cancel leaves it as it was.
  await result.getByRole('button', { name: 'Add a goal for Kelly Moss' }).click();
  await result.getByRole('button', { name: 'Cancel' }).click();
  await expect(resultCard(page)).toContainText('2–0');
  await expect(resultCard(page)).toContainText('Kelly Moss1G');
});

test('fill-ins from outside the team: a name if anyone caught it, and their goals count', async ({ page }) => {
  let result = await openResult(page);
  const ourScore = result.getByLabel('Jive Turkeys score');

  await result.getByRole('button', { name: 'Add a fill-in man' }).click();
  await expect(result.locator('[data-fill-in]')).toHaveCount(1);
  await expect(result.locator('[data-fill-in="Fill-in"]')).toContainText('M · Fill-in, not on the team');
  await result.getByRole('button', { name: 'Add a goal for Fill-in' }).click();
  await result.getByRole('button', { name: 'Add a goal for Fill-in' }).click();
  // Men stop at two, fill-ins too.
  await expect(result.getByRole('button', { name: 'Add a goal for Fill-in' })).toBeDisabled();
  await expect(ourScore).toHaveValue('2');
  await expect(result).toContainText('Who played · 7');

  // A second one is numbered until someone types a name.
  await result.getByRole('button', { name: 'Add a fill-in woman' }).click();
  await result.getByRole('button', { name: 'Add a goal for Fill-in 2' }).click();
  await result.getByLabel('Name of fill-in 2').fill('Lena');
  await result.getByRole('button', { name: 'Add a goal for Lena' }).click();
  await expect(result.getByRole('button', { name: 'Add a goal for Lena' })).toBeEnabled();
  await expect(ourScore).toHaveValue('4');
  // A teammate who set one up still gets the assist.
  await result.getByRole('button', { name: 'Add an assist for Jordan Rivera' }).click();

  await result.getByRole('button', { name: 'Save result' }).click();
  await expect(page.getByText('Result saved')).toBeVisible();
  const card = resultCard(page);
  await expect(card).toContainText('4–0');
  await expect(card).toContainText('Fill-in 12G');
  await expect(card).toContainText('Lenafill-in2G');
  await expect(card).toContainText('Jordan Rivera1A');

  // They're only on that game, so the leaderboards never show them.
  await page.locator('a[href="/stats"]:visible').first().click();
  await page.getByRole('tab', { name: 'Players' }).click();
  await expect(page.getByText('Jordan Rivera').first()).toBeVisible();
  await expect(page.getByText('Lena')).toHaveCount(0);

  // Edit result brings them back; taking one off takes their goals off the score.
  await page.goBack();
  await page.goBack();
  result = await openResult(page);
  await expect(result.getByLabel('Name of fill-in 2')).toHaveValue('Lena');
  await expect(result.getByLabel('Fill-in 1 goals')).toHaveText('2');
  await expect(result.getByLabel('Jive Turkeys score')).toHaveValue('4');
  await result.getByRole('button', { name: 'Remove Fill-in 1' }).click();
  await expect(result.getByLabel('Jive Turkeys score')).toHaveValue('2');
  await result.getByRole('button', { name: 'Save result' }).click();
  await expect(page.getByText('Result saved')).toBeVisible();
  await expect(resultCard(page)).toContainText('2–0');
  await expect(resultCard(page)).not.toContainText('Fill-in');
  await expect(resultCard(page)).toContainText('Lenafill-in2G');
});
