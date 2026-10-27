// Small things: the header line is a Team Settings field, Copy invite is always
// on the Team page (emailed invites aren't switched on yet), and announcement
// dates are in local time.
import { expect, signIn, test } from './helpers';

test('captains change the line under "Jive Turkeys" in the header', async ({ page }) => {
  await signIn(page);
  const header = page.locator('header').first();
  await expect(header).toContainText('Season 12 · Indoor Coed');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('link', { name: 'Team Settings' }).click();
  // The menu keeps focus while it slides away, then hands it back to the Menu button. Typing before then loses letters.
  await expect(page.getByRole('button', { name: 'Menu' })).toBeFocused();
  await page.getByLabel('Header line (under "Jive Turkeys")').fill('Fall 2026 · Thursday Coed');
  await page.getByRole('button', { name: 'Save team settings' }).click();
  await expect(page.getByText('Team settings saved')).toBeVisible();
  await expect(header).toContainText('Fall 2026 · Thursday Coed');
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
