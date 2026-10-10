// The Field Rules page: sections, the coed box, directions, the checklist and the pictures.
import { CAPTAIN, PLAYER, expect, signIn, test } from './helpers';

async function openRules(page) {
  await page.locator('a[href="/rules"]:visible').first().click();
  await expect(page.getByRole('heading', { name: 'Field Rules' })).toBeVisible();
}

test('players see the rules in sections, with directions, a checklist and pictures', async ({ page }) => {
  await signIn(page, PLAYER);
  await openRules(page);

  const directions = page.getByRole('link', { name: /Directions/ });
  await expect(directions).toContainText('8809 Lake Rd, Seville, OH');
  await expect(directions).toHaveAttribute('href', /google\.com\/maps.*8809%20Lake%20Rd/);

  const checklist = page.getByRole('region', { name: 'Game-day checklist' });
  await expect(checklist).toContainText('Waiver on file');
  await expect(checklist).toContainText('Bright green/yellow, or Black when the schedule says so.');

  const sections = page.getByRole('navigation', { name: 'Rule sections' });
  await expect(sections.getByRole('button')).toHaveText([
    'Before you play',
    'The game',
    'The ball and restarts',
    'Fouls and cards',
    'Coed rules',
  ]);

  const coed = page.getByRole('region', { name: 'Coed rules' });
  await expect(coed.getByRole('listitem')).toHaveText([
    'Two-goal limit per male.',
    'Minimum of three women field players on the field at all times. A woman playing in goal does not count as a field player.',
    'Women take all kicks.',
  ]);
  await sections.getByRole('button', { name: 'Coed rules' }).click();
  await expect(coed).toBeInViewport();

  // Each picture sits under its rule.
  const restarts = page.getByRole('region', { name: 'The ball and restarts' });
  await expect(restarts.getByRole('img', { name: 'Field drawing of the three-line rule' })).toBeVisible();
  const fouls = page.getByRole('region', { name: 'Fouls and cards' });
  await expect(fouls).toContainText('Off for 2 minutes. The team plays a player down.');
  await expect(fouls).toContainText('At least a one-game suspension.');

  await expect(page.getByRole('button', { name: 'Edit rules' })).toHaveCount(0);
});

test('captains start a new section by ending a line with a colon', async ({ page }) => {
  await signIn(page, CAPTAIN);
  await openRules(page);

  await page.getByRole('button', { name: 'Edit rules' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit field rules' });
  const fullRules = dialog.getByRole('textbox').nth(2);
  await fullRules.fill(`${await fullRules.inputValue()}\nTeam extras:\nBring water.`);
  await dialog.getByRole('button', { name: 'Save rules' }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole('navigation', { name: 'Rule sections' }).getByRole('button').last()).toHaveText(
    'Team extras',
  );
  await expect(page.getByRole('region', { name: 'Team extras' }).getByRole('listitem')).toHaveText(['Bring water.']);
});
