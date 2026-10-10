// The Dues page: everyone sees what they owe and the team's dues, and anyone
// can mark players paid; couples pay together; captains set the fee, custom
// amounts and payment details. The database enforces who can change what
// (supabase/tests/dues.test.sql).
import { expect, signIn, test } from './helpers';

// Alex Chen and Riley Novak are a couple who pay together and haven't paid this session in the sample data.
const ALEX = 'alex@demo.test';
const JORDAN = 'jordan@demo.test'; // paid, and marked it herself

async function openDues(page) {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('link', { name: 'Dues' }).click();
  await expect(page.getByRole('heading', { name: 'Dues', exact: true })).toBeVisible();
}

test('a player sees what they owe, how it adds up, and pays for themselves and their partner', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page, ALEX);
  await openDues(page);

  const card = page.getByTestId('my-dues');
  await expect(card).toContainText('$146');
  await expect(card).toContainText('For you and Riley Novak ($73 each)');
  await expect(card).toContainText('Unpaid');
  await expect(card).toContainText('League fee$595');
  await expect(card).toContainText('Refs (7 games × $18)$126');
  await expect(card).toContainText('Session total$721');
  await expect(card).toContainText('Split evenly across 10 active players');

  const venmo = page.getByRole('link', { name: /Pay \$146 with Venmo/ });
  await expect(venmo).toHaveAttribute(
    'href',
    'https://venmo.com/Casey-Captain-Demo?txn=pay&audience=private&amount=146&note=Jive%20Turkeys%20dues%20%C2%B7%20Session%202%202026%20%C2%B7%20Alex%20Chen%20%26%20Riley%20Novak',
  );
  await expect(page.getByRole('link', { name: /Pay \$146 with Cash App/ })).toHaveAttribute('href', 'https://cash.app/$CaseyCaptainDemo/146');
  await page.getByRole('button', { name: 'Copy Zelle details' }).click();
  await expect(page.getByText('Copied', { exact: true })).toBeVisible();
  await expect(card).toContainText('Cash to Casey at the field works too.');
  await expect(page.getByText('Earlier sessions')).toBeVisible();

  // After paying, they mark it themselves (and their partner with them).
  await page.getByRole('button', { name: 'Mark us paid' }).click();
  await expect(card).toContainText('Paid · Oct 8');
  await expect(card).toContainText("You're both paid up. Thanks!");
  await expect(card).toContainText('Marked paid Oct 8 by you.');
  await expect(page.getByRole('link', { name: /with Venmo/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Team dues' }).click();
  await expect(page.getByTestId('dues-paid')).toContainText('Alex Chen');
  await expect(page.getByTestId('dues-paid')).toContainText('Riley Novak');

  // A mistake is one tap to undo.
  await page.getByRole('button', { name: 'My dues' }).click();
  await page.getByRole('button', { name: 'Not paid yet? Undo' }).click();
  await expect(card).toContainText('Unpaid');
  await expect(page.getByRole('button', { name: 'Mark us paid' })).toBeVisible();
});

test('a player who has paid sees a thank-you instead of pay buttons', async ({ page }) => {
  await signIn(page, JORDAN);
  await openDues(page);
  await expect(page.getByTestId('my-dues')).toContainText(/Paid · \w{3} \d+/);
  await expect(page.getByText("You're all paid up. Thanks!")).toBeVisible();
  await expect(page.getByText(/Marked paid \w{3} \d+ by you\./)).toBeVisible();
  await expect(page.getByRole('link', { name: /with Venmo/ })).toHaveCount(0);
});

test("a player can mark teammates paid and link a couple, but can't change the fee or amounts", async ({ page }) => {
  await signIn(page, JORDAN);
  await openDues(page);
  await page.getByRole('button', { name: 'Team dues' }).click();

  await expect(page.getByRole('heading', { name: '5 of 10 paid' })).toBeVisible();
  await expect(page.getByText('$595 + 7 × $18 = $721')).toBeVisible();
  await expect(page.getByLabel('League fee')).toHaveCount(0);
  await expect(page.getByLabel('Amount for Kelly Moss')).toHaveText('$73');
  await expect(page.getByText('How players pay')).toHaveCount(0);

  await page.getByRole('button', { name: 'Kelly Moss: unpaid' }).click();
  await expect(page.getByRole('heading', { name: '6 of 10 paid' })).toBeVisible();
  await expect(page.getByTestId('dues-paid')).toContainText('Kelly Moss');
  await expect(page.getByTestId('dues-paid')).toContainText(/paid Oct 8 · by Jordan R\./i);

  // Marking one of a couple marks both.
  await page.getByRole('button', { name: 'Riley Novak: unpaid' }).click();
  await expect(page.getByRole('heading', { name: '8 of 10 paid' })).toBeVisible();

  await page.getByLabel('First player').selectOption({ label: 'Chris Dunn' });
  await page.getByLabel('Second player').selectOption({ label: 'Kelly Moss' });
  await page.getByRole('button', { name: 'Link as paying together' }).click();
  await expect(page.getByText('Chris Dunn & Kelly Moss')).toBeVisible();
  await expect(page.getByTestId('dues-unpaid')).toContainText(/with Kelly M\./i);
});

test('a captain sets the fee, marks a payment and copies a reminder', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page);
  await openDues(page);

  // Opens on this session, with the fee already saved: $595 + 7 × $18.
  await expect(page.getByLabel('League fee')).toHaveValue('595');
  await expect(page.getByLabel('Ref fee / game')).toHaveValue('18');
  await expect(page.getByLabel('Games')).toHaveValue('7');
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();
  await expect(page.getByRole('heading', { name: '5 of 10 paid' })).toBeVisible();
  await expect(page.getByText('Rounding up collects $9 more than the $721 fee.')).toBeVisible();

  // Unpaid players come first, couples side by side; marking one paid moves them down.
  await expect(page.getByTestId('dues-unpaid')).toContainText(/Alex Chen.*Riley Novak.*Casey Captain/);
  await page.getByRole('button', { name: 'Kelly Moss: unpaid' }).click();
  await expect(page.getByRole('heading', { name: '6 of 10 paid' })).toBeVisible();
  await expect(page.getByTestId('dues-paid')).toContainText('Kelly Moss');

  await page.getByRole('button', { name: 'Copy reminder for 4 unpaid' }).click();
  await expect(page.getByText('Reminder copied')).toBeVisible();
  const reminder = await page.evaluate(() => navigator.clipboard.readText());
  expect(reminder).toContain('Session 2 dues: $73 each');
  expect(reminder).toContain("That's the $595 league fee plus $18 refs × 7 games = $721, split across 10 players.");
  expect(reminder).toContain('Still to pay: Alex Chen & Riley Novak ($146), Casey Captain, Chris Dunn');
  expect(reminder).not.toContain('Kelly Moss');

  // A new ref fee isn't shown to players until it's saved.
  await page.getByLabel('Ref fee / game').fill('20');
  await expect(page.getByText('Changes not saved. Players still see the $721 fee.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy reminder for 4 unpaid' })).toBeDisabled();
  await page.getByRole('button', { name: 'Save fee' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
  await expect(page.getByText('Rounding up collects $5 more than the $735 fee.')).toBeVisible();

  // What players see, from the captain's own account.
  await page.getByRole('button', { name: 'My dues' }).click();
  await expect(page.getByTestId('my-dues')).toContainText('$74');
  await expect(page.getByTestId('my-dues')).toContainText('Refs (7 games × $20)$140');
});

