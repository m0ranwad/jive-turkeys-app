// Who's on the team each session: a new session asks "Playing session 2?",
// answers count for that session only, and past sessions' dues stay as they
// were. Captains can correct a past session. The database enforces who can
// change what (supabase/tests/roster.test.sql).
//
// Sample data: session 1 is over (Jamie played it and is unavailable session 2;
// Chris joined in session 2). Session 2 starts Saturday, and only some players
// have answered: not the captain, Sam, Morgan, Riley, Kelly or Mike yet.
import { expect, expectTeam, openSection, signIn, test, playerOptions } from './helpers';

const SAM = 'sam@demo.test';
const JORDAN = 'jordan@demo.test'; // already answered for session 2

async function openTab(page, path, heading) {
  await page.locator(`a[href="${path}"]:visible`).first().click();
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
}

const prompt = (page) => page.getByTestId('session-prompt');
const paidHeading = (page, text) => page.getByRole('heading', { name: text, exact: true });
/** Session 2's games are all played, captains stopped asking about session 3, and nothing else is on the schedule. */
async function offSeason(page) {
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('jt_demo_db_'));
    const db = JSON.parse(localStorage.getItem(key));
    const year = new Date().getFullYear();
    db.games.filter((g) => g.season_year === year && g.session === 2).forEach((g, i) => (g.date = `${year}-10-0${i + 2}`));
    db.session_asks.forEach((a) => (a.starts_on = null));
    localStorage.setItem(key, JSON.stringify(db));
  });
  await page.reload();
}

test('the session question comes right under the Next game card, before the vote reminder', async ({ page }) => {
  await signIn(page);
  // Sample data: the captain hasn't answered session 2, and voting on last week's game is open.
  const vote = page.getByTestId('potm-prompt');
  await expect(vote).toBeVisible();
  const top = async (locator) => (await locator.boundingBox()).y;
  const next = await top(page.getByRole('region', { name: 'Next game' }));
  const question = await top(prompt(page));
  expect(question).toBeGreaterThan(next);
  expect(question).toBeLessThan(await top(vote));
  // Answering the game doesn't answer the session.
  await page.getByRole('region', { name: 'Next game' }).getByRole('button', { name: 'IN', exact: true }).click();
  await expect(prompt(page)).toContainText('Playing session 2?');
});

