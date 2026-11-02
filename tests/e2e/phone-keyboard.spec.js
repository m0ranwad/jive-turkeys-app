// Typing on a phone. On iPhones the on-screen keyboard covers the bottom of the
// page without making it shorter, and Safari slides the page around; the chat
// must stay in the part of the screen above the keyboard. Chromium can't show a
// real on-screen keyboard, so these tests stand in for Safari by shrinking and
// moving the visible area (window.visualViewport) the way it does.
import { composer, expect, isPhone, message, openChat, signIn, test } from './helpers';

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo), 'phones only');
  await signIn(page);
  await page.evaluate(() => {
    const fake = new EventTarget();
    Object.assign(fake, {
      width: innerWidth,
      height: innerHeight,
      offsetTop: 0,
      offsetLeft: 0,
      pageTop: 0,
      pageLeft: 0,
      scale: 1,
    });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: fake });
    // keyboard(height, slid): the keyboard covers `height` px; Safari has slid the page `slid` px up.
    window.keyboard = (height, slid = 0) => {
      fake.height = innerHeight - height;
      fake.offsetTop = slid;
      fake.dispatchEvent(new Event('resize'));
      fake.dispatchEvent(new Event('scroll'));
    };
  });
  await openChat(page);
  // Start at the newest messages.
  await page.getByRole('log').evaluate((el) => (el.scrollTop = el.scrollHeight));
});

const visibleArea = (page) =>
  page.evaluate(() => ({ top: visualViewport.offsetTop, bottom: visualViewport.offsetTop + visualViewport.height }));

async function expectInside(locator, area) {
  const box = await locator.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(area.top - 1);
  expect(box.y + box.height).toBeLessThanOrEqual(area.bottom + 1);
}

test('with the keyboard up, the message box, your words and the newest messages stay visible', async ({ page }) => {
  const box = composer(page);
  await box.click();
  await page.evaluate(() => window.keyboard(330));
  await box.pressSequentially('On my way');

  const area = await visibleArea(page);
  await expectInside(box, area);
  await expect(box).toHaveValue('On my way');
  await expectInside(page.getByRole('heading', { name: 'Team Chat' }), area);
  await expect(message(page, '🔥🔥🔥')).toBeInViewport();
  await expectInside(message(page, '🔥🔥🔥'), area);
});

test('when Safari slides the page, the chat follows', async ({ page }) => {
  const box = composer(page);
  await box.click();
  await page.evaluate(() => window.keyboard(330, 250));
  const area = await visibleArea(page);
  await expectInside(box, area);
  await expectInside(page.getByRole('heading', { name: 'Team Chat' }), area);
});

test('sending keeps the keyboard open, and the new message shows above the box', async ({ page }) => {
  const box = composer(page);
  await box.click();
  await page.evaluate(() => window.keyboard(330));
  await box.fill('Leaving now');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(box).toBeFocused();
  await expect(box).toHaveValue('');
  await expect(message(page, 'Leaving now')).toBeInViewport();
  await expectInside(message(page, 'Leaving now'), await visibleArea(page));
});

test('picking an emoji keeps the keyboard open', async ({ page }) => {
  const box = composer(page);
  await box.click();
  await page.evaluate(() => window.keyboard(330));
  await page.getByRole('button', { name: 'Emoji' }).click();
  await page.getByRole('button', { name: '😂', exact: true }).click();
  await expect(box).toBeFocused();
  await expect(box).toHaveValue('😂');
});

test('when the keyboard goes away, the chat goes back to normal', async ({ page }) => {
  const box = composer(page);
  await box.click();
  await page.evaluate(() => window.keyboard(330));
  await box.blur();
  await page.evaluate(() => window.keyboard(0));
  const composerBox = await box.boundingBox();
  const tabBar = await page.locator('[data-bottom-nav]').boundingBox();
  expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(tabBar.y);
  await expect(page.getByRole('link', { name: 'Schedule', exact: true }).filter({ visible: true })).toBeInViewport();
});

/** Acts out the start of a swipe on `locator` and says whether the chat stopped it from moving the page. */
const swipeStopped = (locator) =>
  locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const touch = new Touch({ identifier: 1, target: el, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 });
    const swipe = new TouchEvent('touchmove', { touches: [touch], targetTouches: [touch], changedTouches: [touch], bubbles: true, cancelable: true });
    el.dispatchEvent(swipe);
    return swipe.defaultPrevented;
  });

test("with the keyboard up, a swipe on the room name doesn't slide the chat, and the messages still scroll", async ({ page }) => {
  const box = composer(page);
  const roomName = page.getByRole('heading', { name: 'Team Chat' });
  expect(await swipeStopped(roomName), 'no keyboard: swipes are left alone').toBe(false);

  await box.click();
  await page.evaluate(() => window.keyboard(330));
  expect(await swipeStopped(roomName)).toBe(true);
  expect(await swipeStopped(page.getByRole('button', { name: 'Send' }))).toBe(true);
  expect(await swipeStopped(message(page, '🔥🔥🔥')), 'the messages scroll').toBe(false);

  await box.blur();
  await page.evaluate(() => window.keyboard(0));
  expect(await swipeStopped(roomName)).toBe(false);
});

test('with the keyboard up, a finger moving in the message box is left to the phone (moving the cursor, selecting)', async ({ page }) => {
  // iPhones move the cursor with a press and drag, and stretch a selection by dragging its ends.
  const box = composer(page);
  await box.click();
  await page.evaluate(() => window.keyboard(330));
  await box.fill('Running late');
  expect(await swipeStopped(box)).toBe(false);
  expect(await swipeStopped(page.getByRole('button', { name: 'Send' })), 'around the box, a swipe still stays put').toBe(true);

  await page.getByRole('button', { name: 'GIF', exact: true }).click();
  expect(await swipeStopped(page.getByRole('searchbox', { name: 'Search GIFs' }))).toBe(false);
});

/** Inside the part of the screen above the keyboard, and not cut off by the edge of the chat. */
async function expectShown(locator, area) {
  await expectInside(locator, area);
  const chat = await locator.page().locator('[data-chat-shell] section').boundingBox();
  const box = await locator.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(chat.y);
}

// A small iPhone in Safari: the keyboard and its bars leave about 280px of the page.
const SMALL_PHONE_KEYBOARD = 560;

test('with the keyboard up on a small phone, the GIF search box stays on screen above the GIFs', async ({ page }) => {
  await page.getByRole('button', { name: 'GIF', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search GIFs' });
  await expect(search).toBeFocused();
  await page.evaluate((height) => window.keyboard(height), SMALL_PHONE_KEYBOARD);

  const area = await visibleArea(page);
  await expectShown(search, area);
  await expectShown(page.getByRole('button', { name: 'Close GIF search' }), area);
  await search.pressSequentially('goal');
  const gif = page.getByRole('button', { name: 'Send GIF: Goal!' });
  await expect(gif).toBeVisible();
  await expectShown(gif, area);
  await expectInside(composer(page), area);
});

test('with the keyboard up on a small phone, the emoji picker fits with its row of groups', async ({ page }) => {
  const box = composer(page);
  await box.click();
  await page.evaluate((height) => window.keyboard(height), SMALL_PHONE_KEYBOARD);
  await page.getByRole('button', { name: 'Emoji' }).click();

  const area = await visibleArea(page);
  await expectShown(page.getByRole('button', { name: 'Faces' }), area);
  await page.getByRole('button', { name: '😂', exact: true }).click();
  await expect(box).toHaveValue('😂');
  await expect(box).toBeFocused();
});
