// Notifications on this device: the bell and the one-time offer (both at the top
// of the chat's room list; the offer on Schedule too),
// the settings (with chat messages and game alerts switched separately), and the
// background helper that shows notifications and opens the chat.
// Previews have no sender, so turning on shows a local sample instead; the
// sender itself is tested in tests/unit/notify.test.js and the database rules
// in supabase/tests/chat.test.sql.
import { expect, iconBadge, isPhone, openChat, recordIconBadge, showRooms, signIn, test } from './helpers';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const bell = (page) => page.getByRole('button', { name: /^Notifications:/ });
const dialog = (page) => page.getByRole('dialog', { name: 'Notifications' });
const card = (page) => page.getByRole('region', { name: 'Turn on notifications' });
const choice = (scope, name) => scope.getByRole('switch', { name });

const shownNotifications = (page) =>
  page.evaluate(async () =>
    (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ title: n.title, body: n.body })),
  );

test.describe('turning notifications on and off', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.grantPermissions(['notifications']);
    await signIn(page);
    await openChat(page);
    await showRooms(page);
  });

  test('the bell starts off; turning on shows a sample and the bell lights up', async ({ page }) => {
    await expect(bell(page)).toHaveAccessibleName('Notifications: off');
    await bell(page).click();
    await expect(dialog(page)).toContainText('Get a notification for team chat messages and game alerts');
    await expect(dialog(page)).toContainText('preview with pretend players');
    await dialog(page).getByRole('button', { name: 'Turn on notifications' }).click();

    await expect(page.getByText('Notifications are on', { exact: true })).toBeVisible();
    await expect(dialog(page)).toContainText('On for this device.');
    await expect
      .poll(() => shownNotifications(page))
      .toContainEqual({ title: 'Notifications are on 🦃', body: expect.stringContaining('chat messages and game alerts') });
    // The open dialog hides the page behind it, so close it to check the bell.
    await page.keyboard.press('Escape');
    await expect(bell(page)).toHaveAccessibleName('Notifications: on');
  });

  test('stays on after a reload, turns off, and stays off', async ({ page }) => {
    await bell(page).click();
    await dialog(page).getByRole('button', { name: 'Turn on notifications' }).click();
    await expect(dialog(page)).toContainText('On for this device.');
    await page.reload();
    await expect(bell(page)).toHaveAccessibleName('Notifications: on');

    await bell(page).click();
    await dialog(page).getByRole('button', { name: 'Turn off' }).click();
    await expect(page.getByText('Notifications are off on this device')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(bell(page)).toHaveAccessibleName('Notifications: off');
    await page.reload();
    await expect(bell(page)).toHaveAccessibleName('Notifications: off');
  });

  test('Send a test shows a notification', async ({ page }) => {
    await bell(page).click();
    await dialog(page).getByRole('button', { name: 'Turn on notifications' }).click();
    await expect(dialog(page)).toContainText('On for this device.');
    await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).forEach((n) => n.close()));
    await dialog(page).getByRole('button', { name: 'Send a test' }).click();
    await expect(page.getByText('Test sent')).toBeVisible();
    await expect.poll(async () => (await shownNotifications(page)).length).toBe(1);
  });

  test('signing out turns notifications off on this device', async ({ page }) => {
    await bell(page).click();
    await dialog(page).getByRole('button', { name: 'Turn on notifications' }).click();
    await expect(dialog(page)).toContainText('On for this device.');
    await page.keyboard.press('Escape');
    await expect(bell(page)).toHaveAccessibleName('Notifications: on');
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(await page.evaluate(() => localStorage.getItem('jt_demo_push_on'))).toBeNull();
  });
});

