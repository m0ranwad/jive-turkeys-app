// What a regular player can and can't do, compared with a captain.
// The database enforces these rules too (supabase/tests/chat.test.sql).
import {
  PLAYER,
  composer,
  expect,
  message,
  messageRow,
  openChat,
  openRoom,
  roomRow,
  send,
  showRooms,
  signIn,
  tapMessage,
  test,
} from './helpers';

test.describe('a regular player', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, PLAYER);
    await openChat(page);
  });

  test("can react to and reply to anyone's message, but only delete their own", async ({ page }) => {
    await tapMessage(page, 'Running 10 min late');
    await expect(page.getByRole('button', { name: 'Reply' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'React 👍' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);

    await tapMessage(page, 'Who is bringing the pinnies this week?');
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();
  });

  test("can't rename, close or delete someone else's thread", async ({ page }) => {
    await openRoom(page, 'Sunday pickup?');
    await expect(page.getByText('Started by Sam O.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Thread options' })).toHaveCount(0);
    await send(page, 'Count me in too');
  });

  test("can't reopen a captain's closed thread", async ({ page }) => {
    await showRooms(page);
    await page.getByRole('button', { name: /Closed \(1\)/ }).click();
    await roomRow(page, 'Jersey order').click();
    await expect(page.getByText('This thread is closed.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reopen' })).toHaveCount(0);
    await expect(composer(page)).toHaveCount(0);
  });

  test('manages threads they start', async ({ page }) => {
    await showRooms(page);
    await page.getByRole('button', { name: 'New thread' }).click();
    await page.locator('#thread-title').fill('Rides from Akron');
    await page.getByRole('button', { name: 'Start thread' }).click();
    await expect(page.getByText('Started by you')).toBeVisible();
    await expect(page.getByText('Nothing here yet. Say something to get it going.')).toBeVisible();
    await page.getByRole('button', { name: 'Thread options' }).click();
    await expect(page.getByRole('button', { name: 'Delete thread' })).toBeVisible();
  });

  test('sees captains marked in the chat', async ({ page }) => {
    // Casey is a captain: their messages show the name with a Capt tag.
    const row = messageRow(page, 'Reminder: dues for session 2');
    await expect(row).toContainText('Casey C.');
    await expect(row).toContainText('Capt');
    await expect(messageRow(page, 'Running 10 min late')).not.toContainText('Capt');
  });
});

test.describe('a captain', () => {
  test("can delete anyone's message and manage anyone's thread", async ({ page }) => {
    await signIn(page);
    await openChat(page);
    await tapMessage(page, 'Running 10 min late');
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();
    await openRoom(page, 'Sunday pickup?');
    await page.getByRole('button', { name: 'Thread options' }).click();
    await expect(page.getByRole('button', { name: 'Rename' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close thread' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete thread' })).toBeVisible();
    await expect(message(page, 'Totally, the more the merrier')).toBeVisible();
  });
});