test('a new session asks who is playing, and the last session keeps its dues', async ({ page }) => {
  await signIn(page);
  await expect(prompt(page)).toContainText('Session 2 starts Sat, Oct 10');
  await expect(prompt(page)).toContainText('Playing session 2?');
  await expect(prompt(page)).toContainText("You're down as Playing.");

  // Captains see who hasn't answered.
  await openTab(page, '/team', 'Team');
  const answers = page.getByTestId('session-answers');
  await expect(answers).toContainText('Playing session 2? · 8 of 14 answered');
  await expect(answers).toContainText('Still to answer: Casey Captain, Sam Okafor, Morgan Lee, Riley Novak, Kelly Moss, Mike Russo.');

  await openTab(page, '/', 'Schedule');
  await prompt(page).getByRole('button', { name: 'Unavailable' }).click();
  await expect(page.getByText("Unavailable for session 2. No sub requests.")).toBeVisible();
  await expect(prompt(page)).toHaveCount(0);

  await openTab(page, '/team', 'Team');
  await expect(answers).toContainText('9 of 14 answered');
  await expect(answers).not.toContainText('Casey Captain');
  // A captain answers for Mike, who hasn't joined the site, by confirming his status.
  await (await playerOptions(page, 'Mike Russo')).getByRole('button', { name: 'Playing', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(answers).toContainText('10 of 14 answered');
  await expect(answers).not.toContainText('Mike Russo');

  // Session 2 splits without the captain; session 1 is exactly as it was.
  await openTab(page, '/dues', 'Dues');
  await expect(page.getByTestId('dues-session')).toHaveText('Session 2 · 2026–27');
  await expect(paidHeading(page, '5 of 11 paid')).toBeVisible();
  await expect(page.getByText('$66 each')).toBeVisible();
  // The dues history says why the split changed.
  await expect((await openSection(page, 'Recent changes'))).toContainText("You're unavailable");
  await page.getByRole('button', { name: 'Previous session' }).click();
  await expect(page.getByTestId('dues-session')).toHaveText('Session 1 · 2026–27');
  await expect(paidHeading(page, '12 of 12 paid')).toBeVisible();
  await expect(page.getByText('$61 each')).toBeVisible();
  await expect(page.getByTestId('dues-paid')).toContainText('Casey Captain');
  await expect(page.getByTestId('dues-paid')).toContainText('Jamie Fox');
  await expect(page.getByTestId('dues-paid')).not.toContainText('Chris Dunn');
});

test('a player answers for themselves; players who already answered are not asked', async ({ page }) => {
  await signIn(page, JORDAN);
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  await expect(prompt(page)).toHaveCount(0);
  // Players don't see the captains' list of who hasn't answered.
  await openTab(page, '/team', 'Team');
  await expect(page.getByTestId('session-answers')).toHaveCount(0);
  await expectTeam(page, { playing: 12, sub: 1, unavailable: 1 });
});

test('a player in the sub pool can say they are in', async ({ page }) => {
  await signIn(page, SAM);
  await prompt(page).getByRole('button', { name: 'Playing' }).click();
  await expect(page.getByText("You're playing session 2")).toBeVisible();
  await expect(prompt(page)).toHaveCount(0);
  await openTab(page, '/profile', 'Sam Okafor');
  await expect(page.getByText('Counts for session 2')).toBeVisible();
});

test('captains can correct who was on a past session, and only that session changes', async ({ page }) => {
  await signIn(page);
  await openTab(page, '/dues', 'Dues');
  // The current session is changed on the Team page, not here.
  await expect(page.getByRole('button', { name: /Change who was on session/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Previous session' }).click();
  await page.getByRole('button', { name: 'Change who was on session 1' }).click();
  const dialog = page.getByRole('dialog', { name: 'Who was on session 1' });
  await expect(dialog).toContainText("This changes how session 1's fee is split.");
  await expect(dialog.getByLabel('Chris Dunn in session 1')).toHaveValue('off');
  await dialog.getByLabel('Jamie Fox in session 1').selectOption('off');
  await dialog.getByRole('button', { name: 'Save 1 change' }).click();
  await expect(page.getByText('Session 1 updated')).toBeVisible();
  await expect(paidHeading(page, '11 of 11 paid')).toBeVisible();
  await expect(page.getByText('$66 each')).toBeVisible();

  await page.getByRole('button', { name: 'Next session' }).click();
  await expect(paidHeading(page, '5 of 12 paid')).toBeVisible();

  // A session that hasn't started uses today's roster until it does.
  await page.getByRole('button', { name: 'Next session' }).click();
  await expect(page.getByTestId('dues-session')).toHaveText('Session 3 · 2026–27');
  await page.getByRole('button', { name: 'Set the fee' }).click();
  await page.getByRole('dialog', { name: 'Session 3 fee' }).getByRole('button', { name: 'Save fee' }).click();
  await expect(page.getByTestId('dues-not-started')).toContainText("Session 3 hasn't started, so this uses today's roster.");
});

test('once a session is over, status changes count from the next one and its dues stay put; captains can correct it', async ({ page }) => {
  await signIn(page);
  await offSeason(page);
  await openTab(page, '/team', 'Team');
  await expectTeam(page, { playing: 12, sub: 1, unavailable: 1 });
  // A captain marks Kelly unavailable. Session 2's split doesn't change.
  const kelly = await playerOptions(page, 'Kelly Moss');
  await expect(kelly).toContainText('session 2 is over, so it counts from the next session');
  await kelly.getByRole('button', { name: 'Unavailable' }).click();
  await expect(page.getByText('Kelly Moss marked Unavailable')).toBeVisible();
  await page.keyboard.press('Escape');
  await expectTeam(page, { playing: 11, sub: 1, unavailable: 2 });

  await openTab(page, '/dues', 'Dues');
  await expect(page.getByTestId('dues-session')).toHaveText('Session 2 · 2026–27');
  await expect(paidHeading(page, '5 of 12 paid')).toBeVisible();
  await expect(page.getByText('$61 each')).toBeVisible();
  // Adding players on the Team page doesn't change it any more; correcting it does.
  await expect(page.getByRole('link', { name: /Add players to the roster on the Team page/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Change who was on session 2' }).click();
  const dialog = page.getByRole('dialog', { name: 'Who was on session 2' });
  await expect(dialog.getByLabel('Kelly Moss in session 2')).toHaveValue('active');
  await dialog.getByLabel('Kelly Moss in session 2').selectOption('on_break');
  await dialog.getByRole('button', { name: 'Save 1 change' }).click();
  await expect(page.getByText('Session 2 updated')).toBeVisible();
  await expect(paidHeading(page, '5 of 11 paid')).toBeVisible();
  await expect(page.getByText('$66 each')).toBeVisible();

  await openTab(page, '/profile', 'Casey Captain');
  await expect(page.getByText('Session 2 is over, so it counts from the next session')).toBeVisible();
});

test('players cannot correct past sessions', async ({ page }) => {
  await signIn(page, JORDAN);
  await openTab(page, '/dues', 'Dues');
  await page.getByRole('tab', { name: 'Team dues' }).click();
  await page.getByRole('button', { name: 'Previous session' }).click();
  await expect(paidHeading(page, '12 of 12 paid')).toBeVisible();
  await expect(page.getByRole('button', { name: /Change who was on session/ })).toHaveCount(0);
});

// The demo backend acts out one kind of data not loading when jt_demo_fail_reads names its table.
const failRosterReads = (page) => page.evaluate(() => localStorage.setItem('jt_demo_fail_reads', 'session_roster'));
const restoreRosterReads = (page) => page.evaluate(() => localStorage.removeItem('jt_demo_fail_reads'));

test("if who was on each session doesn't load, Dues says so and offers nothing to pay until it does", async ({ page }) => {
  // Chris joined in session 2, so he owes nothing for session 1.
  await signIn(page, 'chris@demo.test');
  await openTab(page, '/dues', 'Dues');
  await page.getByRole('button', { name: 'Previous session' }).click();
  await expect(page.getByTestId('my-dues')).toContainText('Not on the roster');

  await failRosterReads(page);
  await openTab(page, '/', 'Schedule');
  await openTab(page, '/dues', 'Dues');
  await expect(page.getByTestId('dues-failed')).toContainText("The dues didn't load");
  // Not worked out from today's roster instead: no share, no pay links, nothing to mark.
  await expect(page.getByTestId('my-dues')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /with Venmo/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Mark (me|us) paid/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again' }).click();
  // Keep reads failing until this retry finishes. The old error remains visible
  // while the roster-start request is pending, so visibility alone isn't enough.
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeEnabled();
  await expect(page.getByTestId('dues-failed')).toBeVisible();

  await restoreRosterReads(page);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('dues-session')).toHaveText('Session 2 · 2026–27');
  await page.getByRole('button', { name: 'Previous session' }).click();
  await expect(page.getByTestId('my-dues')).toContainText('Not on the roster');
});

test("if who's on each session doesn't load, Playing session N? waits, and the next screen tries again", async ({ page }) => {
  await signIn(page);
  await expect(prompt(page)).toContainText('Playing session 2?');

  await failRosterReads(page);
  // Start over, so a load from before (say, after the welcome slides) can't finish now and show the lists.
  await page.reload();
  await openTab(page, '/team', 'Team');
  await expect(page.getByTestId('session-answers')).toHaveCount(0);
  await openTab(page, '/', 'Schedule');
  await expect(prompt(page)).toHaveCount(0);

  await restoreRosterReads(page);
  await openTab(page, '/team', 'Team');
  await expect(page.getByTestId('session-answers')).toContainText('Playing session 2? · 8 of 14 answered');
  await openTab(page, '/', 'Schedule');
  await expect(prompt(page)).toContainText('Playing session 2?');
});
