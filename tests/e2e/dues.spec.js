// The Dues page: everyone sees what they owe and the team's dues, and anyone
// can mark players paid; marking someone not paid takes a second tap and is
// kept in the history; couples pay together; captains set the fee, custom
// amounts and payment links. The database enforces who can change what
// (supabase/tests/dues.test.sql).
import { duesOption, expect, openSection, signIn, test } from './helpers';

// Alex Chen and Riley Novak are a couple who pay together and haven't paid this session in the sample data.
const ALEX = 'alex@demo.test';
const JORDAN = 'jordan@demo.test'; // paid two days ago, and marked it herself
const SAM = 'sam@demo.test'; // paid $50 before the ref fees were added; the share is now $61
const PAYPAL_QR = 'https://www.paypal.com/qrcodes/p2pqrc/WWQM2FMVLDVBQ';

/** The Dues tab: bottom bar on phones, top bar on computers. */
async function openDues(page) {
  await page.locator('a[href="/dues"]:visible').first().click();
  await expect(page.getByRole('heading', { name: 'Dues', exact: true })).toBeVisible();
}

const paidHeading = (page, text) => page.getByRole('heading', { name: text });

/** Changes players through the normal sign-in flow, keeping this session's sample payments. */
async function switchPlayer(page, email, { returning = false } = {}) {
  await page.getByRole('link', { name: 'My profile' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  await openDues(page);
}

async function linkPartners(page, player, partner) {
  await page.getByRole('tab', { name: 'Team dues' }).click();
  await page.getByRole('button', { name: `Details for ${player}` }).click();
  const sheet = page.getByRole('dialog', { name: player });
  await duesOption(sheet, 'Pay together');
  await sheet.getByLabel('Pays together with').selectOption({ label: partner });
  await expect(page.getByText('Linked as paying together')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'My dues' }).click();
}

async function expectRemaining(page, amount) {
  await expect(page.getByRole('link', { name: `Pay $${amount} with Venmo` })).toHaveAttribute('href', new RegExp(`amount=${amount}&`));
  await expect(page.getByTestId('my-dues')).toContainText('Part paid');
  await expect(page.getByText("You're both paid up")).toHaveCount(0);
  await expect(page.getByTestId('pay-difference')).toContainText('Pay the rest');
  const paypal = page.getByRole('link', { name: `Pay $${amount} with PayPal` });
  await expect(paypal).toHaveAttribute('href', PAYPAL_QR);
  await expect(paypal).toContainText(`Enter $${amount}`);
}

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
  await expect(page.getByTestId('dues-session')).toHaveText('Session 2 · 2026–27');

  const card = page.getByTestId('my-dues');
  await expect(card).toContainText('$122');
  await expect(card).toContainText('$61 each for you and Riley Novak');
  await expect(card).toContainText('Unpaid');
  await expect(card).toContainText('League fee$595');
  await expect(card).toContainText('Refs · 7 games × $18$126');
  await expect(card).toContainText('Session total$721');
  await expect(card).toContainText('Split across 12 active players');

  await expect(page.getByRole('link', { name: 'Pay $122 with Venmo' })).toHaveAttribute(
    'href',
    'https://venmo.com/B-Kircher?txn=pay&audience=private&amount=122&note=Jive%20Turkeys%20dues%20%C2%B7%20Session%202%202026%E2%80%9327%20%C2%B7%20Alex%20Chen%20%26%20Riley%20Novak',
  );
  const paypal = page.getByRole('link', { name: 'Pay $122 with PayPal' });
  await expect(paypal).toHaveAttribute('href', PAYPAL_QR);
  await expect(paypal).toContainText('Enter $122');
  await expect(page.getByText('Cash at the field works too.')).toBeVisible();
  await expect(page.getByText('Other sessions')).toBeVisible();

  // Everyone sees how the team is doing, and who has and hasn't paid.
  const progress = page.getByTestId('team-progress');
  await expect(progress).toContainText('Team · 5 of 12 paid');
  // Five of the twelve paid (Sam $50, before his share went up), Morgan $30 of her $61 so far, and Jamie,
  // who is unavailable, paid too.
  await expect(progress).toContainText('$385 in · $408 to go');
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
  await expect(card).toContainText('Paid in full Oct 8');
  await expect(page.getByText("You're both paid up")).toBeVisible();
  await expect(page.getByText('Marked paid Oct 8 by you. Thanks!')).toBeVisible();
  await expect(page.getByRole('link', { name: /with Venmo/ })).toHaveCount(0);

  // A slip of the finger changes nothing: it asks first.
  await page.getByRole('button', { name: 'Not right? Mark as not paid' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mark as not paid?' });
  await expect(dialog).toContainText('Alex Chen and Riley Novak will show as unpaid');
  await dialog.getByRole('button', { name: 'Keep as paid' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card).toContainText('Paid in full Oct 8');

  await page.getByRole('button', { name: 'Not right? Mark as not paid' }).click();
  await dialog.getByRole('button', { name: 'Mark not paid' }).click();
  await expect(card).toContainText('Unpaid');
  await expect(page.getByRole('button', { name: 'Mark us paid' })).toBeVisible();
  await openSection(page, 'Payment details');
  const history = page.locator('section', { hasText: 'Your history' });
  await expect(history).toContainText('You marked yourself not paid');
  await expect(history).toContainText('You marked yourself paid');
});

test('a player who has paid sees a thank-you instead of pay buttons', async ({ page }) => {
  await signIn(page, JORDAN);
  await openDues(page);
  await expect(page.getByTestId('my-dues')).toContainText('Paid in full Oct 6');
  await expect(page.getByText("You're paid up")).toBeVisible();
  await expect(page.getByText('Marked paid Oct 6 by you. Thanks!')).toBeVisible();
  await expect(page.getByRole('link', { name: /with Venmo/ })).toHaveCount(0);
});

test('anyone can mark teammates paid in one tap, but undoing one takes two taps and is kept in the history', async ({ page }) => {
  await signIn(page, JORDAN);
  await openDues(page);
  await page.getByRole('tab', { name: 'Team dues' }).click();

  await expect(paidHeading(page, '5 of 12 paid')).toBeVisible();
  await expect(page.getByText('$595 league + 7 × $18 refs = $721. Rounding up adds $11.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit fee' })).toHaveCount(0);
  await expect(page.getByText('Payment links')).toHaveCount(0);
  await expect(page.getByLabel('Amount for Kelly Moss')).toHaveText('$61');

  await page.getByRole('button', { name: 'Mark paid for Kelly Moss' }).click();
  await expect(paidHeading(page, '6 of 12 paid')).toBeVisible();
  await expect(page.getByTestId('dues-paid')).toContainText('Kelly Moss');
  await expect(page.getByTestId('dues-paid')).toContainText('marked by Jordan R.');
  // A paid player has no button to tap by accident.
  await expect(page.getByRole('button', { name: 'Mark paid for Kelly Moss' })).toHaveCount(0);
  await expect((await openSection(page, 'Recent changes'))).toContainText('You marked Kelly M. paid');

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
  await sheet.getByRole('button', { name: 'History', exact: true }).click();
  await expect(sheet).toContainText('You marked Kelly M. not paid');
  await expect(sheet).toContainText('You marked Kelly M. paid');
  await page.keyboard.press('Escape');
  await expect(paidHeading(page, '5 of 12 paid')).toBeVisible();
});

test('a couple are marked paid together, and anyone can link a couple', async ({ page }) => {
  await signIn(page, JORDAN);
  await openDues(page);
  await page.getByRole('tab', { name: 'Team dues' }).click();

  await expect(page.getByTestId('dues-unpaid')).toContainText(/Alex Chen.*Riley Novak.*Casey Captain/);
  await page.getByRole('button', { name: 'Mark paid for Riley Novak' }).click();
  await expect(paidHeading(page, '7 of 12 paid')).toBeVisible();
  await expect(page.getByTestId('dues-paid')).toContainText('Alex Chen');

  await page.getByRole('button', { name: 'Details for Chris Dunn' }).click();
  const sheet = page.getByRole('dialog', { name: 'Chris Dunn' });
  await duesOption(sheet, 'Pay together');
  await sheet.getByLabel('Pays together with').selectOption({ label: 'Kelly Moss' });
  await expect(page.getByText('Linked as paying together')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Mark both paid' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dues-unpaid')).toContainText('with Kelly M.');
});

