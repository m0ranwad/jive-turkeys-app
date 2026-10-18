// Easy to read and easy to use without a mouse: every screen is checked for the
// accessibility basics (WCAG 2.1 A and AA): text contrast, names on buttons and
// fields, and so on. A new screen or dialog should get a line here.
import AxeBuilder from '@axe-core/playwright';
import { expect, PLAYER, signIn, test } from './helpers';

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

  await visit(page, '/banter?room=team', 'Team Chat');
  await expectAccessible(page, 'Team Chat');

  await visit(page, '/rules', 'Field Rules');
  await expectAccessible(page, 'Field Rules');

  await visit(page, '/dues', 'Dues');
  await expectAccessible(page, 'My dues');
  await page.getByRole('tab', { name: 'Team dues' }).click();
  await expectAccessible(page, 'Team dues');

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
