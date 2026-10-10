// Threads: the room list, and starting, renaming, closing, reopening and
// deleting a thread. See docs/chat.md for the expected behavior.
import {
  composer,
  expect,
  goToSchedule,
  isPhone,
  message,
  openChat,
  openRoom,
  openTeamChat,
  roomRow,
  send,
  showRooms,
  signIn,
  test,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await openChat(page);
});

test('the room list shows Team Chat first, then threads by latest activity', async ({ page }) => {
  await showRooms(page);
  const rooms = page.locator('[data-room]:visible');
  await expect(rooms).toHaveCount(4);
  await expect(rooms.nth(0)).toContainText('Team Chat');
  await expect(rooms.nth(1)).toContainText('Sunday pickup?');
  await expect(rooms.nth(2)).toContainText('Fantasy football league');
  await expect(rooms.nth(3)).toContainText('Post-game food spot');
  // Previews show who said what last.
  await expect(rooms.nth(1)).toContainText("Riley N.: Can't this week");
});

test('threads show unread counts, and New for ones never opened', async ({ page }) => {
  await showRooms(page);
  await expect(roomRow(page, 'Sunday pickup?').getByLabel('3 unread')).toBeVisible();
  await expect(roomRow(page, 'Fantasy football league')).toContainText('New');
  await expect(roomRow(page, 'Fantasy football league').getByLabel(/unread/)).toHaveCount(0);
  await expect(roomRow(page, 'Post-game food spot')).not.toContainText('New');
  await expect(roomRow(page, 'Post-game food spot').getByLabel(/unread/)).toHaveCount(0);
});

test('the Threads button on phones counts unread in threads you follow', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo), 'phones only; computers show the list beside the chat');
  await expect(page.getByRole('button', { name: /^Threads/ }).getByLabel('3 unread')).toBeVisible();
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

test('start a thread, rename it, close it, reopen it and delete it', async ({ page }) => {
  await showRooms(page);
  await page.getByRole('button', { name: 'New thread' }).click();
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
  await page.getByRole('button', { name: 'Thread options' }).click();
  await page.getByRole('button', { name: 'Rename' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename thread' });
  await expect(rename.locator('#thread-title')).toHaveValue('🚗 Carpool Thursday');
  await rename.locator('#thread-title').fill('🚗 Carpool Friday');
  await rename.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Carpool Friday' })).toBeVisible();

  // Close, then reopen
  await page.getByRole('button', { name: 'Thread options' }).click();
  await page.getByRole('button', { name: 'Close thread' }).click();
  await expect(page.getByText('This thread is closed.')).toBeVisible();
  await expect(composer(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Reopen' }).click();
  await expect(composer(page)).toBeVisible();

  // The thread and its messages survive a reload.
  await page.reload();
  await expect(message(page, 'Anyone else?')).toBeVisible();

  // Delete
  await page.getByRole('button', { name: 'Thread options' }).click();
  await page.getByRole('button', { name: 'Delete thread' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete thread?' });
  await expect(confirm).toContainText('all its messages will be removed for everyone');
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('heading', { name: 'Team Chat' })).toBeVisible();
  await showRooms(page);
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
  await page.getByRole('button', { name: 'Thread options' }).click();
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

test.describe('the thread row on phones', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!isPhone(testInfo), 'phones only; computers show the list beside the chat');
  });

  const chips = (page) => page.getByRole('navigation', { name: 'Rooms' });

  test('shows Team Chat, then open threads by latest activity, with unread counts', async ({ page }) => {
    const row = chips(page);
    await expect(row).toBeVisible();
    const rooms = row.locator('[data-strip-room]');
    await expect(rooms).toHaveCount(4);
    await expect(rooms.nth(0)).toHaveText(/Team Chat/);
    await expect(rooms.nth(0)).toHaveAttribute('aria-current', 'page');
    await expect(rooms.nth(1)).toContainText('Sunday pickup?');
    await expect(rooms.nth(1).getByLabel('3 unread')).toBeVisible();
    await expect(rooms.nth(2)).toContainText('Fantasy football league');
    await expect(rooms.nth(2).getByLabel('New')).toBeVisible();
    await expect(rooms.nth(3)).toContainText('Post-game food spot');
    // Closed threads stay in the full list only.
    await expect(row).not.toContainText('Jersey order');
  });

  test('tapping a thread opens it, and Team Chat is one tap back', async ({ page }) => {
    await chips(page).locator('[data-strip-room]', { hasText: 'Fantasy football league' }).click();
    await expect(page.getByRole('heading', { name: 'Fantasy football league' })).toBeVisible();
    await expect(message(page, 'Count me in')).toBeVisible();
    const current = chips(page).locator('[aria-current="page"]');
    await expect(current).toContainText('Fantasy football league');
    await expect(current).toBeInViewport();
    await expect(chips(page).locator('[data-strip-room]', { hasText: 'Fantasy football league' }).getByLabel('New')).toHaveCount(
      0,
    );

    await chips(page).locator('[data-strip-room="team"]').click();
    await expect(page.getByRole('heading', { name: 'Team Chat' })).toBeVisible();
  });

  test('New in the row starts a thread', async ({ page }) => {
    await chips(page).getByRole('button', { name: 'New thread' }).click();
    const dialog = page.getByRole('dialog', { name: 'New thread' });
    await dialog.locator('#thread-title').fill('🚗 Carpool');
    await dialog.getByRole('button', { name: 'Start thread' }).click();
    await expect(page.getByRole('heading', { name: 'Carpool' })).toBeVisible();
    await expect(chips(page).locator('[aria-current="page"]')).toContainText('Carpool');
  });

  test('says "Start a thread" when there are none yet', async ({ page }) => {
    await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('jt_demo_db_v3'));
      db.chat_threads = [];
      db.messages = db.messages.filter((m) => !m.thread_id);
      localStorage.setItem('jt_demo_db_v3', JSON.stringify(db));
    });
    await page.reload();
    await expect(chips(page).getByRole('button', { name: 'New thread' })).toHaveText(/Start a thread/);
  });

  test('steps aside while typing, so the keyboard has room', async ({ page }) => {
    // Stand in for the iPhone keyboard (see phone-keyboard.spec.js).
    await page.evaluate(() => {
      const fake = new EventTarget();
      Object.assign(fake, { width: innerWidth, height: innerHeight, offsetTop: 0, offsetLeft: 0, scale: 1 });
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: fake });
      window.keyboard = (height) => {
        fake.height = innerHeight - height;
        fake.dispatchEvent(new Event('resize'));
      };
    });
    // Reopen the chat in-app so it picks up the stand-in (a reload would remove it).
    await goToSchedule(page);
    await openChat(page);
    await composer(page).click();
    await page.evaluate(() => window.keyboard(330));
    await expect(chips(page)).toHaveCount(0);
    await composer(page).blur();
    await page.evaluate(() => window.keyboard(0));
    await expect(chips(page)).toBeVisible();
  });
});