test('the chat offers notifications once; Not now hides the card for good', async ({ context, page }) => {
  await context.grantPermissions(['notifications']);
  await signIn(page, undefined, { pushPrompt: true });
  await openChat(page);
  await showRooms(page);
  await expect(card(page)).toContainText('Get notifications for team chat and game alerts');
  await card(page).getByRole('button', { name: 'Not now' }).click();
  await expect(card(page)).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-room="team"]')).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});

test('Turn on from the card works too, and the card goes away', async ({ context, page }) => {
  await context.grantPermissions(['notifications']);
  await signIn(page, undefined, { pushPrompt: true });
  await openChat(page);
  await showRooms(page);
  await card(page).getByRole('button', { name: 'Turn on' }).click();
  await expect(bell(page)).toHaveAccessibleName('Notifications: on');
  await expect(card(page)).toHaveCount(0);
});

test('Schedule offers notifications too, and Not now there hides it in the chat as well', async ({ context, page }) => {
  await context.grantPermissions(['notifications']);
  await signIn(page, undefined, { pushPrompt: true });
  await expect(card(page)).toContainText('Get notifications for team chat and game alerts, like Player of the Match voting.');
  await card(page).getByRole('button', { name: 'Not now' }).click();
  await expect(card(page)).toHaveCount(0);
  await openChat(page);
  await showRooms(page);
  await expect(card(page)).toHaveCount(0);
});

test('Turn on from Schedule works', async ({ context, page }) => {
  await context.grantPermissions(['notifications']);
  await signIn(page, undefined, { pushPrompt: true });
  await card(page).getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByText('Notifications are on', { exact: true })).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});

test('chat messages and game alerts are both on, and each can be turned off, from the bell or My Profile', async ({ context, page }) => {
  await context.grantPermissions(['notifications']);
  await signIn(page);
  await openChat(page);
  await showRooms(page);
  await bell(page).click();
  await dialog(page).getByRole('button', { name: 'Turn on notifications' }).click();
  await expect(choice(dialog(page), 'Chat messages')).toHaveAttribute('aria-checked', 'true');
  await expect(choice(dialog(page), 'Game alerts')).toHaveAttribute('aria-checked', 'true');
  await choice(dialog(page), 'Chat messages').click();
  await expect(page.getByText('Chat messages: off')).toBeVisible();
  await expect(choice(dialog(page), 'Chat messages')).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');

  // The same choices on My Profile, saved.
  await page.goto('/profile');
  const settings = page.getByRole('region', { name: 'Notifications' });
  await expect(settings).toContainText('On for this device.');
  await expect(choice(settings, 'Chat messages')).toHaveAttribute('aria-checked', 'false');
  await expect(choice(settings, 'Game alerts')).toHaveAttribute('aria-checked', 'true');
  await choice(settings, 'Game alerts').click();
  await expect(page.getByText('Game alerts: off')).toBeVisible();
  await page.reload();
  await expect(choice(settings, 'Game alerts')).toHaveAttribute('aria-checked', 'false');
  await choice(settings, 'Chat messages').click();
  await expect(choice(settings, 'Chat messages')).toHaveAttribute('aria-checked', 'true');
});

test('players who turn chat messages off get no number on the app icon', async ({ context, page }) => {
  await recordIconBadge(page);
  await context.grantPermissions(['notifications']);
  await signIn(page);
  await expect.poll(() => iconBadge(page)).toBe(6);
  await page.goto('/profile');
  const settings = page.getByRole('region', { name: 'Notifications' });
  await settings.getByRole('button', { name: 'Turn on notifications' }).click();
  await choice(settings, 'Chat messages').click();
  await expect(choice(settings, 'Chat messages')).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => iconBadge(page)).toBe(0);
  await choice(settings, 'Chat messages').click();
  await expect.poll(() => iconBadge(page)).toBe(6);
});

test('when notifications are blocked, it explains how to allow them', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Notification, 'permission', { get: () => 'denied' }));
  await signIn(page);
  await openChat(page);
  await showRooms(page);
  await bell(page).click();
  await expect(dialog(page)).toContainText('Notifications are blocked for Jive Turkeys.');
  await expect(dialog(page).getByRole('button', { name: 'Turn on notifications' })).toHaveCount(0);
});

