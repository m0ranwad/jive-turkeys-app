// Teammates who haven't joined the site (roster names) in games: captains set
// their RSVPs and stat lines, they count in headcounts and stats, teammates can
// vote for them, and it all comes with them when they join. The database
// enforces who can change what (supabase/tests/games.test.sql).
//
// Sample data: the next game is vs Goal Diggers. Mike Russo (IN) and Dana Wells
// (MAYBE) haven't joined; Casey, Chris and Kelly haven't answered; Jamie is on
// break and hasn't either.
import { enterTeamCode, expect, signIn, test } from './helpers';

async function openNextGame(page) {
  // Not the "Vote for Player of the Match" card, once there's a result.
  await page.getByRole('link', { name: /vs Goal Diggers/ }).filter({ hasNotText: 'Vote for Player of the Match' }).click();
  await expect(page.getByRole('heading', { name: 'vs Goal Diggers' })).toBeVisible();
}

const group = (page, label) => page.locator(`[data-group="${label}"]`);
const chip = (page, label, name) => group(page, label).locator(`[data-player="${name}"]`);

test('captains RSVP for teammates who have not joined, and the headcount counts them', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page);
  await openNextGame(page);

  await expect(chip(page, 'IN', 'Mike Russo')).toHaveClass(/border-dashed/);
  await expect(chip(page, 'MAYBE', 'Dana Wells')).toBeVisible();
  await expect(group(page, 'IN')).toContainText('IN · 6');
  await expect(group(page, 'No reply')).toContainText('No reply · 3');
  await expect(group(page, 'Unavailable')).toContainText('Jamie Fox');
  await expect(group(page, 'No reply')).not.toContainText('Jamie Fox');

  // The reminder only nags Active players.
  await page.getByRole('button', { name: 'Copy reminder' }).click();
  const reminder = await page.evaluate(() => navigator.clipboard.readText());
  expect(reminder).toContain('Still to RSVP: Casey Captain, Chris Dunn, Kelly Moss');

  await page.getByRole('button', { name: 'RSVP for Dana Wells' }).click();
  const dialog = page.getByRole('dialog', { name: 'Dana Wells' });
  await expect(dialog).toContainText("Hasn't joined the site, so you RSVP for them.");
  await dialog.getByRole('button', { name: 'IN', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'IN', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: /Playing GK/ }).click();
  await expect(dialog.getByRole('button', { name: /Playing GK/ })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(chip(page, 'IN', 'Dana Wells')).toContainText('GK');
  await expect(group(page, 'IN')).toContainText('IN · 7');

  // A player on the site who texted the captain instead.
  await page.getByRole('button', { name: 'RSVP for Kelly Moss' }).click();
  await page.getByRole('dialog', { name: 'Kelly Moss' }).getByRole('button', { name: 'OUT', exact: true }).click();
  await page.getByRole('dialog', { name: 'Kelly Moss' }).getByRole('button', { name: 'Done' }).click();
  await expect(chip(page, 'OUT', 'Kelly Moss')).toBeVisible();
  await expect(group(page, 'No reply')).toContainText('No reply · 2');

  // And clearing an answer.
  await page.getByRole('button', { name: 'RSVP for Kelly Moss' }).click();
  await page.getByRole('dialog', { name: 'Kelly Moss' }).getByRole('button', { name: 'Clear (no reply)' }).click();
  await page.getByRole('dialog', { name: 'Kelly Moss' }).getByRole('button', { name: 'Done' }).click();
  await expect(chip(page, 'No reply', 'Kelly Moss')).toBeVisible();
});

test('players see teammates who have not joined, but cannot set anyone else\'s RSVP', async ({ page }) => {
  await signIn(page, 'jordan@demo.test');
  await openNextGame(page);
  await expect(chip(page, 'IN', 'Mike Russo')).toBeVisible();
  await expect(page.getByRole('button', { name: /^RSVP for/ })).toHaveCount(0);
});

test('a teammate who has not joined gets a stat line, shows in the stats, and can win Player of the Match', async ({ page }) => {
  await signIn(page);
  await openNextGame(page);
  await page.getByRole('button', { name: 'Enter result' }).click();
  const result = page.getByRole('dialog', { name: 'Game result' });
  await expect(result.locator('[data-player="Mike Russo"]')).toContainText('M · Not joined');
  await result.getByRole('button', { name: 'Add a goal for Mike Russo' }).click();
  await result.getByRole('button', { name: 'Save result' }).click();
  await expect(page.getByText('Result saved')).toBeVisible();

  await page.locator('a[href="/stats"]:visible').first().click();
  await page.getByRole('tab', { name: 'Players' }).click();
  const mikeRow = page.locator('div.grid', { hasText: 'Mike Russo' }).last();
  await expect(mikeRow).toContainText('Not joined');

  // Jordan played (she was IN), so she can vote, for Mike too.
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /Sign out/ }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.locator('#email').fill('jordan@demo.test');
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Log in' }).click();
  await openNextGame(page);
  await page.getByRole('button', { name: 'Mike Russo', exact: true }).click();
  await expect(page.getByText('Vote counted')).toBeVisible();
  await expect(page.locator('section', { hasText: 'Player of the Match' })).toContainText('Mike Russo1 vote');
});

test('when they join and pick their name, their RSVP and stats come with them', async ({ page }) => {
  await page.goto('/register');
  await page.locator('#email').fill('mike@demo.test');
  await page.locator('#password').fill('demo1234');
  await page.locator('#confirm').fill('demo1234');
  await page.getByRole('button', { name: 'Create account' }).click();
  await enterTeamCode(page);
  await page.getByRole('button', { name: 'Mike Russo' }).click();
  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Start using the app' }).click();
  await reloaded;
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();

  await openNextGame(page);
  await expect(page.getByRole('button', { name: 'IN', exact: true })).toHaveClass(/bg-lime-400/);
  await expect(chip(page, 'IN', 'Mike Russo')).not.toHaveClass(/border-dashed/);

  await page.locator('a[href="/stats"]:visible').first().click();
  await page.getByRole('tab', { name: 'Players' }).click();
  const mikeRow = page.locator('div.grid', { hasText: 'Mike Russo' }).last();
  await expect(mikeRow).toBeVisible();
  await expect(mikeRow).not.toContainText('Not joined');
});
