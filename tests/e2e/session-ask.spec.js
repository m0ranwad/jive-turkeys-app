// "Playing session N?" asked ahead: captains ask about a later session before its
// schedule is out (or while this one still has games left), players' answers
// count for that session only, and between sessions the question is at the top
// of Schedule. docs/games.md lists the rules; the database enforces them
// (supabase/tests/session_asks.test.sql).
//
// Sample data: session 2 starts with the next game; Casey already asked who's
// playing session 3. Priya, Alex and Jamie said they're in, Riley sub only;
// Jordan and the rest haven't answered.
import { expect, PLAYER, signIn, test, playerOptions } from './helpers';

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
  await ahead(page).getByRole('button', { name: 'Unavailable' }).click();
  await expect(page.getByText("Unavailable for session 3. No sub requests.")).toBeVisible();
  await expect(ahead(page)).toContainText('Session 3: Unavailable');

  // Jordan is still Active for session 2.
  await openTab(page, '/profile', 'Jordan Rivera');
  await expect(page.getByText('Counts for session 2')).toBeVisible();
  await expect(rosterStatus(page).getByRole('button', { name: 'Playing' })).toHaveAttribute('aria-pressed', 'true');

  // The answer stays, and can be changed.
  await openTab(page, '/', 'Schedule');
  await ahead(page).getByRole('button', { name: 'Change' }).click();
  await expect(ahead(page).getByRole('button', { name: 'Unavailable' })).toHaveAttribute('aria-pressed', 'true');
  await ahead(page).getByRole('button', { name: 'Playing' }).click();
  await expect(ahead(page)).toContainText('Session 3: Playing');
  await expect(ahead(page)).toContainText('4 in so far');
});