test('linking an unpaid partner shows the remaining payment to both players and keeps the earlier payment', async ({ page }) => {
  await signIn(page, JORDAN);
  await openDues(page);
  await linkPartners(page, 'Jordan Rivera', 'Kelly Moss');

  // Jordan already paid $61; linking Kelly must not mark Kelly paid or ask for Jordan's share again.
  await expectRemaining(page, 61);
  await switchPlayer(page, 'kelly@demo.test');
  await expectRemaining(page, 61);
  await page.getByRole('button', { name: 'Mark $61 paid', exact: true }).click();
  await expect(page.getByText("You're both paid up")).toBeVisible();
  await expect(page.getByRole('link', { name: /with Venmo|with PayPal/ })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Team dues' }).click();
  await expect(page.getByLabel('Amount for Jordan Rivera')).toHaveText('$61');
  await expect(page.getByLabel('Amount for Kelly Moss')).toHaveText('$61');
  await page.getByRole('button', { name: 'Details for Jordan Rivera' }).click();
  await expect(page.getByRole('dialog', { name: 'Jordan Rivera' })).toContainText('Marked paid Oct 6.');
  await page.keyboard.press('Escape');

  await switchPlayer(page, JORDAN, { returning: true });
  await expect(page.getByText("You're both paid up")).toBeVisible();
  await expect(page.getByTestId('my-dues')).toContainText('Paid in full Oct 6');
  await expect(page.getByRole('link', { name: /with Venmo|with PayPal/ })).toHaveCount(0);
});

for (const pair of [
  { first: 'Morgan Lee', firstEmail: 'morgan@demo.test', second: 'Kelly Moss', secondEmail: 'kelly@demo.test', remaining: 92 },
  { first: 'Sam Okafor', firstEmail: SAM, second: 'Morgan Lee', secondEmail: 'morgan@demo.test', remaining: 42 },
]) {
  test(`${pair.first} and ${pair.second} both see the balance after their existing partial payments`, async ({ page }) => {
    await signIn(page, pair.firstEmail);
    await openDues(page);
    await linkPartners(page, pair.first, pair.second);
    await expectRemaining(page, pair.remaining);
    await switchPlayer(page, pair.secondEmail);
    await expectRemaining(page, pair.remaining);

    // Another partial payment must subtract from the combined balance for either player.
    const half = pair.remaining / 2;
    await page.getByRole('button', { name: 'Paid part of it?' }).click();
    await page.getByLabel('Amount paid for both').fill(String(half));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expectRemaining(page, half);
    await switchPlayer(page, pair.firstEmail, { returning: true });
    await expectRemaining(page, half);
    await page.getByRole('button', { name: `Mark $${half} paid`, exact: true }).click();
    await expect(page.getByText("You're both paid up")).toBeVisible();
    await expect(page.getByRole('link', { name: /with Venmo|with PayPal/ })).toHaveCount(0);
  });
}

test('partners include both outstanding differences after the session fee increases', async ({ page }) => {
  await signIn(page);
  await openDues(page);
  await page.getByRole('button', { name: 'Edit fee' }).click();
  const fee = page.getByRole('dialog', { name: 'Session 2 fee' });
  await fee.getByLabel('Ref fee / game').fill('20');
  await fee.getByRole('button', { name: 'Save fee' }).click();
  await expect(page.getByText('$62 each')).toBeVisible();
  await linkPartners(page, 'Sam Okafor', 'Morgan Lee');

  // Sam's $50 and Morgan's $30 stay recorded against two new $62 shares.
  await switchPlayer(page, SAM);
  await expectRemaining(page, 44);
  await switchPlayer(page, 'morgan@demo.test');
  await expectRemaining(page, 44);
});

test('a captain edits the fee and copies a reminder', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page);
  await openDues(page);
  await expect(page.getByRole('tab', { name: 'Team dues' })).toHaveAttribute('aria-selected', 'true');
  await expect(paidHeading(page, '5 of 12 paid')).toBeVisible();
  await expect(page.getByText('$61 each')).toBeVisible();

  await page.getByRole('button', { name: 'Remind who owes' }).click();
  await page.getByRole('dialog', { name: 'Remind who owes' }).getByRole('button', { name: 'Copy instead' }).click();
  await expect(page.getByText('Copied', { exact: true })).toBeVisible();
  const reminder = await page.evaluate(() => navigator.clipboard.readText());
  expect(reminder).toContain('Session 2 dues: $61 each');
  expect(reminder).toContain("That's the $595 league fee plus $18 refs × 7 games = $721, split across 12 players.");
  expect(reminder).toContain('Still to pay: Alex Chen & Riley Novak ($122), Casey Captain, Chris Dunn, Kelly Moss, Mike Russo, Morgan Lee ($31 more), Sam Okafor ($11 more)');

  await page.getByRole('button', { name: 'Edit fee' }).click();
  const dialog = page.getByRole('dialog', { name: 'Session 2 fee' });
  await expect(dialog.getByLabel('League fee')).toHaveValue('595');
  await expect(dialog.getByLabel('Games')).toHaveValue('7');
  await dialog.getByLabel('Ref fee / game').fill('20');
  await expect(dialog).toContainText('$735');
  await dialog.getByRole('button', { name: 'Save fee' }).click();
  await expect(page.getByText('$595 league + 7 × $20 refs = $735. Rounding up adds $9.')).toBeVisible();
  await expect(page.getByText('$62 each')).toBeVisible();
  // Everyone can see the fee changed, by whom, and from what.
  await expect((await openSection(page, 'Recent changes'))).toContainText('You changed the session fee: $721 → $735 (refs $18 → $20)');

  await page.getByRole('tab', { name: 'My dues' }).click();
  await expect(page.getByTestId('my-dues')).toContainText('$62');
  await expect(page.getByTestId('my-dues')).toContainText('Refs · 7 games × $20$140');
});

