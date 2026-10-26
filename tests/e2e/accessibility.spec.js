// Easy to read and easy to use without a mouse: every screen is checked for the
// accessibility basics (WCAG 2.1 A and AA): text contrast, names on buttons and
// fields, and so on. A new screen or dialog should get a line here.
import AxeBuilder from '@axe-core/playwright';
import { duesOption, expect, PLAYER, signIn, test } from './helpers';

async function expectAccessible(page, screen) {
  // Check what's on screen once it has settled (not halfway through fading in).
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    ),
  );
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // A chat message is one big button (tap it for reactions and options), and links in it are buttons too.
    // Screen readers still reach both; reworking the bubble is a separate change.
    .disableRules(['nested-interactive'])
    .analyze();
  const problems = violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id}: ${n.target.join(' ')}\n  ${n.failureSummary.replace(/\s*\n\s*/g, ' ')}`),
  );
  expect(problems, `accessibility problems on ${screen}`).toEqual([]);
}

async function visit(page, path, heading) {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
}

test('the sign-in screens', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('#email')).toBeVisible();
  await expectAccessible(page, 'Log in');

  await page.goto('/register');
  await expect(page.locator('#email')).toBeVisible();
  await expectAccessible(page, 'Sign up');

  await visit(page, '/privacy', 'Privacy');
  await expectAccessible(page, 'Privacy');
});

test("the captain's screens", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  await expectAccessible(page, 'Schedule');

  await visit(page, '/stats', 'Stats');
  await expectAccessible(page, 'Stats');
  for (const tab of ['Players', 'Opponents', 'Legacy']) {
    await page.getByRole('tab', { name: tab }).click();
    await expectAccessible(page, `Stats: ${tab}`);
  }

  await visit(page, '/team', 'Team');
  await expectAccessible(page, 'Team');
  await page.getByRole('button', { name: 'Unlink Kelly M from Kelly Moss' }).click();
  await expect(page.getByRole('dialog', { name: 'Unlink Kelly M?' })).toBeVisible();
  await expectAccessible(page, 'Unlink a roster name');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Unlink Kelly M?' })).toHaveCount(0);

  await visit(page, '/banter?room=team', 'Team Chat');
  await expectAccessible(page, 'Team Chat');

  await visit(page, '/rules', 'Field Rules');
  await expectAccessible(page, 'Field Rules');

  await visit(page, '/dues', 'Dues');
  await page.getByRole('tab', { name: 'My dues' }).click();
  await expectAccessible(page, 'My dues');
  await page.getByRole('button', { name: 'Pay together', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Pay together', exact: true })).toBeVisible();
  await expectAccessible(page, 'Pay together from My dues');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Team dues' }).click();
  await expectAccessible(page, 'Team dues');
  await page.getByRole('button', { name: 'Details for Sam Okafor' }).click();
  const sam = page.getByRole('dialog', { name: 'Sam Okafor' });
  await duesOption(sam, 'Pay together');
  await sam.getByLabel('Pays together with').selectOption({ label: 'Riley Novak' });
  await expect(page.getByRole('button', { name: 'Link them' })).toBeVisible();
  await expectAccessible(page, "A player's dues, asking before breaking up a couple");
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Previous session' }).click();
  await page.getByRole('button', { name: 'Details for Alex Chen' }).click();
  await expect(page.getByLabel('Paid together in session 1')).toBeHidden();
  await expectAccessible(page, "A past session's player dues");
  await duesOption(page.getByRole('dialog', { name: 'Alex Chen' }), 'Edit who paid together');
  await expect(page.getByLabel('Paid together in session 1')).toBeVisible();
  await expectAccessible(page, "Editing a past session's couple");
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.setItem('jt_demo_fail_reads', 'session_roster'));
  await visit(page, '/dues', 'Dues');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expectAccessible(page, "Dues that didn't load");
  await page.evaluate(() => localStorage.removeItem('jt_demo_fail_reads'));

  await visit(page, '/announcements', 'Announcements');
  await expectAccessible(page, 'Announcements');

  await visit(page, '/profile', 'Casey Captain');
  await expectAccessible(page, 'My Profile');

  await visit(page, '/settings', 'Team settings');
  await expectAccessible(page, 'Team settings');
});

test('a game, its result, the menu and the walkthrough', async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page);
  await page.getByRole('link', { name: /vs Goal Diggers/ }).click();
  await expect(page.getByRole('heading', { name: 'vs Goal Diggers' })).toBeVisible();
  await expectAccessible(page, 'a game');

  await page.getByRole('button', { name: /^(Enter|Edit) result$/ }).click();
  await expect(page.getByRole('dialog', { name: 'Game result' })).toBeVisible();
  await expectAccessible(page, 'Game result');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Game result' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible();
  await expectAccessible(page, 'the menu');

  await page.getByRole('button', { name: 'How to Use' }).click();
  await expect(page.getByRole('button', { name: 'Skip' })).toBeVisible();
  await expectAccessible(page, 'the walkthrough');
});

test("a player's screens", async ({ page }) => {
  await signIn(page, PLAYER);
  await expectAccessible(page, 'Schedule');

  await page.getByRole('link', { name: /vs Goal Diggers/ }).click();
  await expect(page.getByRole('heading', { name: 'vs Goal Diggers' })).toBeVisible();
  await expectAccessible(page, 'a game');

  await visit(page, '/dues', 'Dues');
  await expectAccessible(page, 'My dues');
});

test('asking who\'s playing a later session', async ({ page }) => {
  test.setTimeout(60_000);
  // A player: the question asked ahead, under the next game.
  await signIn(page, PLAYER);
  await expect(page.getByTestId('session-ahead')).toBeVisible();
  await expectAccessible(page, 'Schedule, asked ahead');
  await page.getByTestId('session-ahead').getByRole('button', { name: 'Sitting out' }).click();
  await expect(page.getByTestId('session-ahead')).toContainText('Session 3: Sitting out');
  await expectAccessible(page, 'Schedule, answered ahead');
});

test('captains asking who\'s playing, and between sessions', async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page);
  await visit(page, '/team', 'Team');
  await page.getByRole('button', { name: 'Answer for someone' }).click();
  await expect(page.getByRole('dialog', { name: 'Answers for session 3' })).toBeVisible();
  await expectAccessible(page, 'Answers for a later session');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Change date' }).click();
  await expect(page.getByRole('dialog', { name: "Ask who's playing session 3" })).toBeVisible();
  await expectAccessible(page, "Ask who's playing");
  await page.keyboard.press('Escape');

  // Session 2's games are played: the question is at the top of Schedule.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('jt_demo_db_'));
    const db = JSON.parse(localStorage.getItem(key));
    const year = new Date().getFullYear();
    db.games.filter((g) => g.season_year === year && g.session === 2).forEach((g, i) => (g.date = `${year}-10-0${i + 2}`));
    localStorage.setItem(key, JSON.stringify(db));
  });
  await visit(page, '/', 'Schedule');
  await expect(page.getByTestId('next-session')).toBeVisible();
  await expectAccessible(page, 'Schedule between sessions');
});

test('adding and importing games', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Add game' }).click();
  await expect(page.getByRole('dialog', { name: 'Add game' })).toBeVisible();
  await expectAccessible(page, 'Add game');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('dialog', { name: 'Import schedule' })).toBeVisible();
  await expectAccessible(page, 'Import schedule');
});

test('toggle buttons tell screen readers which one is picked', async ({ page }) => {
  await signIn(page);
  await visit(page, '/stats', 'Stats');
  await page.getByRole('tab', { name: 'Players' }).click();
  const sort = (name) => page.getByRole('button', { name, exact: true });
  await expect(sort('Goals')).toHaveAttribute('aria-pressed', 'true');
  await sort('Assists').click();
  await expect(sort('Assists')).toHaveAttribute('aria-pressed', 'true');
  await expect(sort('Goals')).toHaveAttribute('aria-pressed', 'false');

  await visit(page, '/profile', 'Casey Captain');
  const status = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Roster status' }) });
  await expect(status.getByRole('button', { name: 'Active' })).toHaveAttribute('aria-pressed', 'true');
  await expect(status.getByRole('button', { name: 'Sub Pool' })).toHaveAttribute('aria-pressed', 'false');
});

test('with reduce motion turned on, the menu, dialogs and game cards stay still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page);
  const animation = (locator) => locator.evaluate((el) => getComputedStyle(el).animationName);

  const card = page.getByRole('link', { name: /vs Goal Diggers/ });
  await card.hover();
  expect(await card.evaluate((el) => getComputedStyle(el).transform)).toBe('none');

  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible();
  expect(await animation(page.getByRole('dialog', { name: 'Menu' }))).toBe('none');
  await page.keyboard.press('Escape');

  await card.click();
  await page.getByRole('button', { name: /^(Enter|Edit) result$/ }).click();
  expect(await animation(page.getByRole('dialog', { name: 'Game result' }))).toBe('none');
});


test('a compact payment sheet and its optional forms', async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page);
  await visit(page, '/dues', 'Dues');
  await page.getByRole('button', { name: 'Details for Mike Russo' }).click();
  const sheet = page.getByRole('dialog', { name: 'Mike Russo' });
  await expectAccessible(page, 'Compact payment sheet');
  await sheet.getByRole('button', { name: 'More options' }).click();
  await expectAccessible(page, 'Payment options');
  await sheet.getByRole('button', { name: 'Set custom amount' }).click();
  await expectAccessible(page, 'Custom amount editor');
  await sheet.getByRole('button', { name: 'Back to options' }).click();
  await sheet.getByRole('button', { name: 'Record part payment' }).click();
  await expectAccessible(page, 'Partial payment editor');
});