test("captains answer this session's question first, then the next one's", async ({ page }) => {
  await signIn(page);
  await expect(page.getByTestId('session-prompt')).toContainText('Playing session 2?');
  await expect(ahead(page)).toHaveCount(0);
  await page.getByTestId('session-prompt').getByRole('button', { name: 'Playing' }).click();
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

test('stopping the question keeps future dues current and preserves explicit answers', async ({ page }) => {
  await signIn(page);
  await openTab(page, '/team', 'Team');
  await page.getByTestId('session-ask').getByRole('button', { name: 'Change date' }).click();
  await page.getByRole('dialog', { name: "Ask who's playing session 3" }).getByRole('button', { name: 'Stop asking' }).click();
  await expect(page.getByText('Stopped asking about session 3')).toBeVisible();

  // Casey hasn't answered session 3; Priya explicitly said she's in.
  await playerCard(page, 'Casey Captain').getByRole('button', { name: 'Unavailable' }).click();
  await expect(page.getByText('Casey Captain marked Unavailable')).toBeVisible();
  await (await playerOptions(page, 'Priya Shah')).getByRole('button', { name: 'Unavailable' }).click();
  await expect(page.getByText('Priya Shah marked Unavailable')).toBeVisible();
  await page.keyboard.press('Escape');

  await openTab(page, '/dues', 'Dues');
  await page.getByRole('tab', { name: 'Team dues' }).click();
  await page.getByRole('button', { name: 'Next session' }).click();
  await expect(page.getByTestId('dues-session')).toHaveText('Session 3 · 2026–27');
  await page.getByRole('button', { name: 'Set the fee' }).click();
  await page.getByRole('dialog', { name: 'Session 3 fee' }).getByRole('button', { name: 'Save fee' }).click();
  await expect(page.getByTestId('dues-unpaid')).not.toContainText('Casey Captain');
  await expect(page.getByTestId('dues-unpaid')).toContainText('Priya Shah');
  await page.reload();
  await page.getByRole('tab', { name: 'Team dues' }).click();
  await page.getByRole('button', { name: 'Next session' }).click();
  await expect(page.getByTestId('dues-unpaid')).not.toContainText('Casey Captain');
  await expect(page.getByTestId('dues-unpaid')).toContainText('Priya Shah');
});

// The demo mutates synchronously, while the live roster-start RPC changes the
// database after a network round trip. Delay that mutation to exercise direct
// entry on Dues with a stopped list saved by the older version.
async function slowRosterStart(page) {
  await page.route('**/src/api/index.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + `
      const originalStart = api.roster.start.bind(api.roster);
      api.roster.start = async (...args) => {
        const mode = localStorage.getItem('jt_test_roster_start');
        if (mode === 'fail') throw new Error('Roster refresh failed');
        if (mode === 'slow') await new Promise(resolve => setTimeout(resolve, 1500));
        return originalStart(...args);
      };
    ` });
  });
}

test('opening directly on Dues waits for an older stopped list to refresh', async ({ page }) => {
  await slowRosterStart(page);
  await signIn(page);
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('jt_demo_db_'));
    const db = JSON.parse(localStorage.getItem(key));
    const sam = db.player_profiles.find((p) => p.display_name === 'Sam Okafor');
    const priya = db.player_profiles.find((p) => p.display_name === 'Priya Shah');
    sam.status = priya.status = 'on_break';
    const ask = db.session_asks.find((a) => a.session === 3);
    ask.starts_on = ask.applied_at = null;
    db.session_dues.push({ ...db.session_dues.find((d) => d.session === 2), id: crypto.randomUUID(), session: 3 });
    localStorage.setItem(key, JSON.stringify(db));
    localStorage.setItem('jt_test_roster_start', 'slow');
  });
  await page.goto('/dues');
  await expect(page.getByRole('heading', { name: 'Dues', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Team dues' }).click();
  await page.getByRole('button', { name: 'Next session' }).click();
  await expect(page.getByTestId('dues-session')).toHaveText('Session 3 · 2026–27');
  // Sam hasn't answered: follow today's status. Priya explicitly said she's in.
  await expect(page.getByTestId('dues-unpaid')).not.toContainText('Sam Okafor');
  await expect(page.getByTestId('dues-unpaid')).toContainText('Priya Shah');
  await expect(page.getByRole('heading', { name: '0 of 11 paid', exact: true })).toBeVisible();
  await expect(page.getByLabel('Amount for Priya Shah')).toHaveText('$66');
});

test('Dues retries a failed roster refresh before showing amounts', async ({ page }) => {
  await slowRosterStart(page);
  await signIn(page);
  await page.evaluate(() => localStorage.setItem('jt_test_roster_start', 'fail'));
  await page.goto('/dues');
  await expect(page.getByTestId('dues-failed')).toBeVisible();
  await expect(page.getByTestId('dues-unpaid')).toHaveCount(0);
  await page.evaluate(() => localStorage.removeItem('jt_test_roster_start'));
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Dues', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '5 of 12 paid', exact: true })).toBeVisible();
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
  await next.getByRole('button', { name: 'Available to sub' }).click();
  await expect(page.getByText("You're available to sub for session 3")).toBeVisible();
  await expect(next).toContainText('Your answer');
  await expect(next.getByRole('button', { name: 'Available to sub' })).toHaveAttribute('aria-pressed', 'true');

  await openTab(page, '/profile', 'Casey Captain');
  await expect(page.getByText('Counts for session 3')).toBeVisible();
  await expect(rosterStatus(page).getByRole('button', { name: 'Available to sub' })).toHaveAttribute('aria-pressed', 'true');
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
  const mike = await playerOptions(page, 'Mike Russo');
  await expect(mike.getByRole('button', { name: 'Available to sub' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  const sam = await playerOptions(page, 'Sam Okafor');
  await expect(sam.getByRole('button', { name: 'Unavailable' })).toHaveAttribute('aria-pressed', 'true');
});

test("captains' new games go in the session they're asking about, with dates in the season's years", async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Add game' }).click();
  const form = page.getByRole('dialog', { name: 'Add game' });
  await expect(form.getByRole('button', { name: '2026–27' })).toHaveAttribute('aria-pressed', 'true');
  await expect(form.getByRole('button', { name: '3', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);

  await page.getByRole('button', { name: 'Import' }).click();
  const importer = page.getByRole('dialog', { name: 'Import schedule' });
  await expect(importer.getByRole('button', { name: '2026–27' })).toHaveAttribute('aria-pressed', 'true');
  await expect(importer.getByRole('button', { name: '3', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // The league's sheet has no years: March is in 2027, the season's second year.
  await importer.locator('input[type="file"]').setInputFiles({
    name: 'session-3.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Date,Time,Field,Opponent\nSat Mar 6,7:00 PM,2,Ball Busters\n'),
  });
  await expect(importer.getByText('1 row ready for 2026–27 · Session 3')).toBeVisible();
  await expect(importer.locator('input[type="date"]')).toHaveValue('2027-03-06');
  await importer.getByRole('button', { name: 'Confirm 1 game' }).click();
  await expect(importer).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '2026–27 · Session 3' })).toBeVisible();
});