test('captains save league and referee fees with cents while games stay whole', async ({ page }) => {
  await signIn(page);
  await openDues(page);
  await page.getByRole('button', { name: 'Edit fee' }).click();
  const dialog = page.getByRole('dialog', { name: 'Session 2 fee' });
  await dialog.getByLabel('League fee').fill('595.50');
  await dialog.getByLabel('Ref fee / game').fill('18.25');
  await dialog.getByLabel('Games').fill('7.5');
  await expect(dialog).toContainText('Games is a whole number.');
  await expect(dialog.getByRole('button', { name: 'Save fee' })).toBeDisabled();
  await dialog.getByLabel('Games').fill('7');
  await dialog.getByRole('button', { name: 'Save fee' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('$595.50 league + 7 × $18.25 refs = $723.25. Rounding up adds $8.75.')).toBeVisible();

  // Reload and reopen the form: both decimal amounts were actually saved.
  await page.reload();
  await page.getByRole('button', { name: 'Edit fee' }).click();
  await expect(dialog.getByLabel('League fee')).toHaveValue('595.5');
  await expect(dialog.getByLabel('Ref fee / game')).toHaveValue('18.25');
  await expect(dialog.getByLabel('Games')).toHaveValue('7');
});

test('players keep what they paid when the fee changes, and the difference can be marked paid', async ({ page }) => {
  await signIn(page);
  await openDues(page);
  const owing = page.getByTestId('dues-unpaid');
  const summary = page.locator('section', { hasText: 'Still to collect' });

  // Sam paid his whole $50 share before the ref fees were added: he's paid, with a top-up to pay.
  const paid = page.getByTestId('dues-paid');
  await expect(page.getByLabel('Amount for Sam Okafor')).toHaveText('$50');
  await expect(paid).toContainText('Sam Okafor');
  await expect(paid).toContainText('share went up');
  await expect(page.getByRole('button', { name: 'Mark $11 paid for Sam Okafor' })).toBeVisible();
  await expect(paidHeading(page, '5 of 12 paid')).toBeVisible();
  await expect(page.getByText('1 owes a top-up')).toBeVisible();
  // Morgan gave the captain $30 of her $61: a part payment, still to pay.
  await expect(owing).toContainText('Morgan Lee');
  await expect(owing).toContainText('$30 paid of $61');
  await expect(owing).not.toContainText('Sam Okafor');
  await expect(page.getByLabel('Amount for Morgan Lee')).toHaveText('$31left');
  await expect(summary).toContainText('$385Collected');
  await expect(summary).toContainText('$408Still to collect');
  await expect(summary).toContainText('$595 league + 7 × $18 refs = $721. Rounding up adds $11. Collected includes $61 from players not playing.');

  // Jamie paid, then decided to sit this session out: she's listed, and owes nothing.
  const notPlaying = page.getByTestId('dues-not-playing');
  await expect(notPlaying).toContainText('Paid, not playing · 1');
  await expect(notPlaying).toContainText('Jamie Foxunavailable');
  await expect(page.getByLabel('Amount for Jamie Fox')).toHaveText('$61');

  // The refs go up to $20 a game: $735, $62 each. Everyone who paid keeps what they paid.
  await page.getByRole('button', { name: 'Edit fee' }).click();
  const dialog = page.getByRole('dialog', { name: 'Session 2 fee' });
  await dialog.getByLabel('Ref fee / game').fill('20');
  await dialog.getByRole('button', { name: 'Save fee' }).click();
  await expect(page.getByText('$62 each')).toBeVisible();
  // Everyone who had paid in full is still paid, with a top-up; Morgan's part payment is still to pay.
  await expect(page.getByLabel('Amount for Jordan Rivera')).toHaveText('$61');
  await expect(page.getByRole('button', { name: 'Mark $1 paid for Jordan Rivera' })).toBeVisible();
  await expect(page.getByLabel('Amount for Sam Okafor')).toHaveText('$50');
  await expect(page.getByRole('button', { name: 'Mark $12 paid for Sam Okafor' })).toBeVisible();
  await expect(page.getByLabel('Amount for Morgan Lee')).toHaveText('$32left');
  await expect(paidHeading(page, '5 of 12 paid')).toBeVisible();
  await expect(page.getByText('5 owe a top-up')).toBeVisible();
  // Collected stays what was paid; still to collect gains the differences ($1 each for four, Morgan's $32 and Sam's $12).
  await expect(summary).toContainText('$385Collected');
  await expect(summary).toContainText('$420Still to collect');

  await page.getByRole('button', { name: 'Mark $1 paid for Jordan Rivera' }).click();
  await expect(page.getByText('Jordan Rivera: $1 more marked paid')).toBeVisible();
  await expect(page.getByLabel('Amount for Jordan Rivera')).toHaveText('$62');
  await expect(page.getByRole('button', { name: 'Mark $1 paid for Jordan Rivera' })).toHaveCount(0);
  await expect(summary).toContainText('$386Collected');
  await expect((await openSection(page, 'Recent changes'))).toContainText('You marked Jordan R. paid $1 more');

  await page.getByRole('button', { name: 'Details for Sam Okafor' }).click();
  const sheet = page.getByRole('dialog', { name: 'Sam Okafor' });
  await expect(sheet).toContainText('Paid $50 · share went up to $62 · $12 more to pay.');
  await expect(sheet).toContainText('Paid · owes $12');
  await sheet.getByRole('button', { name: 'History', exact: true }).click();
  await expect(sheet).toContainText('Sam O. marked themselves paid $50');
  await page.keyboard.press('Escape');

  // Jamie's sheet: what she paid, and she can be marked not paid (say, once she has her money back).
  await page.getByRole('button', { name: 'Details for Jamie Fox' }).click();
  const jamie = page.getByRole('dialog', { name: 'Jamie Fox' });
  await expect(jamie).toContainText('Not playing · unavailable');
  await expect(jamie).toContainText("Paid $61. Marked paid Sep 28. They aren't on this session's roster");
  await expect(jamie.getByLabel('Custom amount')).toHaveCount(0);
  await jamie.getByRole('button', { name: 'Mark as not paid' }).click();
  await jamie.getByRole('button', { name: 'Mark not paid' }).click();
  await expect(page.getByText('Jamie Fox marked not paid')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dues-not-playing')).toHaveCount(0);
  await expect(summary).toContainText('$325Collected');
});

test('a player whose share went up after they paid sees the difference and pays it', async ({ page }) => {
  await signIn(page, SAM);
  await openDues(page);
  const card = page.getByTestId('my-dues');
  await expect(card).toContainText('$61');
  await expect(card).not.toContainText('Paid in full');
  // He paid his whole share then, so it's a top-up, not a part payment.
  await expect(card).toContainText('Paid · owes $11');
  await expect(card).not.toContainText('Part paid');
  await expect(card).toContainText('$11more to pay');
  await expect(card).toContainText('You paid $50. Your share went up to $61.');
  // Why, on the card: the latest change since he paid. All of them are under Payment details:
  // the ref fees were added after he paid, and Jamie is unavailable.
  await expect(page.getByTestId('share-why')).toHaveText('Why: Jamie F. is unavailable · and 1 more in Payment details');
  await openSection(page, 'Payment details');
  const why = page.getByTestId('why-share-changed');
  await expect(why).toContainText('Casey C. changed the session fee: $595 → $721 (refs $0 → $18)');
  await expect(why).toContainText('Jamie F. is unavailable');
  const difference = page.getByTestId('pay-difference');
  await expect(difference).toContainText('Pay the rest');
  await expect(page.getByRole('link', { name: 'Pay $11 with Venmo' })).toHaveAttribute('href', /amount=11&/);
  await expect(page.getByText("You're paid up")).toHaveCount(0);

  await difference.getByRole('button', { name: 'Mark $11 paid' }).click();
  await expect(page.getByText("You're paid up")).toBeVisible();
  await expect(page.getByTestId('pay-difference')).toHaveCount(0);
  await expect(card).not.toContainText('more to pay');
  await openSection(page, 'Payment details');
  const history = page.locator('section', { hasText: 'Your history' });
  await expect(history).toContainText('You marked yourself paid $11 more');
  await expect(history).toContainText('You marked yourself paid $50');
});

test('a player pays part of their share, and the rest stays on the list to pay', async ({ page }) => {
  await signIn(page, 'kelly@demo.test');
  await openDues(page);
  const card = page.getByTestId('my-dues');

  await page.getByRole('button', { name: 'Paid part of it?' }).click();
  const amount = page.getByLabel('Amount paid');
  // Never more than what's owed.
  await amount.fill('70');
  await expect(page.getByText("That's more than the $61 still owed.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await amount.fill('25');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('$25 marked paid. Thanks!')).toBeVisible();
  await expect(card).toContainText('$36left to pay');
  await expect(card).toContainText('$25 paid of $61.');
  await expect(page.getByTestId('pay-difference')).toContainText('Pay the rest');
  await expect(page.getByRole('link', { name: 'Pay $36 with Venmo' })).toHaveAttribute('href', /amount=36&/);

  // Another $10 later.
  await page.getByRole('button', { name: 'Paid part of it?' }).click();
  await page.getByLabel('Amount paid').fill('10');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card).toContainText('$26left to pay');
  await expect(card).toContainText('$35 paid of $61.');
  await openSection(page, 'Payment details');
  const history = page.locator('section', { hasText: 'Your history' });
  await expect(history).toContainText('You marked yourself paid $10 more');
  await expect(history).toContainText('You marked yourself paid $25');

  // On Team dues she's paid, with the rest to go, and anyone can mark the rest paid.
  await page.getByRole('tab', { name: 'Team dues' }).click();
  await expect(page.getByTestId('dues-unpaid')).toContainText('Kelly Moss');
  await expect(page.getByLabel('Amount for Kelly Moss')).toHaveText('$26left');
  await expect(page.getByTestId('dues-unpaid')).toContainText('$35 paid of $61');
  await page.getByRole('button', { name: 'Mark $26 paid for Kelly Moss' }).click();
  await expect(page.getByLabel('Amount for Kelly Moss')).toHaveText('$61');
});

test("anyone can record part of a couple's payment, split between them by their shares", async ({ page }) => {
  await signIn(page, JORDAN);
  await openDues(page);
  await page.getByRole('tab', { name: 'Team dues' }).click();
  await page.getByRole('button', { name: 'Details for Alex Chen' }).click();
  const sheet = page.getByRole('dialog', { name: 'Alex Chen' });
  await duesOption(sheet, 'Record part payment');
  await sheet.getByLabel('Amount paid for both').fill('80');
  await expect(sheet).toContainText("Split by each one's share.");
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('$80 marked paid for Alex Chen & Riley Novak')).toBeVisible();
  await expect(sheet).toContainText('Paid $40 of $61 · $42 more to pay.');
  await expect(sheet.getByRole('button', { name: 'Mark $42 more paid' })).toBeVisible();
  await sheet.getByRole('button', { name: 'History', exact: true }).click();
  await expect(sheet).toContainText('You marked Alex C. paid $40');
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Amount for Alex Chen')).toHaveText('$21left');
  await expect(page.getByLabel('Amount for Riley Novak')).toHaveText('$21left');
  await expect(paidHeading(page, '5 of 12 paid')).toBeVisible();
});

test('a player who paid and is unavailable the session sees that they owe nothing', async ({ page }) => {
  await signIn(page, 'jamie@demo.test');
  await openDues(page);
  const card = page.getByTestId('my-dues');
  await expect(card).toContainText('Not on the roster');
  await expect(card).toContainText("so you don't owe anything. You paid $61 for it, and your captains can see that on Team dues.");
  await expect(page.getByRole('link', { name: /with Venmo/ })).toHaveCount(0);
});

test("the fee box won't save a blank or negative fee, and asks before $0 or a fee more than double", async ({ page }) => {
  await signIn(page);
  await openDues(page);
  await page.getByRole('button', { name: 'Edit fee' }).click();
  const dialog = page.getByRole('dialog', { name: 'Session 2 fee' });
  const save = dialog.getByRole('button', { name: 'Save fee' });

  // Clearing a box to retype it doesn't save $0 by mistake.
  await dialog.getByLabel('League fee').fill('');
  await expect(dialog).toContainText('Enter the league fee.');
  await expect(save).toBeDisabled();
  await dialog.getByLabel('League fee').fill('-595');
  await expect(dialog).toContainText("A fee can't be below $0.");
  await expect(save).toBeDisabled();

  // A typo ten times the fee asks first; Go back changes nothing.
  await dialog.getByLabel('League fee').fill('7084');
  await save.click();
  await expect(dialog).toContainText("That's $7210, more than double the $721 it is now. Save it?");
  await dialog.getByRole('button', { name: 'Go back' }).click();
  await expect(save).toBeVisible();
  await dialog.getByLabel('League fee').fill('595');

  // A free session: $0 saves once it's confirmed.
  await dialog.getByLabel('League fee').fill('0');
  await dialog.getByLabel('Ref fee / game').fill('0');
  await save.click();
  await expect(dialog).toContainText('Set the session fee to $0? Nobody will owe anything.');
  await dialog.getByRole('button', { name: 'Set to $0' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('$0 session fee')).toBeVisible();
  await expect(page.getByText('$0 each')).toBeVisible();

  // Back to the real fee: from $0 there's nothing to double, so it saves straight away.
  await page.getByRole('button', { name: 'Edit fee' }).click();
  await dialog.getByLabel('League fee').fill('595');
  await dialog.getByLabel('Ref fee / game').fill('18');
  await save.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('$61 each')).toBeVisible();
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
  await expect(page.getByRole('link', { name: 'Pay $61 with Venmo' })).toHaveAttribute('href', /^https:\/\/venmo\.com\/Some-One\?/);
  await expect(page.getByRole('link', { name: 'Pay $61 with PayPal' })).toHaveAttribute('href', 'https://paypal.me/SomeOne/61');
});

test('a captain gives one player a custom amount, and the rest split what is left', async ({ page }) => {
  await signIn(page);
  await openDues(page);
  await page.getByRole('button', { name: 'Details for Kelly Moss' }).click();
  const sheet = page.getByRole('dialog', { name: 'Kelly Moss' });
  await duesOption(sheet, 'Set custom amount');
  await sheet.getByLabel('Custom amount').fill('40');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toContainText('$40 · custom amount');
  await sheet.getByRole('button', { name: 'History', exact: true }).click();
  await expect(sheet).toContainText('You gave Kelly M. a custom amount of $40');
  await page.keyboard.press('Escape');
  // $721 - $40 = $681 across the other 11: $61.91, rounded up.
  await expect(page.getByLabel('Amount for Casey Captain')).toHaveText('$62');

  await page.getByRole('button', { name: 'Details for Kelly Moss' }).click();
  await duesOption(sheet, 'Change custom amount');
  await sheet.getByRole('button', { name: 'Use the even split ($62) instead' }).click();
  await expect(sheet.getByTestId('player-sheet-amount')).toHaveText('$61');
  await sheet.getByRole('button', { name: 'History', exact: true }).click();
  await expect(sheet).toContainText('You put Kelly M. back on the even split');
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Amount for Casey Captain')).toHaveText('$61');
});

test('stepping between sessions, and setting a new session fee from the last one', async ({ page }) => {
  await signIn(page);
  await openDues(page);
  await page.getByRole('button', { name: 'Previous session' }).click();
  await expect(page.getByTestId('dues-session')).toHaveText('Session 1 · 2026–27');
  await expect(paidHeading(page, '12 of 12 paid')).toBeVisible();

  await page.getByRole('button', { name: 'Next session' }).click();
  await page.getByRole('button', { name: 'Next session' }).click();
  await expect(page.getByTestId('dues-session')).toHaveText('Session 3 · 2026–27');
  await expect(page.getByText('No fee yet')).toBeVisible();
  await page.getByRole('button', { name: 'Set the fee' }).click();
  const dialog = page.getByRole('dialog', { name: 'Session 3 fee' });
  await expect(dialog.getByLabel('League fee')).toHaveValue('595');
  await expect(dialog.getByLabel('Ref fee / game')).toHaveValue('18');
  await dialog.getByRole('button', { name: 'Save fee' }).click();
  await expect(paidHeading(page, '0 of 12 paid')).toBeVisible();
});

// Mike Russo and Dana Wells are on the roster but haven't joined the app: Dana has paid this session, Mike hasn't.
test('roster players who have not joined count in the split, and anyone can mark them paid', async ({ page }) => {
  await signIn(page, JORDAN);
  await openDues(page);
  await page.getByRole('tab', { name: 'Team dues' }).click();

  // Captains add players on the Team page; players don't get the link.
  await expect(page.getByRole('link', { name: /Add players to the roster on the Team page/ })).toHaveCount(0);
  await expect(page.getByTestId('dues-unpaid')).toContainText('Mike Russonot joined yet');
  await expect(page.getByTestId('dues-paid')).toContainText('Dana Wellsnot joined yet');

  await page.getByRole('button', { name: 'Mark paid for Mike Russo' }).click();
  await expect(paidHeading(page, '6 of 12 paid')).toBeVisible();
  await expect(page.getByTestId('dues-paid')).toContainText('not joined yet · marked by Jordan R.');
  await expect((await openSection(page, 'Recent changes'))).toContainText('You marked Mike R. paid');

  // A couple can be one who has joined and one who hasn't.
  await page.getByRole('button', { name: 'Details for Kelly Moss' }).click();
  const sheet = page.getByRole('dialog', { name: 'Kelly Moss' });
  await duesOption(sheet, 'Pay together');
  await sheet.getByLabel('Pays together with').selectOption({ label: 'Mike Russo' });
  await expect(page.getByText('Linked as paying together')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dues-paid')).toContainText('with Kelly M.');
});

test('the Dues page sends captains to the Team page to add players', async ({ page }) => {
  await signIn(page);
  await openDues(page);
  await page.getByRole('link', { name: /Add players to the roster on the Team page/ }).click();
  await expect(page.getByRole('heading', { name: 'Team', exact: true })).toBeVisible();

  await openDues(page);
  await page.getByRole('button', { name: 'Details for Mike Russo' }).click();
  const sheet = page.getByRole('dialog', { name: 'Mike Russo' });
  await expect(sheet).toContainText('not joined yet');
  await sheet.getByRole('button', { name: 'More options' }).click();
  await sheet.getByRole('link', { name: 'View on Team' }).click();
  await expect(page.getByRole('heading', { name: 'Team', exact: true })).toBeVisible();
});


test('marking paid has a compact sheet, and rare actions reveal only the chosen form', async ({ page }) => {
  await signIn(page);
  await openDues(page);
  await page.getByRole('button', { name: 'Details for Mike Russo' }).click();
  const sheet = page.getByRole('dialog', { name: 'Mike Russo' });
  await expect(sheet.getByTestId('player-sheet-amount')).toContainText('$61');
  await expect(sheet.getByRole('button', { name: 'Mark paid', exact: true })).toBeVisible();
  await expect(sheet.getByRole('combobox')).toHaveCount(0);
  await expect(sheet.getByRole('spinbutton')).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'History', exact: true })).toHaveCount(0);
  await expect(sheet).not.toContainText('No changes yet');
  await expect(sheet).not.toContainText('When they sign up');

  await duesOption(sheet, 'Set custom amount');
  await expect(sheet.getByLabel('Custom amount')).toBeVisible();
  await expect(sheet.getByRole('combobox')).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Mark paid', exact: true })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Back to options' }).click();
  await sheet.getByRole('button', { name: 'Pay together', exact: true }).click();
  await expect(sheet.getByLabel('Pays together with')).toBeVisible();
  await expect(sheet.getByLabel('Custom amount')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Back to options' }).click();
  await sheet.getByRole('button', { name: 'Record part payment' }).click();
  await expect(sheet.getByLabel('Amount paid', { exact: true })).toBeVisible();
  await expect(sheet.getByRole('combobox')).toHaveCount(0);

  // A waived share still has a paid/not-paid record.
  await sheet.getByRole('button', { name: 'Back to options' }).click();
  await sheet.getByRole('button', { name: 'Set custom amount' }).click();
  await sheet.getByLabel('Custom amount').fill('0');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet.getByTestId('player-sheet-amount')).toContainText('$0');
  await sheet.getByRole('button', { name: 'Mark paid', exact: true }).click();
  await expect(sheet).toContainText('Paid in full Oct 8');
});
