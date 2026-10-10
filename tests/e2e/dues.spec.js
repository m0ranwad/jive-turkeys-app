// The Dues page: players see their own share and pay buttons; captains set
// the fee, track payments and copy a reminder. The database keeps each
// player's view to their own share (supabase/tests/dues.test.sql).
import { expect, signIn, test } from './helpers';

const UNPAID_PLAYER = 'alex@demo.test'; // Alex Chen: active, hasn't paid this session in the sample data

async function openDues(page) {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('link', { name: 'Dues' }).click();
  await expect(page.getByRole('heading', { name: 'Dues', exact: true })).toBeVisible();
}

test('a player sees their share, how it adds up, and pay buttons with the amount filled in', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page, UNPAID_PLAYER);
  await openDues(page);

  const card = page.getByTestId('my-dues');
  await expect(card).toContainText('$73');
  await expect(card).toContainText('Unpaid');
  await expect(card).toContainText('League fee$595');
  await expect(card).toContainText('Refs (7 games × $18)$126');
  await expect(card).toContainText('Session total$721');
  await expect(card).toContainText('Split evenly across 10 active players');

  const venmo = page.getByRole('link', { name: /Pay \$73 with Venmo/ });
  await expect(venmo).toHaveAttribute('href', /^https:\/\/venmo\.com\/Casey-Captain-Demo\?txn=pay&audience=private&amount=73&note=/);
  await expect(page.getByRole('link', { name: /Pay \$73 with Cash App/ })).toHaveAttribute('href', 'https://cash.app/$CaseyCaptainDemo/73');
  await page.getByRole('button', { name: 'Copy Zelle details' }).click();
  await expect(page.getByText('Copied', { exact: true })).toBeVisible();
  await expect(card).toContainText('Cash to Casey at the field works too.');

  // Earlier sessions, and nothing about anyone else.
  await expect(page.getByText('Earlier sessions')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Team dues' })).toHaveCount(0);
  await expect(page.getByText('Jordan Rivera')).toHaveCount(0);
});

test('a player who has paid sees a thank-you instead of pay buttons', async ({ page }) => {
  await signIn(page, 'jordan@demo.test');
  await openDues(page);
  await expect(page.getByTestId('my-dues')).toContainText(/Paid · \w{3} \d+/);
  await expect(page.getByText("You're all paid up. Thanks!")).toBeVisible();
  await expect(page.getByRole('link', { name: /with Venmo/ })).toHaveCount(0);
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

  // Unpaid players come first; marking one paid moves them down.
  await expect(page.getByTestId('dues-unpaid')).toContainText('Alex Chen');
  await page.getByRole('button', { name: 'Alex Chen: unpaid' }).click();
  await expect(page.getByRole('heading', { name: '6 of 10 paid' })).toBeVisible();
  await expect(page.getByTestId('dues-paid')).toContainText('Alex Chen');

  await page.getByRole('button', { name: 'Copy reminder for 4 unpaid' }).click();
  await expect(page.getByText('Reminder copied')).toBeVisible();
  const reminder = await page.evaluate(() => navigator.clipboard.readText());
  expect(reminder).toContain('Session 2 dues: $73 each');
  expect(reminder).toContain("That's the $595 league fee plus $18 refs × 7 games = $721, split across 10 players.");
  expect(reminder).toContain('Still to pay: Casey Captain, Chris Dunn, Kelly Moss, Riley Novak');
  expect(reminder).not.toContain('Alex Chen');

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
  await expect(page.getByLabel('Amount for Alex Chen')).toHaveValue('76');
  await expect(page.getByText('That covers')).toHaveCount(0);
  await expect(page.getByText('1 custom amount.')).toBeVisible();

  // Typing the even split back in puts her back on it.
  await amount.fill('76');
  await amount.blur();
  await expect(page.getByLabel('Amount for Alex Chen')).toHaveValue('73');
  await expect(page.getByText('custom amount')).toHaveCount(0);
});
