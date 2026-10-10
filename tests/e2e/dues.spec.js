// The Dues page: everyone sees what they owe and the team's dues, and anyone
// can mark players paid; marking someone not paid takes a second tap and is
// kept in the history; couples pay together; captains set the fee, custom
// amounts and payment links. The database enforces who can change what
// (supabase/tests/dues.test.sql).
import { expect, signIn, test } from './helpers';

// Alex Chen and Riley Novak are a couple who pay together and haven't paid this session in the sample data.
const ALEX = 'alex@demo.test';
const JORDAN = 'jordan@demo.test'; // paid two days ago, and marked it herself
const PAYPAL_QR = 'https://www.paypal.com/qrcodes/p2pqrc/WWQM2FMVLDVBQ';

/** The Dues tab: bottom bar on phones, top bar on computers. */
async function openDues(page) {
  await page.locator('a[href="/dues"]:visible').first().click();
  await expect(page.getByRole('heading', { name: 'Dues', exact: true })).toBeVisible();
}

const paidHeading = (page, text) => page.getByRole('heading', { name: text });

test('Dues has its own tab, where Profile used to be', async ({ page }) => {
  await signIn(page, JORDAN);
  const tabs = page.locator('nav:visible a');
  await expect(tabs).toHaveText([/Schedule/i, /Stats/i, /Team/i, /Chat/i, /Rules/i, /Dues/i]);
  await openDues(page);
  await expect(page.getByTestId('my-dues')).toBeVisible();
});

