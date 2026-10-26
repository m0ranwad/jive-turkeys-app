// Couples who pay together, kept per session (#83): linking or unlinking a
// couple counts from the session being played on, a session that's over keeps
// who paid together then, and captains fix a past session's couples there.
// The database enforces who can change what (supabase/tests/couples.test.sql).
//
// Sample data: Alex Chen and Riley Novak paid session 1 on their own and pay
// together from session 2. Session 2 starts Saturday; Jamie Fox is sitting it out.
import { expect, signIn, test } from './helpers';

const JORDAN = 'jordan@demo.test';

const paidHeading = (page, text) => page.getByRole('heading', { name: text, exact: true });
const row = (page, name) => page.getByRole('button', { name: `Details for ${name}` });

async function openTeamDues(page) {
  await page.locator('a[href="/dues"]:visible').first().click();
  await expect(page.getByRole('heading', { name: 'Dues', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Team dues' }).click();
}

async function previousSession(page) {
  await page.getByRole('button', { name: 'Previous session' }).click();
  await expect(page.getByTestId('dues-session')).toHaveText('Session 1 · 2026–27');
}

/** Session 2's games are all played, captains stopped asking about session 3, and nothing else is on the schedule. */
async function betweenSessions(page) {
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

test('a session that is over keeps who paid together: Alex and Riley are marked one at a time in session 1', async ({ page }) => {
  await signIn(page, JORDAN);
  await openTeamDues(page);
  await expect(row(page, 'Alex Chen')).toContainText('with Riley N.');

  await previousSession(page);
  await expect(paidHeading(page, '12 of 12 paid')).toBeVisible();
  await expect(row(page, 'Alex Chen')).not.toContainText('with Riley N.');
  await row(page, 'Alex Chen').click();
  const sheet = page.getByRole('dialog', { name: 'Alex Chen' });
  await expect(sheet).not.toContainText('together with');
  // Only captains change a past session's couples.
  await expect(sheet.getByRole('combobox')).toHaveCount(0);

  await sheet.getByRole('button', { name: 'Mark as not paid' }).click();
  await expect(sheet).toContainText('Alex Chen will show as unpaid');
  await sheet.getByRole('button', { name: 'Mark not paid' }).click();
  await expect(page.getByText('Alex Chen marked not paid')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(paidHeading(page, '11 of 12 paid')).toBeVisible();
  await expect(page.getByTestId('dues-paid')).toContainText('Riley Novak');
});

test('a link counts from this session on, only offers its players, and asks before breaking up a couple', async ({ page }) => {
  await signIn(page, JORDAN);
  await openTeamDues(page);
  await row(page, 'Sam Okafor').click();
  const sheet = page.getByRole('dialog', { name: 'Sam Okafor' });
  const picker = sheet.getByLabel('Pays together with');
  await expect(sheet).toContainText('From this session on; earlier sessions keep who paid together then.');
  // Jamie is sitting out session 2.
  await expect(picker.locator('option', { hasText: 'Jamie Fox' })).toHaveCount(0);

  await picker.selectOption({ label: 'Riley Novak' });
  await expect(sheet.getByRole('alert')).toHaveText(
    'Riley Novak pays together with Alex Chen. Link Riley with Sam instead? Alex Chen will pay on their own.Keep as isLink them',
  );
  await sheet.getByRole('button', { name: 'Keep as is' }).click();
  await expect(picker).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(row(page, 'Alex Chen')).toContainText('with Riley N.');

  await row(page, 'Sam Okafor').click();
  await picker.selectOption({ label: 'Riley Novak' });
  await sheet.getByRole('button', { name: 'Link them' }).click();
  await expect(page.getByText('Linked as paying together')).toBeVisible();
  await expect(sheet).toContainText('Pays together with Riley Novak, so both change together.');
  await page.keyboard.press('Escape');
  await expect(row(page, 'Alex Chen')).not.toContainText('with Riley N.');

  await previousSession(page);
  await expect(row(page, 'Sam Okafor')).not.toContainText('with Riley N.');
});

test('captains fix who paid together in a past session, for that session only', async ({ page }) => {
  await signIn(page);
  await openTeamDues(page);
  await previousSession(page);
  await row(page, 'Sam Okafor').click();
  const sheet = page.getByRole('dialog', { name: 'Sam Okafor' });
  await expect(sheet.getByLabel('Paid together in session 1')).toBeHidden();
  await sheet.getByRole('button', { name: 'Edit who paid together' }).click();
  await expect(sheet).toContainText("Fixes session 1 only. Other sessions don't change.");
  await sheet.getByLabel('Paid together in session 1').selectOption({ label: 'Jordan Rivera' });
  await expect(page.getByText('Linked as paying together in session 1')).toBeVisible();
  await expect(sheet).toContainText('Paid together with Jordan Rivera, so both change together.');
  await page.keyboard.press('Escape');
  await expect(row(page, 'Sam Okafor')).toContainText('with Jordan R.');

  await page.getByRole('button', { name: 'Next session' }).click();
  await expect(row(page, 'Sam Okafor')).not.toContainText('with Jordan R.');
});

test('players set up a second couple from My dues and pay without changing the first couple', async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page, 'chris@demo.test');
  await page.locator('a[href="/dues"]:visible').first().click();
  await page.getByRole('button', { name: 'Pay together', exact: true }).click();
  await page.getByRole('dialog', { name: 'Pay together', exact: true }).getByLabel('Pays together with').selectOption({ label: 'Kelly Moss' });
  await expect(page.getByRole('dialog', { name: 'Pay together', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('my-dues')).toContainText('$122');
  await expect(page.getByTestId('my-dues')).toContainText('$61 each for you and Kelly Moss');
  await expect(page.getByRole('link', { name: 'Pay $122 with Venmo' })).toHaveAttribute('href', /amount=122&/);

  await page.reload();
  await expect(page.getByTestId('my-dues')).toContainText('$122');
  await page.getByRole('button', { name: 'Mark us paid', exact: true }).click();
  await expect(page.getByText("You're both paid up", { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Team dues' }).click();
  await expect(page.getByTestId('dues-paid')).toContainText('Chris Dunn');
  await expect(page.getByTestId('dues-paid')).toContainText('Kelly Moss');
  await expect(page.getByTestId('dues-unpaid')).toContainText('Alex Chen');
  await expect(page.getByTestId('dues-unpaid')).toContainText('Riley Novak');
  await expect(row(page, 'Alex Chen')).toContainText('with Riley N.');
  await previousSession(page);
  await page.getByRole('tab', { name: 'My dues' }).click();
  await expect(page.getByTestId('pay-together')).toHaveCount(0);
});

test('Pay together is available before the session fee is set', async ({ page }) => {
  await signIn(page, JORDAN);
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('jt_demo_db_'));
    const db = JSON.parse(localStorage.getItem(key));
    db.session_dues = db.session_dues.filter((d) => d.session !== 2);
    localStorage.setItem(key, JSON.stringify(db));
  });
  await page.reload();
  await page.locator('a[href="/dues"]:visible').first().click();
  await expect(page.getByText('No fee yet', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pay together', exact: true }).click();
  await page.getByLabel('Pays together with', { exact: true }).selectOption({ label: 'Casey Captain' });
  await expect(page.getByTestId('pay-together')).toContainText('With Casey Captain');
  await expect(page.getByText('No fee yet', { exact: true })).toBeVisible();
});

test('My dues can set next session’s couple while the finished session keeps its payment', async ({ page }) => {
  await signIn(page, JORDAN);
  await betweenSessions(page);
  await page.locator('a[href="/dues"]:visible').first().click();
  await page.getByRole('button', { name: 'Pay together', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Pay together', exact: true })).toContainText('From next session on.');
  await page.getByLabel('Pays together with', { exact: true }).selectOption({ label: 'Casey Captain' });
  await expect(page.getByTestId('pay-together')).toContainText('With Casey Captain');
  await expect(page.getByTestId('my-dues')).toContainText('Your share');
  await expect(page.getByTestId('my-dues')).toContainText('$61');
  await expect(page.getByTestId('my-dues')).not.toContainText('You + Casey');
  await page.getByRole('tab', { name: 'Team dues' }).click();
  await expect(row(page, 'Jordan Rivera')).not.toContainText('with Casey C.');
});

test('relinking two couples names both displaced partners, supports cancellation, and keeps errors recoverable', async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page, 'chris@demo.test');
  await page.locator('a[href="/dues"]:visible').first().click();
  await page.getByRole('button', { name: 'Pay together', exact: true }).click();
  await page.getByLabel('Pays together with', { exact: true }).selectOption({ label: 'Kelly Moss' });
  await expect(page.getByRole('dialog', { name: 'Pay together', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Change who you pay with' }).click();
  const dialog = page.getByRole('dialog', { name: 'Pay together', exact: true });
  await dialog.getByLabel('Pays together with').selectOption({ label: 'Riley Novak' });
  await expect(dialog.getByRole('alert')).toContainText('Alex Chen and Kelly Moss will pay on their own.');
  await dialog.getByRole('button', { name: 'Keep as is' }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByLabel('Pays together with').locator('option:checked')).toHaveText('Kelly Moss');

  await dialog.getByLabel('Pays together with').selectOption({ label: 'Riley Novak' });
  await page.evaluate(() => localStorage.setItem('jt_demo_offline', '1'));
  await dialog.getByRole('button', { name: 'Link them' }).click();
  await expect(page.getByText("That didn't save", { exact: true })).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText('Alex Chen and Kelly Moss will pay on their own.');
  await page.evaluate(() => localStorage.removeItem('jt_demo_offline'));
  await dialog.getByRole('button', { name: 'Link them' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('pay-together')).toContainText('With Riley Novak');
  await page.getByRole('tab', { name: 'Team dues' }).click();
  await expect(row(page, 'Alex Chen')).not.toContainText('with Riley N.');
  await expect(row(page, 'Kelly Moss')).not.toContainText('with Chris D.');
});

test('between sessions, a couple is linked from the next session and the one that ended keeps how it was paid', async ({ page }) => {
  await signIn(page);
  await betweenSessions(page);
  await openTeamDues(page);
  await expect(page.getByTestId('dues-session')).toHaveText('Session 2 · 2026–27');
  await row(page, 'Sam Okafor').click();
  const sheet = page.getByRole('dialog', { name: 'Sam Okafor' });
  await expect(sheet.getByLabel('Paid together in session 2')).toBeHidden();
  await expect(sheet).toContainText('Session 2 keeps who paid together then.');
  await sheet.getByLabel('Pays together from next session').selectOption({ label: 'Morgan Lee' });
  await expect(page.getByText('Linked from next session')).toBeVisible();
  await sheet.getByRole('button', { name: 'Edit who paid together' }).click();
  await expect(sheet.getByLabel('Paid together in session 2')).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(row(page, 'Sam Okafor')).not.toContainText('with Morgan L.');

  await page.getByRole('button', { name: 'Next session' }).click();
  await page.getByRole('button', { name: 'Set the fee' }).click();
  await page.getByRole('dialog', { name: 'Session 3 fee' }).getByRole('button', { name: 'Save fee' }).click();
  await expect(row(page, 'Sam Okafor')).toContainText('with Morgan L.');
});
