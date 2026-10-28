// The Next game card at the top of Schedule: when and where, the headcount,
// and your answer right there; answers from the upcoming games list; earlier
// sessions folded away. docs/games.md lists the rules.
//
// Sample data: the next game is vs Goal Diggers (6 IN, the captain hasn't
// answered), then FC Lightning, in session 2; session 1 is over, and last season's game is older.
import { PLAYER, expect, signIn, test } from './helpers';

const nextGame = (page) => page.getByRole('region', { name: 'Next game' });

test('a shortage is a calm chip until two days before kickoff, then turns red', async ({ page }) => {
  await signIn(page);
  // Goal Diggers is more than two days away: how many more we need, without the alarm.
  const card = nextGame(page);
  await expect(card).toContainText('Need 2 more · 1 more woman');
  await expect(card).not.toContainText('Short');
  const later = page.getByRole('link', { name: /vs FC Lightning/ });
  await expect(later).toContainText('0 in');
  await expect(later).not.toContainText('Need');
  await expect(later).not.toContainText('women');
  await expect(later).not.toContainText('maybe');
  await expect(later).not.toContainText('no reply');
  await expect(later).not.toContainText('Short');

  // A day later it's within 48 hours of kickoff.
  await page.clock.fastForward('24:00:00');
  await page.reload();
  await expect(nextGame(page)).toContainText('Short · Need 2 more · 1 more woman');
  await expect(page.getByRole('link', { name: /vs FC Lightning/ })).not.toContainText('Short');
});

test('a later game still warns when short within 48 hours of kickoff', async ({ page }) => {
  await signIn(page);
  // Two games on the same night: the later one must warn too, without becoming Next game.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('jt_demo_db_'));
    const db = JSON.parse(localStorage.getItem(key));
    const next = db.games.find((g) => g.opponent === 'Goal Diggers' && !g.has_result);
    const later = db.games.find((g) => g.opponent === 'FC Lightning');
    Object.assign(later, { date: next.date, time: '23:00' });
    localStorage.setItem(key, JSON.stringify(db));
  });
  await page.clock.fastForward('24:00:00');
  await page.reload();
  await expect(nextGame(page)).toContainText('vs Goal Diggers');
  const later = page.getByRole('link', { name: /vs FC Lightning/ });
  await expect(later).toContainText('Short · Need 8 more · 3 more women');
  await expect(later).toContainText('0 in');
});

test("a game's own page keeps the full shortage and headcount", async ({ page }) => {
  await signIn(page);
  const headcount = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Headcount' }) });

  // FC Lightning is weeks away: grey, once, with the minimums as a note.
  await page.getByRole('link', { name: /vs FC Lightning/ }).click();
  await expect(headcount).toContainText('Need 8 more · 3 more women');
  await expect(headcount).not.toContainText('Short');
  await expect(headcount).toContainText('We need at least 8 players, with 3 women on the field');
  await expect(headcount).toContainText('0 of 3');

  // Goal Diggers, a day later: within 48 hours, so red.
  await page.clock.fastForward('24:00:00');
  await page.goto('/');
  await nextGame(page).getByRole('link', { name: /Details/ }).click();
  await expect(headcount).toContainText('Short · Need 2 more · 1 more woman');

  // A played game has nothing to call for: who said IN is folded away, with no shortage.
  await page.goto('/');
  await page.getByRole('link', { name: /vs The Hat Tricks/ }).click();
  const rsvps = page.locator('details', { hasText: 'Who said they were in' });
  await rsvps.getByText('Who said they were in').click();
  await expect(rsvps.locator('[data-group="IN"]')).toBeVisible();
  await expect(rsvps).not.toContainText('Need');
  await expect(rsvps).not.toContainText('We need at least');
});

test('Playing GK has no rule note, and a played game says once who votes', async ({ page }) => {
  // Jordan said IN for Goal Diggers, and didn't play The Hat Tricks game.
  await signIn(page, PLAYER);
  await nextGame(page).getByRole('link', { name: /Details/ }).click();
  await expect(page.getByRole('button', { name: /Playing GK/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Playing GK/ })).not.toContainText("doesn't count");

  await page.goto('/');
  await page.getByRole('link', { name: /vs The Hat Tricks/ }).filter({ hasNotText: 'Vote for Player of the Match' }).first().click();
  await expect(page.getByText('Only players from this game vote.')).toHaveCount(1);
  await expect(page.getByText('Voting is open to players who played this game')).toHaveCount(0);
});

