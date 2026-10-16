// Threads: the room list (where the chat starts on phones), New, and starting,
// renaming, closing, reopening and deleting a thread. See docs/chat.md for the
// expected behavior.
import {
  chatTab,
  composer,
  expect,
  expectChatStart,
  isPhone,
  message,
  openChat,
  openRoom,
  openTeamChat,
  roomRow,
  send,
  showRooms,
  signIn,
  startNew,
  test,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await openChat(page);
});

test('the room list shows Team Chat first, then every other room in one list by latest activity', async ({ page }) => {
  await showRooms(page);
  const rooms = page.locator('[data-room]:visible');
  await expect(rooms).toHaveCount(6);
  await expect(rooms.nth(0)).toContainText('Team Chat');
  await expect(rooms.nth(1)).toContainText('Sunday pickup?');
  await expect(rooms.nth(2)).toContainText("Captains' Lounge");
  await expect(rooms.nth(3)).toContainText('Fantasy football league');
  await expect(rooms.nth(4)).toContainText('Jordan R.'); // Casey's private chat with Jordan, named after them
  await expect(rooms.nth(4).getByLabel('Private')).toBeVisible();
  await expect(rooms.nth(5)).toContainText('Post-game food spot');
  // Previews show who said what last.
  await expect(rooms.nth(1)).toContainText("Riley N.: Can't this week");
  // No sections: threads and private chats share the list.
  await expect(page.getByText('Private chats', { exact: true })).toHaveCount(0);
});

test('threads show unread counts, and New for ones never opened', async ({ page }) => {
  await showRooms(page);
  await expect(roomRow(page, 'Sunday pickup?').getByLabel('3 unread')).toBeVisible();
  await expect(roomRow(page, 'Fantasy football league')).toContainText('New');
  await expect(roomRow(page, 'Fantasy football league').getByLabel(/unread/)).toHaveCount(0);
  await expect(roomRow(page, 'Post-game food spot')).not.toContainText('New');
  await expect(roomRow(page, 'Post-game food spot').getByLabel(/unread/)).toHaveCount(0);
});

test("on phones, the back arrow counts what's waiting in the other rooms, mentions of you first", async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo), 'phones only; computers show the list beside the chat');
  const back = page.getByRole('button', { name: 'All chats' });
  // In Team Chat: the fantasy thread (never opened) mentions you, which shows in place of the unread number.
  await expect(back.getByLabel('1 mention')).toBeVisible();
  await expect(back.getByLabel(/unread/)).toHaveCount(0);
  await openRoom(page, 'Fantasy football league');
  await expect(message(page, 'Count me in')).toBeVisible();
  await openTeamChat(page);
  // Sunday pickup's 3, now that the mention is read.
  await expect(back.getByLabel('3 unread')).toBeVisible();
  await expect(back.getByLabel(/mention/)).toHaveCount(0);
  await openRoom(page, 'Sunday pickup?');
  await expect(message(page, "Can't this week")).toBeVisible();
  await expect(back.getByLabel(/unread|mention/)).toHaveCount(0);
});

test('opening a thread clears its unread count and New label', async ({ page }) => {
  await openRoom(page, 'Fantasy football league');
  await expect(message(page, 'Count me in')).toBeVisible();
  await openRoom(page, 'Sunday pickup?');
  await expect(page.getByText('New messages', { exact: true })).toBeVisible();
  await openTeamChat(page);
  await showRooms(page);
  await expect(roomRow(page, 'Fantasy football league')).not.toContainText('New');
  await expect(roomRow(page, 'Sunday pickup?').getByLabel(/unread/)).toHaveCount(0);
});

test('closed threads are tucked away and read-only', async ({ page }) => {
  await showRooms(page);
  const closed = page.getByRole('button', { name: /Closed \(1\)/ });
  await expect(page.locator('[data-room]:visible', { hasText: 'Jersey order' })).toHaveCount(0);
  await closed.click();
  await roomRow(page, 'Jersey order').click();
  await expect(page.getByText('This thread is closed.')).toBeVisible();
  await expect(composer(page)).toHaveCount(0);
  await expect(message(page, 'Order placed, thanks all.')).toBeVisible();
});

