// Editing your own chat messages: the text changes for everyone with an
// "edited" label. Only your own, and not in a closed thread. The database
// rules are in supabase/tests/chat.test.sql; docs/chat.md lists them.
import { composer, expect, messageRow, openChat, send, signIn, tapMessage, test } from './helpers';

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await openChat(page);
});

test('fix a typo in your own message', async ({ page }) => {
  await send(page, 'See you at 7:15 on feild 3');
  await tapMessage(page, 'See you at 7:15 on feild 3');
  await messageRow(page, 'See you at 7:15 on feild 3').getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByText('Editing message')).toBeVisible();
  await expect(composer(page)).toHaveValue('See you at 7:15 on feild 3');
  await composer(page).fill('See you at 7:15 on field 3');
  await page.getByRole('button', { name: 'Save edit' }).click();

  const row = messageRow(page, 'See you at 7:15 on field 3');
  await expect(row).toContainText('edited');
  await expect(messageRow(page, 'feild')).toHaveCount(0);
  await expect(page.getByText('Editing message')).toHaveCount(0);
  await expect(composer(page)).toHaveValue('');
  await page.reload();
  await expect(messageRow(page, 'See you at 7:15 on field 3')).toContainText('edited');
});

test("there's no Edit on other people's messages", async ({ page }) => {
  await tapMessage(page, 'Paid 💸');
  const row = messageRow(page, 'Paid 💸');
  await expect(row.getByRole('button', { name: 'Reply' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
});

test('cancelling an edit changes nothing and brings back what you were typing', async ({ page }) => {
  await composer(page).fill('half a thought');
  await tapMessage(page, 'Reminder: dues for session 2 are due before the first game!');
  await messageRow(page, 'Reminder: dues for session 2').getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(composer(page)).toHaveValue('Reminder: dues for session 2 are due before the first game!');
  await page.getByRole('button', { name: 'Cancel edit' }).click();
  await expect(composer(page)).toHaveValue('half a thought');
  await expect(messageRow(page, 'Reminder: dues for session 2')).not.toContainText('edited');
});

test('a message edited earlier says so', async ({ page }) => {
  await expect(messageRow(page, 'Running 10 min late')).toContainText('edited');
});
