// "Playing session N?" asked ahead: captains ask about a later session before its
// schedule is out (or while this one still has games left), players' answers
// count for that session only, and between sessions the question is at the top
// of Schedule. docs/games.md lists the rules; the database enforces them
// (supabase/tests/session_asks.test.sql).
//
// Sample data: session 2 starts with the next game; Casey already asked who's
// playing session 3. Priya, Alex and Jamie said they're in, Riley sub only;
// Jordan and the rest haven't answered.
import { expect, PLAYER, signIn, test } from './helpers';

async function openTab(page, path, heading) {
  await page.locator(`a[href="${path}"]:visible`).first().click();
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
}

const ahead = (page) => page.getByTestId('session-ahead');
const playerCard = (page, name) =>
  page.locator('div.rounded-3xl', { hasText: name }).filter({ has: page.getByText(name, { exact: true }) }).last();
const rosterStatus = (page) => page.locator('section').filter({ has: page.getByRole('heading', { name: 'Roster status' }) });

/** Session 2's games are all played: between sessions, before session 3's schedule is out. */
async function endSession2(page) {
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('jt_demo_db_'));
    const db = JSON.parse(localStorage.getItem(key));
    const year = new Date().getFullYear();
    db.games.filter((g) => g.season_year === year && g.session === 2).forEach((g, i) => (g.date = `${year}-10-0${i + 2}`));
    localStorage.setItem(key, JSON.stringify(db));
  });
  await page.reload();
}

test("a player answers for the next session ahead, and only that session changes", async ({ page }) => {
  await signIn(page, PLAYER);
  await expect(ahead(page)).toContainText('Asking ahead');
  await expect(ahead(page)).toContainText('Playing session 3?');
  await expect(ahead(page)).toContainText('3 in so far');
  await ahead(page).getByRole('button', { name: 'Sitting out' }).click();
  await expect(page.getByText("Sitting out session 3. You'll still get sub call-ups.")).toBeVisible();
  await expect(ahead(page)).toContainText('Session 3: Sitting out');

  // Jordan is still Active for session 2.
  await openTab(page, '/profile', 'Jordan Rivera');
  await expect(page.getByText('It counts for session 2')).toBeVisible();
  await expect(rosterStatus(page).getByRole('button', { name: 'Active' })).toHaveAttribute('aria-pressed', 'true');

  // The answer stays, and can be changed.
  await openTab(page, '/', 'Schedule');
  await ahead(page).getByRole('button', { name: 'Change' }).click();
  await expect(ahead(page).getByRole('button', { name: 'Sitting out' })).toHaveAttribute('aria-pressed', 'true');
  await ahead(page).getByRole('button', { name: "I'm in" }).click();
  await expect(ahead(page)).toContainText('Session 3: I\'m in');
  await expect(ahead(page)).toContainText('4 in so far');
});

test("captains answer this session's question first, then the next one's", async ({ page }) => {
  await signIn(page);
  await expect(page.getByTestId('session-prompt')).toContainText('Playing session 2?');
  await expect(ahead(page)).toHaveCount(0);
  await page.getByTestId('session-prompt').getByRole('button', { name: "I'm in" }).click();
  await expect(page.getByTestId('session-prompt')).toHaveCount(0);
  await expect(ahead(page)).toContainText('Playing session 3?');
});

test('captains see the answers, answer for someone, change the date or stop asking', async ({ page }) => {
  await signIn(page);
  await openTab(page, '/team', 'Team');
  const card = page.getByTestId('session-ask');
  await expect(card).toContainText('Playing session 3? · 4 of 14 answered');
  await expect(card).toContainText('Mike Russo');

  // Mike hasn't joined the site: a captain answers for him.
  await card.getByRole('button', { name: 'Answer for someone' }).click();
  const answers = page.getByRole('dialog', { name: 'Answers for session 3' });
  await expect(answers).toContainText('Only session 3 changes');
  await answers.getByLabel('Mike Russo in session 3').selectOption('active');
  await answers.getByRole('button', { name: 'Save 1 change' }).click();
  await expect(page.getByText('Session 3 updated')).toBeVisible();
  await expect(card).toContainText('5 of 14 answered');
  await expect(card).not.toContainText('Mike Russo');

  await card.getByRole('button', { name: 'Change date' }).click();
  const ask = page.getByRole('dialog', { name: "Ask who's playing session 3" });
  await ask.getByRole('button', { name: 'Stop asking' }).click();
  await expect(page.getByText('Stopped asking about session 3')).toBeVisible();
  await expect(card).toHaveCount(0);

  await page.getByRole('button', { name: /Ask who's playing session 3/ }).click();
  await ask.getByLabel("First game's date").fill('2026-12-01');
  await ask.getByRole('button', { name: 'Ask the team' }).click();
  await expect(page.getByText("Asking who's playing session 3")).toBeVisible();
  await expect(card).toContainText('starts Tue, Dec 1');
  // The answers given before are kept.
  await expect(card).toContainText('5 of 14 answered');
});

test('players cannot ask, and do not see the captains\' list', async ({ page }) => {
  await signIn(page, PLAYER);
  await openTab(page, '/team', 'Team');
  await expect(page.getByTestId('session-ask')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Ask who's playing/ })).toHaveCount(0);
});

test('between sessions, the question is at the top of Schedule and status changes count for the next session', async ({ page }) => {
  await signIn(page);
  await endSession2(page);
  const next = page.getByTestId('next-session');
  await expect(next).toContainText('Session 3');
  await expect(next).toContainText('Games show here when the schedule is out');
  await expect(next).toContainText('3 in');
  await expect(next).toContainText('10 to answer');
  await next.getByRole('button', { name: 'Sub only' }).click();
  await expect(page.getByText("You're in the sub pool for session 3")).toBeVisible();
  await expect(next).toContainText('Your answer');
  await expect(next.getByRole('button', { name: 'Sub only' })).toHaveAttribute('aria-pressed', 'true');

  await openTab(page, '/profile', 'Casey Captain');
  await expect(page.getByText('It counts for session 3')).toBeVisible();
  await expect(rosterStatus(page).getByRole('button', { name: 'Sub Pool' })).toHaveAttribute('aria-pressed', 'true');
});

test("between sessions, a captain's answer for someone is their status right now", async ({ page }) => {
  await signIn(page);
  await endSession2(page);
  await openTab(page, '/team', 'Team');
  await page.getByTestId('session-ask').getByRole('button', { name: 'Answer for someone' }).click();
  const answers = page.getByRole('dialog', { name: 'Answers for session 3' });
  await expect(answers).toContainText("It's their status for session 3");
  await answers.getByLabel('Mike Russo in session 3').selectOption('sub_pool');
  await answers.getByLabel('Sam Okafor in session 3').selectOption('on_break');
  await answers.getByRole('button', { name: 'Save 2 changes' }).click();
  await expect(page.getByText('Session 3 updated')).toBeVisible();
  await expect(playerCard(page, 'Mike Russo').getByRole('button', { name: 'Sub Pool' })).toHaveAttribute('aria-pressed', 'true');
  await expect(playerCard(page, 'Sam Okafor').getByRole('button', { name: 'On Break' })).toHaveAttribute('aria-pressed', 'true');
});
