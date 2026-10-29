// Small things: the header shows the season and session the site is on, Copy
// invite is always on the Team page (emailed invites aren't switched on yet),
// and announcement dates are in local time.
import { expect, signIn, test } from './helpers';

test('the line under "Jive Turkeys" is the season and session the site is on', async ({ page }) => {
  await signIn(page);
  // Sample data: the next game is session 2 of the 2026–27 season.
  await expect(page.locator('header').first()).toContainText('2026–27 · Session 2');
  // It isn't a Team Settings field any more.
  await page.getByRole('button', { name: 'Menu' }).click();
  const menu = page.getByRole('dialog', { name: 'Menu', exact: true });
  await expect(menu.getByText('Jive Turkeys', { exact: true })).toBeVisible();
  await expect(menu.getByText('Est. 2015', { exact: true })).toBeVisible();
  await expect(menu.locator('img[src="/icon-192.png"]')).toBeVisible();
  await page.getByRole('link', { name: 'Team Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Team settings' })).toBeVisible();
  await expect(page.getByLabel(/Header line/)).toHaveCount(0);
});

test('anyone can copy an invite from the Team page, even once everyone has joined', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page, 'jordan@demo.test');
  await page.locator('a[href="/team"]:visible').first().click();
  await expect(page.getByRole('button', { name: 'Invite teammate' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Copy invite' }).first().click();
  await expect(page.getByText('Invite copied')).toBeVisible();
  const invite = await page.evaluate(() => navigator.clipboard.readText());
  expect(invite).toContain('enter the team code TURKEY');
  expect(invite).toContain('Still to join: Dana Wells, Mike Russo');
});

test('announcement dates are in local time', async ({ page }) => {
  // The sample post went up 10 hours ago. Its date is the local calendar day, not the UTC one (which runs ahead
  // in the evening in the US).
  await signIn(page);
  await page.goto('/announcements');
  const shown = await page.evaluate(() => {
    const d = new Date(Date.now() - 600 * 60000);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  });
  await expect(page.getByText(new RegExp(`· ${shown}`))).toBeVisible();
});
