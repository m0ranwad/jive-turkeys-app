// Context stays beside the vote shortcut, and all voting actions are usable
// on narrow phones, including guest names and both award modes.
import AxeBuilder from '@axe-core/playwright';
import { expect, signIn, test } from './helpers';

const longName = 'Michael Alexander Russo With A Long Roster Name';
const vote = (page) => page.locator('#vote');

async function expectTouchAreas(buttons) {
  const sizes = await buttons.evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    return { name: el.textContent, height: r.height, width: r.width, fits: el.scrollWidth <= el.clientWidth };
  }));
  expect(sizes.length).toBeGreaterThan(0);
  for (const size of sizes) {
    expect(size.height, size.name).toBeGreaterThanOrEqual(44);
    expect(size.width, size.name).toBeGreaterThanOrEqual(44);
    expect(size.fits, size.name).toBe(true);
  }
}

for (const mode of ['separate', 'overall']) {
  test(`${mode} awards: large touch areas, wrapped guest names, changing and cancelling a vote`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await signIn(page);
    // Fixture edits only: keep the saved team/demo defaults unchanged.
    await page.evaluate(async ({ mode, longName }) => {
      const { api } = await import('/src/api/index.js');
      const settings = (await api.entities.TeamSettings.list())[0];
      await api.entities.TeamSettings.update(settings.id, { potm_mode: mode });
      const mike = (await api.entities.TeamGuest.list()).find((p) => p.display_name === 'Mike Russo');
      await api.entities.TeamGuest.update(mike.id, { display_name: longName });
      if (mode === 'overall') {
        // Start the overall fixture without votes from the separate-awards seed.
        const me = await api.auth.me();
        const game = (await api.entities.Game.list()).find((g) => g.opponent === 'The Hat Tricks');
        const votes = await api.entities.PotmVote.filter({ game_id: game.id, voter_id: me.id });
        for (const v of votes) await api.entities.PotmVote.delete(v.id);
      }
    }, { mode, longName });
    await page.reload();
    await page.getByTestId('potm-prompt').getByRole('link').click();
    const candidates = vote(page).locator('button[aria-pressed]');
    const guest = vote(page).getByRole('button', { name: longName, exact: true });
    await expect(guest).toBeVisible();
    await expect(guest).toHaveClass(/border-dashed/);
    await expectTouchAreas(vote(page).getByRole('button'));
    expect(await guest.evaluate((el) => el.getBoundingClientRect().height > parseFloat(getComputedStyle(el).lineHeight) + 20)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    const { violations } = await new AxeBuilder({ page }).include('#vote')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(violations).toEqual([]);

    // A pending save disables the choices, while retaining their full hit areas.
    await page.evaluate(async () => {
      const { api } = await import('/src/api/index.js');
      const create = api.entities.PotmVote.create;
      api.entities.PotmVote.create = async (...args) => {
        await new Promise((resolve) => { window.releaseVote = resolve; });
        return create(...args);
      };
    });
    await guest.click();
    await page.waitForFunction(() => typeof window.releaseVote === 'function');
    for (const candidate of await candidates.all()) await expect(candidate).toBeDisabled();
    await expectTouchAreas(candidates);
    await page.evaluate(() => window.releaseVote());
    await expect(guest).toHaveCount(0);

    const award = vote(page).locator('div.rounded-2xl').first();
    const change = award.getByRole('button', { name: 'Change vote', exact: true });
    await expect(change).toBeVisible();
    await expectTouchAreas(change);
    await change.focus();
    await page.keyboard.press('Enter');
    await expect(guest).toHaveAttribute('aria-pressed', 'true');
    await expectTouchAreas(vote(page).getByRole('button'));
    const cancel = award.getByRole('button', { name: 'Cancel', exact: true });
    await cancel.focus();
    await page.keyboard.press('Enter');
    await expect(guest).toHaveCount(0);
    // Cancelling keeps the guest vote; reload and reopen to check persistence.
    await page.reload();
    await change.click();
    await expect(guest).toHaveAttribute('aria-pressed', 'true');
    const sam = award.getByRole('button', { name: 'Sam Okafor', exact: true });
    const nextName = mode === 'overall' ? 'Priya Shah' : 'Alex Chen';
    const next = award.getByRole('button', { name: nextName, exact: true });
    await sam.focus();
    await page.keyboard.press('Tab');
    await expect(next).toBeFocused();
    await page.keyboard.press('Enter');
    await change.click();
    await expect(next).toHaveAttribute('aria-pressed', 'true');
    await page.clock.fastForward('09:01:00');
    await expect(page.getByTestId('potm-deadline')).toHaveText('Voting closed');
    await expect(vote(page).getByRole('button')).toHaveCount(0);
    await expect(page.getByTestId('potm-game')).toHaveText('vs The Hat Tricks · Thu, Oct 1');
  });
}

for (const reducedMotion of ['reduce', 'no-preference']) {
  test(`Vote shortcut keeps match context visible with motion ${reducedMotion}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await signIn(page, 'sam@demo.test');
    // Sam played this game. Start with an outstanding vote for the regular
    // player's Schedule shortcut.
    await page.evaluate(async () => {
      const { api } = await import('/src/api/index.js');
      const me = await api.auth.me();
      const game = (await api.entities.Game.list()).find((g) => g.opponent === 'The Hat Tricks');
      const votes = await api.entities.PotmVote.filter({ game_id: game.id, voter_id: me.id });
      for (const v of votes) await api.entities.PotmVote.delete(v.id);
    });
    await page.reload();
    const shortcut = page.getByTestId('potm-prompt').getByRole('link');
    await shortcut.focus();
    await page.keyboard.press('Enter');
    const context = page.getByTestId('potm-game');
    await expect(context).toHaveText('vs The Hat Tricks · Thu, Oct 1');
    await expect(context).toBeInViewport();
    await expect.poll(async () => (await vote(page).boundingBox()).y).toBeGreaterThanOrEqual(80);
    await expectTouchAreas(vote(page).getByRole('button'));
  });
}