test('the next game is at the top of Schedule, and you answer right there', async ({ page }) => {
  await signIn(page);
  const card = nextGame(page);
  await expect(card).toContainText('vs Goal Diggers');
  await expect(card).toContainText('6 in');
  await expect(card).toContainText("You haven't answered");
  await expect(page.getByRole('link', { name: /vs Goal Diggers/ })).toHaveCount(1);

  await card.getByRole('button', { name: 'IN', exact: true }).click();
  await expect(card.getByRole('button', { name: 'IN', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(card).toContainText('7 in');
  await expect(card).toContainText('Your answer');

  // The game page agrees, and so does a reload.
  await card.getByText('vs Goal Diggers', { exact: true }).click();
  await expect(page.locator('[data-group="IN"] [data-player="Casey Captain"]')).toBeVisible();
  await page.goBack();
  await page.reload();
  await expect(nextGame(page).getByRole('button', { name: 'IN', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('later games can be answered from the list', async ({ page }) => {
  await signIn(page);
  // The game after the next one, answered inside its card in the list.
  const later = page.getByRole('group', { name: /^Your answer for vs FC Lightning, / });
  expect((await later.getByRole('button', { name: 'IN', exact: true }).boundingBox()).height).toBeGreaterThanOrEqual(44);
  await later.getByRole('button', { name: 'IN', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Schedule', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /vs FC Lightning/ })).toContainText('1 in');
  await later.getByRole('button', { name: 'OUT', exact: true }).click();
  await expect(later.getByRole('button', { name: 'OUT', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(later.getByRole('button', { name: 'OUT', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(nextGame(page)).toContainText("You haven't answered");
});

test('played games are readable result rows that open the game', async ({ page }) => {
  await signIn(page);
  const session = page.locator('section').filter({ has: page.getByRole('heading', { name: /2026–27 · Session 1$/ }) });
  const results = session.getByRole('list', { name: 'Game results' });
  await expect(results.getByRole('link')).toHaveCount(4);
  const loss = results.getByRole('link', { name: /Lost, vs The Hat Tricks/ });
  await expect(loss).toContainText('2–5');
  await expect(results.getByRole('link', { name: /Won, vs Ball Busters/ })).toContainText('4–1');
  await expect(results.getByRole('link', { name: /Draw, vs Grass Kickers/ })).toContainText('1–1');
  await expect(results).not.toContainText('Field');
  for (const row of await results.getByRole('link').all()) {
    expect((await row.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  await loss.click();
  await expect(page.getByRole('heading', { name: 'vs The Hat Tricks' })).toBeVisible();
});

test("tonight's game moves to Played as soon as its result is saved", async ({ page }) => {
  await signIn(page);
  // Goal Diggers played today (signIn's clock: Thu Oct 8) and has a result.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('jt_demo_db_'));
    const db = JSON.parse(localStorage.getItem(key));
    const game = db.games.find((g) => g.opponent === 'Goal Diggers' && !g.has_result);
    Object.assign(game, { date: '2026-10-08', has_result: true, score_us: 3, score_them: 1 });
    localStorage.setItem(key, JSON.stringify(db));
  });
  await page.reload();
  await expect(nextGame(page)).toContainText('vs FC Lightning');
  const session = page.locator('section').filter({ has: page.getByRole('heading', { name: /2026–27 · Session 2$/ }) });
  await expect(session.getByText('Played', { exact: true })).toBeVisible();
  const results = session.getByRole('list', { name: 'Game results' });
  await expect(results).toHaveCount(1);
  await expect(results.getByRole('link', { name: /^Won, vs Goal Diggers/ })).toContainText('3–1');
});

test('a past game without a saved score does not pretend to have a result', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('jt_demo_db_'));
    const db = JSON.parse(localStorage.getItem(key));
    const game = db.games.find((g) => g.opponent === 'The Hat Tricks');
    Object.assign(game, { has_result: false, score_us: null, score_them: null });
    localStorage.setItem(key, JSON.stringify(db));
  });
  await page.reload();
  const row = page.getByRole('link', { name: /vs The Hat Tricks/ });
  await expect(row).toContainText('No result yet');
  await expect(row).not.toContainText('0–0');
  await expect(row).not.toHaveAccessibleName(/Won|Lost|Draw/);
  await row.click();
  await expect(page.getByRole('button', { name: 'Enter result' })).toBeVisible();
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
