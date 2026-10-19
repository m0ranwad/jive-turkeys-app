// Messages posted while live updates were cut off (a phone asleep, the app in the background, lost
// signal) still reach the open room, and nothing that hasn't reached the screen is marked read. See
// docs/chat.md sections 5 and 6. The demo backend acts out live updates breaking off when
// jt_demo_live_off is set: messages still save, but none arrive live.
import { chatBadge, expect, goToSchedule, message, openChat, send, signIn, test } from './helpers';

const liveOff = (page) => page.evaluate(() => localStorage.setItem('jt_demo_live_off', '1'));
const liveOn = (page) => page.evaluate(() => localStorage.removeItem('jt_demo_live_off'));

/** Sam posts in Team Chat from their own phone. */
const samPosts = (page, body) =>
  page.evaluate(async (text) => {
    const { api } = await import('/src/api/index.js');
    const sam = (await api.entities.PlayerProfile.list()).find((p) => p.display_name.startsWith('Sam'));
    await api.entities.Message.create({ user_id: sam.user_id, author_name: sam.display_name, body: text, thread_id: null, reply_to_id: null });
  }, body);

/** The app goes to the background (or the phone to sleep), or comes back. */
const setHidden = (page, hidden) =>
  page.evaluate((value) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (value ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await openChat(page);
  await expect(message(page, '🔥🔥🔥')).toBeVisible();
});

test('coming back to the app brings in what was posted meanwhile, without leaving the room', async ({ page }) => {
  await setHidden(page, true);
  await liveOff(page);
  await samPosts(page, 'We switched to field 4');
  await setHidden(page, false);
  await expect(message(page, 'We switched to field 4')).toBeVisible();

  // Seen, so it's read: only Sunday pickup's 3 are left.
  await send(page, 'Got it');
  await liveOn(page);
  await goToSchedule(page);
  await expect(chatBadge(page)).toHaveText('3');
});

test('the connection coming back brings in what was posted meanwhile', async ({ page }) => {
  await liveOff(page);
  await samPosts(page, 'We switched to field 4');
  await liveOn(page);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(message(page, 'We switched to field 4')).toBeVisible();
});

test("sending a message doesn't mark read one that never reached your screen", async ({ page }) => {
  // Live updates cut off without the page noticing: Sam's message doesn't arrive.
  await liveOff(page);
  await samPosts(page, 'We switched to field 4');
  await send(page, 'See you there');
  await expect(message(page, 'We switched to field 4')).toHaveCount(0);
  // Give marking read time to happen, if it were going to.
  await page.clock.runFor(2000);

  await liveOn(page);
  await goToSchedule(page);
  await expect(chatBadge(page), "Sam's message still counts").toHaveText('4');
  // Back in the chat it shows, and then it's read.
  await openChat(page);
  await expect(message(page, 'We switched to field 4')).toBeVisible();
  await goToSchedule(page);
  await expect(chatBadge(page)).toHaveText('3');
});
