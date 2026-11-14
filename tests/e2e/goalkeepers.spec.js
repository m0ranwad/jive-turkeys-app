// Goalkeepers (docs/games.md section 2): captains record who was in goal each
// half and the goals against in each, clean sheets fill themselves in, and the
// Result card, Stats and Legacy show keepers. Goals against stay hidden until a
// captain turns on Show goals against in Team Settings.
// In the sample data, Taylor Brooks said "I'll play GK" for the next game (vs
// Goal Diggers). Taylor has kept goal 7 halves (3 clean, record 2-0-2) and Sam
// Okafor 2 (none clean, 1-1-0).
import { expect, openResult as openGameResult, signIn, test, PLAYER } from './helpers';

async function openResult(page) {
  await page.getByRole('link', { name: /vs Goal Diggers/ }).click();
  await expect(page.getByRole('heading', { name: 'vs Goal Diggers' })).toBeVisible();
  await openGameResult(page);
  const result = page.getByRole('dialog', { name: 'Game result' });
  await expect(result).toBeVisible();
  return result;
}

const keeper = (result, half) => result.getByLabel(`Keeper, ${half}`);
const against = (result, half) => result.getByLabel(`Goals against, ${half}`);
const half = (result, name) => result.locator(`[data-half="${name}"]`);
const resultCard = (page) => page.locator('section').filter({ has: page.getByRole('heading', { name: 'Result', exact: true }) });
const resultRow = (page, name) => resultCard(page).locator('div.flex').filter({ hasText: name }).first();
const goalkeepers = (page) => page.getByRole('region', { name: 'Goalkeepers' });

test('keepers come from "I\'ll play GK", goals against add up to their score, and a half at 0 is a clean sheet', async ({ page }) => {
  await signIn(page);
  const result = await openResult(page);
  const keepers = result.getByRole('region', { name: 'Keepers' });
  await expect(keepers).toContainText('From “I\'ll play GK”');
  await expect(keeper(result, '1st half').locator('option:checked')).toHaveText('Taylor Brooks');
  await expect(keeper(result, '2nd half').locator('option:checked')).toHaveText('Taylor Brooks');
  // They haven't scored yet: both halves are clean.
  await expect(against(result, '1st half')).toHaveText('0');
  await expect(half(result, '2nd half')).toContainText('Clean sheet');

  // They scored twice: nobody's sure how the goals split until a captain says.
  await result.getByRole('button', { name: 'Add a goal for Goal Diggers' }).click();
  await result.getByRole('button', { name: 'Add a goal for Goal Diggers' }).click();
  await expect(against(result, '1st half')).toHaveText('?');
  await expect(against(result, '2nd half')).toHaveText('?');
  await expect(keepers).toContainText("The halves add up to Goal Diggers' 2.");
  await expect(keepers).not.toContainText('Clean sheet');

  // Setting one half fills in the other.
  await result.getByRole('button', { name: 'Add a goal against in the 2nd half' }).click();
  await expect(against(result, '1st half')).toHaveText('1');
  await expect(against(result, '2nd half')).toHaveText('1');
  await result.getByRole('button', { name: 'Take away a goal against in the 1st half' }).click();
  await expect(against(result, '1st half')).toHaveText('0');
  await expect(against(result, '2nd half')).toHaveText('2');
  await expect(half(result, '1st half')).toContainText('Clean sheet');
  await expect(result.getByRole('button', { name: 'Add a goal against in the 2nd half' })).toBeDisabled();
  // Not sure puts both back.
  await keepers.getByRole('button', { name: 'Not sure' }).click();
  await expect(against(result, '1st half')).toHaveText('?');
  await result.getByRole('button', { name: 'Take away a goal against in the 1st half' }).click();

  // Sam played the 2nd half in goal.
  await keeper(result, '2nd half').selectOption({ label: 'Sam Okafor' });
  await expect(keepers).not.toContainText('From “I\'ll play GK”');
  await result.getByRole('button', { name: 'Save result' }).click();
  await expect(result).toHaveCount(0);

  await expect(resultRow(page, 'Taylor Brooks')).toContainText('GK · 1st half');
  await expect(resultRow(page, 'Taylor Brooks')).toContainText('Clean sheet');
  await expect(resultRow(page, 'Sam Okafor')).toContainText('GK · 2nd half');
  // Goals against are hidden to start.
  await expect(resultCard(page)).not.toContainText('against');

  // Editing the result shows what was saved.
  await openGameResult(page);
  const again = page.getByRole('dialog', { name: 'Game result' });
  await expect(keeper(again, '1st half').locator('option:checked')).toHaveText('Taylor Brooks');
  await expect(keeper(again, '2nd half').locator('option:checked')).toHaveText('Sam Okafor');
  await expect(against(again, '1st half')).toHaveText('0');
  await expect(against(again, '2nd half')).toHaveText('2');
  await expect(again.getByRole('region', { name: 'Keepers' })).not.toContainText('From “I\'ll play GK”');
});

