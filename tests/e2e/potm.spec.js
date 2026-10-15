// Player of the Match voting closes a set time after the result is posted.
// Players who played and still have a vote to cast see a card on Schedule;
// the game shows when voting closes; votes lock after that; captains set the
// timing and notifications in Team Settings. The database enforces the deadline
// and sends the notifications (supabase/tests/potm.test.sql).
//
// Sample data (clock fixed at Thu Oct 8, noon): last week's result (vs The Hat
// Tricks) went up 3 hours ago, so voting is open until 9:00 PM; the captain
// voted for Woman of the Match but not Man. Voting on earlier games has closed.
import { expect, openChat, signIn, test } from './helpers';

async function openGame(page, opponent) {
  await page.getByRole('link', { name: new RegExp(`vs ${opponent}`) }).first().click();
  await expect(page.getByRole('heading', { name: `vs ${opponent}` })).toBeVisible();
}

const potm = (page) => page.locator('section', { hasText: 'Player of the Match' });

test('a player who still has a vote to cast is asked on Schedule, until they vote', async ({ page }) => {
  await signIn(page);
  const card = page.getByTestId('potm-prompt');
  await expect(card).toContainText('Vote for Player of the Match');
  await expect(card).toContainText('2–5 L vs The Hat Tricks · Voting closes Thu 9:00 PM');

  await card.getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'vs The Hat Tricks' })).toBeVisible();
  await expect(page.getByTestId('potm-deadline')).toHaveText('Voting open until Thu 9:00 PM');
  const man = potm(page).locator('div.rounded-2xl', { hasText: 'Man of the Match' });
  await man.getByRole('button').first().click();
  await expect(page.getByText('Vote counted')).toBeVisible();

  await page.locator('a[href="/"]:visible').first().click();
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  await expect(page.getByTestId('potm-prompt')).toHaveCount(0);
});

test('once voting has closed, the game shows the winners and takes no votes', async ({ page }) => {
  await signIn(page);
  await openGame(page, 'Ball Busters');
  await expect(page.getByTestId('potm-deadline')).toHaveText('Voting closed');
  await expect(potm(page).getByRole('button', { name: 'Change vote' })).toHaveCount(0);
  await expect(potm(page)).toContainText('votes');
});

test('when the deadline passes, voting locks, even on a page left open', async ({ page }) => {
  await signIn(page);
  await openGame(page, 'The Hat Tricks');
  await expect(page.getByTestId('potm-deadline')).toHaveText('Voting open until Thu 9:00 PM');
  const man = potm(page).locator('div.rounded-2xl', { hasText: 'Man of the Match' });
  await expect(man.getByRole('button').first()).toBeVisible();
  // 9 hours later, without a reload.
  await page.clock.fastForward('09:01:00');
  await expect(page.getByTestId('potm-deadline')).toHaveText('Voting closed');
  await expect(potm(page).getByRole('button', { name: 'Change vote' })).toHaveCount(0);
  await expect(man.locator('button.rounded-full.border-2')).toHaveCount(0);
});

test('posting a result opens voting for the time set in Team Settings', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('link', { name: 'Team Settings' }).click();
  const voting = page.getByRole('region', { name: 'Player of the Match voting' });
  const choice = (label) => voting.getByRole('group', { name: label });
  await expect(choice('Voting stays open for').getByRole('button', { name: '12 hours' })).toHaveAttribute('aria-pressed', 'true');
  await expect(choice("Remind players who haven't voted").getByRole('button', { name: '3 hours before' })).toHaveAttribute('aria-pressed', 'true');
  await expect(choice('Tell the team when voting opens').getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');
  await expect(choice('Post the winners in Team Chat').getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');

  // A reminder has to come before voting closes.
  await choice('Voting stays open for').getByRole('button', { name: '6 hours' }).click();
  await expect(choice("Remind players who haven't voted").getByRole('button', { name: '6 hours before' })).toHaveCount(0);
  await choice('Voting stays open for').getByRole('button', { name: '24 hours' }).click();
  await choice("Remind players who haven't voted").getByRole('button', { name: '6 hours before' }).click();
  await choice('Post the winners in Team Chat').getByRole('button', { name: 'Off' }).click();
  await page.getByRole('button', { name: 'Save team settings' }).click();
  await expect(page.getByText('Team settings saved')).toBeVisible();
  await page.reload();
  await expect(choice('Voting stays open for').getByRole('button', { name: '24 hours' })).toHaveAttribute('aria-pressed', 'true');
  await expect(choice("Remind players who haven't voted").getByRole('button', { name: '6 hours before' })).toHaveAttribute('aria-pressed', 'true');
  await expect(choice('Post the winners in Team Chat').getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');

  await page.locator('a[href="/"]:visible').first().click();
  await openGame(page, 'Goal Diggers');
  await page.getByRole('button', { name: 'Enter result' }).click();
  await page.getByRole('dialog', { name: 'Game result' }).getByRole('button', { name: 'Save result' }).click();
  await expect(page.getByTestId('potm-deadline')).toHaveText('Voting open until Fri 12:00 PM');
});

test('players cannot see the voting settings', async ({ page }) => {
  await signIn(page, 'jordan@demo.test');
  await page.goto('/settings');
  await expect(page.getByRole('region', { name: 'Player of the Match voting' })).toHaveCount(0);
});

test('the winners post in Team Chat comes from the Scoreboard', async ({ page }) => {
  await signIn(page);
  await openChat(page);
  await expect(page.getByRole('log', { name: 'Messages' })).toContainText('🏆 Player of the Match, 4–1 W vs Ball Busters');
});
