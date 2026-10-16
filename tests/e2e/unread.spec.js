// The unread badge on the Chat tab. See docs/chat.md for the expected behavior.
import {
  chatBadge,
  chatTab,
  expect,
  goToSchedule,
  iconBadge,
  message,
  openChat,
  openRoom,
  recordIconBadge,
  send,
  signIn,
  test,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await recordIconBadge(page);
  await signIn(page);
});

test('the Chat tab counts Team Chat plus threads you follow, and clears as you read', async ({ page }) => {
  // 3 new in Team Chat + 3 in Sunday pickup. The never-opened fantasy thread doesn't count.
  await expect(chatBadge(page)).toHaveText('6');

  await openChat(page);
  await expect(chatBadge(page), 'no badge while you are in the chat').toHaveCount(0);
  await expect(message(page, '🔥🔥🔥')).toBeVisible();

  await goToSchedule(page);
  await expect(chatBadge(page)).toHaveText('3');

  await openChat(page);
  await openRoom(page, 'Sunday pickup?');
  await expect(message(page, "Can't this week")).toBeVisible();
  await goToSchedule(page);
  await expect(chatBadge(page)).toHaveCount(0);
  // And it's saved, not just on screen.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  await expect(chatTab(page)).toBeVisible();
  await expect(chatBadge(page)).toHaveCount(0);
});

test('your own messages never count as unread', async ({ page }) => {
  await openChat(page);
  await send(page, 'Talking to myself');
  await goToSchedule(page);
  await expect(chatBadge(page)).toHaveText('3');
});

test('the app icon (Home Screen app) shows the same number, and clears as you read', async ({ page }) => {
  await expect.poll(() => iconBadge(page)).toBe(6);
  await openChat(page);
  await expect(message(page, '🔥🔥🔥')).toBeVisible();
  await expect.poll(() => iconBadge(page)).toBe(3);
  await openRoom(page, 'Sunday pickup?');
  await expect(message(page, "Can't this week")).toBeVisible();
  await expect.poll(() => iconBadge(page)).toBe(0);
});

test('the menu shows the same count, and its Team Chat opens Team Chat', async ({ page }) => {
  await page.getByRole('button', { name: 'Menu' }).click();
  const link = page.getByRole('link', { name: /Team Chat/ });
  await expect(link.getByLabel('6 unread')).toBeVisible();
  await link.click();
  await expect(page.getByRole('heading', { name: 'Team Chat' })).toBeVisible();
});

test('the Chat tab link still goes to the chat', async ({ page }) => {
  await expect(chatTab(page)).toHaveAttribute('href', '/banter');
});