test("a keeper who didn't play comes out of goal, and a fill-in can keep goal", async ({ page }) => {
  await signIn(page);
  const result = await openResult(page);
  await result.getByRole('button', { name: "Taylor Brooks didn't play" }).click();
  await expect(keeper(result, '1st half')).toHaveValue('');
  await expect(keeper(result, '1st half').locator('option', { hasText: 'Taylor Brooks' })).toHaveCount(0);

  await result.getByRole('button', { name: 'Add a fill-in man' }).click();
  await result.getByLabel('Name of fill-in 1').fill('Gus');
  await keeper(result, '1st half').selectOption({ label: 'Gus (fill-in)' });
  await keeper(result, '2nd half').selectOption({ label: 'Gus (fill-in)' });
  await result.getByRole('button', { name: 'Save result' }).click();
  await expect(result).toHaveCount(0);
  await expect(resultRow(page, 'Gus')).toContainText('GK · both halves');
  await expect(resultRow(page, 'Gus')).toContainText('Clean sheet');
  await expect(resultCard(page)).not.toContainText('Taylor Brooks');
});

test('Stats and Legacy show keepers, without goals against until a captain turns them on', async ({ page }) => {
  await signIn(page);
  await page.goto('/stats');
  await page.getByRole('tab', { name: 'Players' }).click();
  const card = goalkeepers(page);
  await expect(card).toBeVisible();
  const taylor = card.locator('div.grid').filter({ hasText: 'Taylor Brooks' });
  await expect(taylor).toContainText(/Taylor Brooks\s*7\s*3\s*2-0-2/);
  await expect(card.locator('div.grid').filter({ hasText: 'Sam Okafor' })).toContainText(/2\s*0\s*1-1-0/);
  await expect(card).not.toContainText('GA');

  await page.getByRole('tab', { name: 'Legacy' }).click();
  await expect(page.getByText('Halves in goal', { exact: true })).toBeVisible();
  await expect(page.getByText('Clean sheets (halves)', { exact: true })).toBeVisible();
  await expect(page.getByText('In goal: 7 halves · 3 clean sheets · record 2-0-2')).toBeVisible();

  // A captain shows goals against.
  await page.goto('/settings');
  const setting = page.getByRole('group', { name: 'Show goals against' });
  await expect(setting.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
  await setting.getByRole('button', { name: 'On' }).click();
  await expect(page.getByTestId('settings-status')).toHaveText('All changes saved');

  await page.goto('/stats');
  await page.getByRole('tab', { name: 'Players' }).click();
  await expect(goalkeepers(page)).toContainText('GA');
  await expect(goalkeepers(page).locator('div.grid').filter({ hasText: 'Taylor Brooks' })).toContainText(/7\s*3\s*4\s*2-0-2/);
  await page.getByRole('tab', { name: 'Legacy' }).click();
  await expect(page.getByText('In goal: 7 halves · 3 clean sheets · 4 against · record 2-0-2')).toBeVisible();
});

test('everyone sees who kept goal on a played game, and goals against once captains show them', async ({ page }) => {
  await signIn(page);
  // Last week: Sam in goal the 1st half, and the fill-in the 2nd. They scored 5, 1 in the 1st half.
  await page.getByRole('link', { name: /vs The Hat Tricks/ }).first().click();
  await expect(resultRow(page, 'Sam Okafor')).toContainText('GK · 1st half');
  await expect(resultRow(page, 'Fill-in')).toContainText('GK · 2nd half');
  await expect(resultCard(page)).not.toContainText('against');

  await page.goto('/settings');
  await page.getByRole('group', { name: 'Show goals against' }).getByRole('button', { name: 'On' }).click();
  await expect(page.getByTestId('settings-status')).toHaveText('All changes saved');
  await page.goto('/');
  await page.getByRole('link', { name: /vs The Hat Tricks/ }).first().click();
  await expect(resultRow(page, 'Sam Okafor')).toContainText('1 against');
  await expect(resultRow(page, 'Fill-in')).toContainText('4 against');
});

test("players see keepers but can't change who kept goal", async ({ page }) => {
  await signIn(page, PLAYER);
  await page.goto('/stats');
  await page.getByRole('tab', { name: 'Players' }).click();
  await expect(goalkeepers(page)).toContainText('Taylor Brooks');
  await page.goto('/');
  await page.getByRole('link', { name: /vs Goal Diggers/ }).click();
  await expect(page.getByRole('button', { name: /^(Enter|Edit) result$/ })).toHaveCount(0);
});