test('New asks whether it is a thread for everyone or a private chat', async ({ page }) => {
  await startNew(page, 'private');
  await expect(page.getByRole('dialog', { name: 'New private chat' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await startNew(page, 'thread');
  await expect(page.getByRole('dialog', { name: 'New thread' })).toBeVisible();
});

test('start a thread, rename it, close it, reopen it and delete it', async ({ page }) => {
  await startNew(page, 'thread');
  const dialog = page.getByRole('dialog', { name: 'New thread' });
  await expect(dialog.getByRole('button', { name: 'Start thread' })).toBeDisabled();
  await dialog.locator('#thread-title').fill('🚗 Carpool Thursday');
  await dialog.locator('#thread-first').fill('Leaving at 6:15, room for 3');
  await dialog.getByRole('button', { name: 'Start thread' }).click();

  await expect(page.getByRole('heading', { name: 'Carpool Thursday' })).toBeVisible();
  await expect(page.getByText('Started by you')).toBeVisible();
  await expect(message(page, 'Leaving at 6:15, room for 3')).toBeVisible();
  await send(page, 'Anyone else?');

  // Rename
  await page.getByRole('button', { name: 'Chat options' }).click();
  await page.getByRole('button', { name: 'Rename' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename thread' });
  await expect(rename.locator('#thread-title')).toHaveValue('🚗 Carpool Thursday');
  await rename.locator('#thread-title').fill('🚗 Carpool Friday');
  await rename.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Carpool Friday' })).toBeVisible();

  // Close, then reopen
  await page.getByRole('button', { name: 'Chat options' }).click();
  await page.getByRole('button', { name: 'Close thread' }).click();
  await expect(page.getByText('This thread is closed.')).toBeVisible();
  await expect(composer(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Reopen' }).click();
  await expect(composer(page)).toBeVisible();

  // The thread and its messages survive a reload.
  await page.reload();
  await expect(message(page, 'Anyone else?')).toBeVisible();

  // Delete
  await page.getByRole('button', { name: 'Chat options' }).click();
  await page.getByRole('button', { name: 'Delete thread' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete thread?' });
  await expect(confirm).toContainText('all its messages will be removed for everyone');
  await confirm.getByRole('button', { name: 'Delete' }).click();
  // Back to the room list on phones, Team Chat on computers.
  await expectChatStart(page);
  await expect(roomRow(page, 'Carpool')).toHaveCount(0);
  // Team Chat is untouched.
  await openTeamChat(page);
  await expect(message(page, 'Paid 💸')).toBeVisible();
});

test('a thread link for a deleted thread says so', async ({ page }) => {
  await page.goto('/banter?thread=00000000-0000-4000-8000-000000000000');
  await expect(page.getByText("This thread isn't here anymore.")).toBeVisible();
  await page.getByRole('button', { name: 'Go to Team Chat' }).click();
  await expect(page.getByRole('heading', { name: 'Team Chat' })).toBeVisible();
});

test('closing a thread can be undone from the closed list', async ({ page }) => {
  await openRoom(page, 'Post-game food spot');
  await page.getByRole('button', { name: 'Chat options' }).click();
  await page.getByRole('button', { name: 'Close thread' }).click();
  await showRooms(page);
  await expect(page.getByRole('button', { name: /Closed \(2\)/ })).toBeVisible();
  await page.getByRole('button', { name: /Closed \(2\)/ }).click();
  await roomRow(page, 'Post-game food spot').click();
  await page.getByRole('button', { name: 'Reopen' }).click();
  await showRooms(page);
  await expect(page.getByRole('button', { name: /Closed \(1\)/ })).toBeVisible();
});

test('messages stay in their own room', async ({ page }) => {
  await openRoom(page, 'Sunday pickup?');
  await send(page, 'Only in the pickup thread');
  await openTeamChat(page);
  await expect(message(page, 'Paid 💸')).toBeVisible();
  await expect(message(page, 'Only in the pickup thread')).toHaveCount(0);
});

test('an unsent message waits in its room while you look at another', async ({ page }) => {
  await composer(page).fill('Half-typed thought');
  await openRoom(page, 'Sunday pickup?');
  await expect(composer(page)).toHaveValue('');
  await openTeamChat(page);
  await expect(composer(page)).toHaveValue('Half-typed thought');
});

test('with no threads or private chats yet, the list says how to start one', async ({ page }) => {
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('jt_demo_db_'));
    const db = JSON.parse(localStorage.getItem(key));
    db.chat_threads = db.chat_threads.filter((t) => t.visibility === 'captains');
    db.messages = db.messages.filter((m) => !m.thread_id || db.chat_threads.some((t) => t.id === m.thread_id));
    localStorage.setItem(key, JSON.stringify(db));
  });
  await page.reload();
  await showRooms(page);
  await expect(page.locator('[data-room]:visible')).toHaveCount(2); // Team Chat and the Lounge
  await expect(page.getByText(/Tap New for a thread the whole team can join/)).toBeVisible();
});

test.describe('on phones', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!isPhone(testInfo), 'phones only; computers show the list beside the chat');
  });

  test('Chat opens on the room list; a room fills the screen, and ‹ goes back to the list', async ({ page }) => {
    await chatTab(page).click();
    await expectChatStart(page);
    await expect(page).toHaveURL(/\/banter$/);
    await roomRow(page, 'Fantasy football league').click();
    await expect(page.getByRole('heading', { name: 'Fantasy football league' })).toBeVisible();
    await expect(page.locator('[data-room="team"]')).toBeHidden();
    // Search and notifications are on the list, not in each room.
    await expect(page.getByRole('button', { name: 'Search the chat' })).toBeHidden();
    await page.getByRole('button', { name: 'All chats' }).click();
    await expectChatStart(page);
    await expect(page).toHaveURL(/\/banter$/);

    // The phone's own back button does the same.
    await roomRow(page, 'Sunday pickup?').click();
    await expect(page.getByRole('heading', { name: 'Sunday pickup?' })).toBeVisible();
    await page.goBack();
    await expectChatStart(page);
  });

  test('Team Chat has its own address (what its notifications open), and ‹ from there shows the list', async ({ page }) => {
    await page.goto('/banter?room=team');
    await expect(page.getByRole('heading', { name: 'Team Chat' })).toBeVisible();
    await expect(message(page, 'Paid 💸')).toBeVisible();
    await page.getByRole('button', { name: 'All chats' }).click();
    await expectChatStart(page);
    await expect(page).toHaveURL(/\/banter$/);
  });

  test('a new thread opens full screen, and ‹ goes back to the list', async ({ page }) => {
    await startNew(page, 'thread');
    const dialog = page.getByRole('dialog', { name: 'New thread' });
    await dialog.locator('#thread-title').fill('🚗 Carpool');
    await dialog.getByRole('button', { name: 'Start thread' }).click();
    await expect(page.getByRole('heading', { name: 'Carpool' })).toBeVisible();
    await page.getByRole('button', { name: 'All chats' }).click();
    await expectChatStart(page);
    // The newest room, right under Team Chat.
    await expect(page.locator('[data-room]:visible').nth(1)).toContainText('Carpool');
  });
});