test.describe('on an iPhone that has not added the site to its Home Screen', () => {
  test.use({ userAgent: IPHONE_UA });
  test.beforeEach(async ({}, testInfo) => test.skip(!isPhone(testInfo), 'phones only'));

  test('points to the Home Screen first', async ({ page }) => {
    await signIn(page, undefined, { pushPrompt: true });
    await openChat(page);
    await showRooms(page);
    await expect(card(page)).toContainText('add Jive Turkeys to your Home Screen first');
    await bell(page).click();
    await expect(dialog(page)).toContainText('notifications work once Jive Turkeys is on your Home Screen');
    await dialog(page).getByRole('button', { name: 'Show me how' }).click();
    await expect(page.getByRole('dialog', { name: 'Add to your Home Screen' })).toContainText('Tap the Share button');
  });
});

test.describe('the background helper', () => {
  async function startWorker(context, page) {
    await context.grantPermissions(['notifications']);
    await signIn(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    const [worker] = context.serviceWorkers();
    expect(worker, 'service worker running').toBeTruthy();

    // Events made by a script can't use the real waitUntil, and without it the browser
    // may drop the work they start. So collect what the handler passes to waitUntil and
    // wait for it, as the browser does for a real push or tap.
    await worker.evaluate(() => {
      self.fire = async (event) => {
        const work = [];
        event.waitUntil = (promise) => work.push(promise);
        self.dispatchEvent(event);
        if (!work.length) throw new Error(`the ${event.type} handler didn't call waitUntil`);
        await Promise.all(work);
      };
      self.push = (data) => self.fire(new PushEvent('push', { data: JSON.stringify(data) }));
    });
    return worker;
  }

  test('a chat notification puts the unread count on the app icon; others leave it be', async ({ context, page }) => {
    const worker = await startWorker(context, page);
    await worker.evaluate(() => {
      self.iconBadge = [];
      const record = (n) => {
        self.iconBadge.push(n);
        return Promise.resolve();
      };
      Object.defineProperty(self.navigator, 'setAppBadge', { configurable: true, value: (n) => record(n) });
      Object.defineProperty(self.navigator, 'clearAppBadge', { configurable: true, value: () => record(0) });
    });
    const chat = { title: 'Team Chat', body: 'Sam O.: Field 3', url: '/banter?room=team', tag: 'chat-team' };

    await worker.evaluate((data) => self.push(data), { ...chat, badge: 4 });
    await worker.evaluate((data) => self.push(data), { ...chat, badge: 5 });
    await worker.evaluate((data) => self.push(data), {
      title: '🏆 Player of the Match',
      body: 'Voting is open',
      url: '/games/g1',
      tag: 'potm-g1',
    });
    expect(await worker.evaluate(() => self.iconBadge)).toEqual([4, 5]);
    await worker.evaluate((data) => self.push(data), { ...chat, badge: 0 });
    expect(await worker.evaluate(() => self.iconBadge), '0 clears it').toEqual([4, 5, 0]);
    // The notifications still show.
    expect(await worker.evaluate(async () => (await self.registration.getNotifications()).length)).toBe(2);
  });

  test('shows a pushed chat notification, and tapping it opens that room', async ({ context, page }) => {
    const worker = await startWorker(context, page);

    await worker.evaluate(() => {
      const data = JSON.stringify({
        title: '⚽ Sunday pickup?',
        body: 'Sam O.: Field 3 at 10?',
        url: '/banter?thread=abc',
        tag: 'chat-abc',
      });
      return self.fire(new PushEvent('push', { data }));
    });
    await expect
      .poll(() =>
        worker.evaluate(async () =>
          (await self.registration.getNotifications()).map((n) => [n.title, n.body, n.tag, n.data.url]),
        ),
      )
      .toEqual([['⚽ Sunday pickup?', 'Sam O.: Field 3 at 10?', 'chat-abc', '/banter?thread=abc']]);

    await worker.evaluate(async () => {
      const [notification] = await self.registration.getNotifications();
      await self.fire(new NotificationEvent('notificationclick', { notification }));
    });
    await expect(page).toHaveURL(/\/banter\?thread=abc$/);
  });
});