test('a captain changes how players pay, and players see it', async ({ page }) => {
  await signIn(page);
  await openDues(page);
  await page.getByLabel('Venmo username').fill('@Brian-Pays');
  await page.getByLabel('Cash App $cashtag').fill('');
  await page.getByRole('button', { name: 'Save payment details' }).click();
  await expect(page.getByText('Payment details saved')).toBeVisible();

  await page.getByRole('button', { name: 'My dues' }).click();
  await expect(page.getByRole('link', { name: /with Venmo/ })).toHaveAttribute('href', /^https:\/\/venmo\.com\/Brian-Pays\?/);
  await expect(page.getByRole('link', { name: /with Cash App/ })).toHaveCount(0);
});

test('a captain gives one player a custom amount, and the rest split what is left', async ({ page }) => {
  await signIn(page);
  await openDues(page);
  const amount = page.getByLabel('Amount for Kelly Moss');
  await amount.fill('');
  await amount.blur();
  await expect(amount).toHaveValue('73');

  await amount.fill('40');
  await amount.blur();
  // $721 - $40 = $681 across the other 9: $75.67, rounded up.
  await expect(page.getByLabel('Amount for Casey Captain')).toHaveValue('76');
  await expect(page.getByText('1 custom amount.')).toBeVisible();

  // Typing the even split back in puts her back on it.
  await amount.fill('76');
  await amount.blur();
  await expect(page.getByLabel('Amount for Casey Captain')).toHaveValue('73');
  await expect(page.getByText('custom amount')).toHaveCount(0);
});