test('a player sees what they owe for themselves and their partner, with Venmo and PayPal buttons', async ({ page }) => {
  await signIn(page, ALEX);
  await openDues(page);
  await expect(page.getByRole('tab', { name: 'My dues' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('dues-session')).toHaveText('Session 2 · 2026');

  const card = page.getByTestId('my-dues');
  await expect(card).toContainText('$146');
  await expect(card).toContainText('$73 each for you and Riley Novak');
  await expect(card).toContainText('Unpaid');
  await expect(card).toContainText('League fee$595');
  await expect(card).toContainText('Refs · 7 games × $18$126');
  await expect(card).toContainText('Session total$721');
  await expect(card).toContainText('Split across 10 active players');

  await expect(page.getByRole('link', { name: 'Pay $146 with Venmo' })).toHaveAttribute(
    'href',
    'https://venmo.com/B-Kircher?txn=pay&audience=private&amount=146&note=Jive%20Turkeys%20dues%20%C2%B7%20Session%202%202026%20%C2%B7%20Alex%20Chen%20%26%20Riley%20Novak',
  );
  const paypal = page.getByRole('link', { name: 'Pay $146 with PayPal' });
  await expect(paypal).toHaveAttribute('href', PAYPAL_QR);
  await expect(paypal).toContainText('Enter $146');
  await expect(page.getByText('Cash at the field works too.')).toBeVisible();
  await expect(page.getByText('Other sessions')).toBeVisible();

  // Everyone sees how the team is doing, and who has and hasn't paid.
  const progress = page.getByTestId('team-progress');
  await expect(progress).toContainText('Team · 5 of 10 paid');
  await expect(progress).toContainText('$365 of $730 in');
  await progress.getByRole('button', { name: "See who has and hasn't paid" }).click();
  await expect(page.getByRole('tab', { name: 'Team dues' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('dues-unpaid')).toContainText('Alex Chen');
  await expect(page.getByTestId('dues-paid')).toContainText('Jordan Rivera');
});

test('marking yourself paid is one tap; marking not paid asks first and stays in your history', async ({ page }) => {
  await signIn(page, ALEX);
  await openDues(page);
  const card = page.getByTestId('my-dues');

  await page.getByRole('button', { name: 'Mark us paid' }).click();
  await expect(card).toContainText('Paid Oct 8');
  await expect(page.getByText("You're both paid up")).toBeVisible();
  await expect(page.getByText('Marked paid Oct 8 by you. Thanks!')).toBeVisible();
  await expect(page.getByRole('link', { name: /with Venmo/ })).toHaveCount(0);

  // A slip of the finger changes nothing: it asks first.
  await page.getByRole('button', { name: 'Not right? Mark as not paid' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mark as not paid?' });
  await expect(dialog).toContainText('Alex Chen and Riley Novak will show as unpaid');
  await dialog.getByRole('button', { name: 'Keep as paid' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card).toContainText('Paid Oct 8');

  await page.getByRole('button', { name: 'Not right? Mark as not paid' }).click();
  await dialog.getByRole('button', { name: 'Mark not paid' }).click();
  await expect(card).toContainText('Unpaid');
  await expect(page.getByRole('button', { name: 'Mark us paid' })).toBeVisible();
  const history = page.locator('section', { hasText: 'Your history' });
  await expect(history).toContainText('You marked yourself not paid');
  await expect(history).toContainText('You marked yourself paid');
});

test('a player who has paid sees a thank-you instead of pay buttons', async ({ page }) => {
  await signIn(page, JORDAN);
  await openDues(page);
  await expect(page.getByTestId('my-dues')).toContainText('Paid Oct 6');
  await expect(page.getByText("You're paid up")).toBeVisible();
  await expect(page.getByText('Marked paid Oct 6 by you. Thanks!')).toBeVisible();
  await expect(page.getByRole('link', { name: /with Venmo/ })).toHaveCount(0);
});

test('anyone can mark teammates paid in one tap, but undoing one takes two taps and is kept in the history', async ({ page }) => {
  await signIn(page, JORDAN);
  await openDues(page);
  await page.getByRole('tab', { name: 'Team dues' }).click();

  await expect(paidHeading(page, '5 of 10 paid')).toBeVisible();
  await expect(page.getByText('$595 league + 7 × $18 refs = $721. Rounding up adds $9.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit fee' })).toHaveCount(0);
  await expect(page.getByText('Payment links')).toHaveCount(0);
  await expect(page.getByLabel('Amount for Kelly Moss')).toHaveText('$73');

  await page.getByRole('button', { name: 'Mark Kelly Moss paid' }).click();
  await expect(paidHeading(page, '6 of 10 paid')).toBeVisible();
  await expect(page.getByTestId('dues-paid')).toContainText('Kelly Moss');
  await expect(page.getByTestId('dues-paid')).toContainText('marked by Jordan R.');
  // A paid player has no button to tap by accident.
  await expect(page.getByRole('button', { name: 'Mark Kelly Moss paid' })).toHaveCount(0);
  await expect(page.locator('section', { hasText: 'Recent changes' })).toContainText('You marked Kelly M. paid');

  await page.getByRole('button', { name: 'Details for Kelly Moss' }).click();
  const sheet = page.getByRole('dialog', { name: 'Kelly Moss' });
  await expect(sheet).toContainText('Marked paid Oct 8 by Jordan.');
  await sheet.getByRole('button', { name: 'Mark as not paid' }).click();
  await expect(sheet).toContainText('Kelly Moss will show as unpaid');
  await sheet.getByRole('button', { name: 'Keep as paid' }).click();
  await expect(sheet.getByRole('button', { name: 'Mark not paid' })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Mark as not paid' }).click();
  await sheet.getByRole('button', { name: 'Mark not paid' }).click();
  await expect(sheet.getByRole('button', { name: 'Mark paid', exact: true })).toBeVisible();
  await expect(sheet).toContainText('You marked Kelly M. not paid');
  await expect(sheet).toContainText('You marked Kelly M. paid');
  await page.keyboard.press('Escape');
  await expect(paidHeading(page, '5 of 10 paid')).toBeVisible();
});

test('a couple are marked paid together, and anyone can link a couple', async ({ page }) => {
  await signIn(page, JORDAN);
  await openDues(page);
  await page.getByRole('tab', { name: 'Team dues' }).click();

  await expect(page.getByTestId('dues-unpaid')).toContainText(/Alex Chen.*Riley Novak.*Casey Captain/);
  await page.getByRole('button', { name: 'Mark Riley Novak paid' }).click();
  await expect(paidHeading(page, '7 of 10 paid')).toBeVisible();
  await expect(page.getByTestId('dues-paid')).toContainText('Alex Chen');

  await page.getByRole('button', { name: 'Details for Chris Dunn' }).click();
  const sheet = page.getByRole('dialog', { name: 'Chris Dunn' });
  await sheet.getByLabel('Pays together with').selectOption({ label: 'Kelly Moss' });
  await expect(page.getByText('Linked as paying together')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Mark both paid' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dues-unpaid')).toContainText('with Kelly M.');
});

test('a captain edits the fee and copies a reminder', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page);
  await openDues(page);
  await expect(page.getByRole('tab', { name: 'Team dues' })).toHaveAttribute('aria-selected', 'true');
  await expect(paidHeading(page, '5 of 10 paid')).toBeVisible();
  await expect(page.getByText('$73 each')).toBeVisible();

  await page.getByRole('button', { name: 'Copy reminder' }).click();
  await expect(page.getByText('Reminder copied')).toBeVisible();
  const reminder = await page.evaluate(() => navigator.clipboard.readText());
  expect(reminder).toContain('Session 2 dues: $73 each');
  expect(reminder).toContain("That's the $595 league fee plus $18 refs × 7 games = $721, split across 10 players.");
  expect(reminder).toContain('Still to pay: Alex Chen & Riley Novak ($146), Casey Captain, Chris Dunn, Kelly Moss');

  await page.getByRole('button', { name: 'Edit fee' }).click();
  const dialog = page.getByRole('dialog', { name: 'Session 2 fee' });
  await expect(dialog.getByLabel('League fee')).toHaveValue('595');
  await expect(dialog.getByLabel('Games')).toHaveValue('7');
  await dialog.getByLabel('Ref fee / game').fill('20');
  await expect(dialog).toContainText('$735');
  await dialog.getByRole('button', { name: 'Save fee' }).click();
  await expect(page.getByText('$595 league + 7 × $20 refs = $735. Rounding up adds $5.')).toBeVisible();
  await expect(page.getByText('$74 each')).toBeVisible();

  await page.getByRole('tab', { name: 'My dues' }).click();
  await expect(page.getByTestId('my-dues')).toContainText('$74');
  await expect(page.getByTestId('my-dues')).toContainText('Refs · 7 games × $20$140');
});

test('a captain pastes payment links, and players get the buttons', async ({ page }) => {
  await signIn(page);
  await openDues(page);
  await expect(page.getByText('Venmo @B-Kircher · PayPal')).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Payment links' });
  await dialog.getByLabel('Venmo').fill('https://venmo.com/u/Some-One');
  await dialog.getByLabel('PayPal').fill('https://paypal.me/SomeOne');
  await dialog.getByRole('button', { name: 'Save payment links' }).click();
  await expect(page.getByText('Payment links saved')).toBeVisible();
  await expect(page.getByText('Venmo @Some-One · PayPal')).toBeVisible();

  await page.getByRole('tab', { name: 'My dues' }).click();
  await expect(page.getByRole('link', { name: 'Pay $73 with Venmo' })).toHaveAttribute('href', /^https:\/\/venmo\.com\/Some-One\?/);
  await expect(page.getByRole('link', { name: 'Pay $73 with PayPal' })).toHaveAttribute('href', 'https://paypal.me/SomeOne/73');
});

test('a captain gives one player a custom amount, and the rest split what is left', async ({ page }) => {
  await signIn(page);
  await openDues(page);
  await page.getByRole('button', { name: 'Details for Kelly Moss' }).click();
  const sheet = page.getByRole('dialog', { name: 'Kelly Moss' });
  await sheet.getByLabel('Custom amount').fill('40');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toContainText('$40 · custom amount');
  await page.keyboard.press('Escape');
  // $721 - $40 = $681 across the other 9: $75.67, rounded up.
  await expect(page.getByLabel('Amount for Casey Captain')).toHaveText('$76');

  await page.getByRole('button', { name: 'Details for Kelly Moss' }).click();
  await sheet.getByRole('button', { name: 'Use the even split ($76) instead' }).click();
  await expect(sheet).toContainText('$73 · even split');
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Amount for Casey Captain')).toHaveText('$73');
});

test('stepping between sessions, and setting a new session fee from the last one', async ({ page }) => {
  await signIn(page);
  await openDues(page);
  await page.getByRole('button', { name: 'Previous session' }).click();
  await expect(page.getByTestId('dues-session')).toHaveText('Session 1 · 2026');
  await expect(paidHeading(page, '10 of 10 paid')).toBeVisible();

  await page.getByRole('button', { name: 'Next session' }).click();
  await page.getByRole('button', { name: 'Next session' }).click();
  await expect(page.getByTestId('dues-session')).toHaveText('Session 3 · 2026');
  await expect(page.getByText('No fee yet')).toBeVisible();
  await page.getByRole('button', { name: 'Set the fee' }).click();
  const dialog = page.getByRole('dialog', { name: 'Session 3 fee' });
  await expect(dialog.getByLabel('League fee')).toHaveValue('595');
  await expect(dialog.getByLabel('Ref fee / game')).toHaveValue('18');
  await dialog.getByRole('button', { name: 'Save fee' }).click();
  await expect(paidHeading(page, '0 of 10 paid')).toBeVisible();
});
