// Scrolling on phones: one swipe scrolls whatever is under the finger and stops at its end, the page behind
// never moves, and popups fit the screen with one scroll area each. Chromium can't act out iPhone Safari (its
// sliding toolbar, the whole screen bouncing), so these check what it can: that every scroll area keeps a swipe
// to itself (overscroll-behavior: contain), and which parts of a popup scroll. docs/chat.md section 2 has the
// rules, and "What automation can't check" what to try on a real iPhone.
import { composer, expect, isPhone, openChat, showRooms, signIn, startNew, test } from './helpers';

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo), 'phones only');
  await signIn(page);
});

/** Every box inside `locator` (itself included) that scrolls, or would if it had more in it. */
const scrollAreas = (locator) =>
  locator.evaluate((root) =>
    [root, ...root.querySelectorAll('*')]
      .filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY))
      .map((el) => ({
        area: el.getAttribute('aria-label') || el.getAttribute('role') || el.tagName.toLowerCase(),
        swipe: getComputedStyle(el).overscrollBehaviorY,
      })),
  );

async function expectSwipesKept(locator) {
  const areas = await scrollAreas(locator);
  expect(areas.length).toBeGreaterThan(0);
  expect(areas.filter((a) => a.swipe !== 'contain'), 'scroll areas that pass a swipe on to the page').toEqual([]);
}

const canScroll = (locator) => locator.evaluate((el) => el.scrollHeight > el.clientHeight + 1);

test('the chat fills the screen: the page behind it never scrolls or bounces', async ({ page }) => {
  await openChat(page);
  await showRooms(page);
  const pageScrolls = () => page.evaluate(() => document.scrollingElement.scrollHeight > innerHeight + 1);
  const bounce = () => page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY);
  expect(await pageScrolls()).toBe(false);
  expect(await bounce()).toBe('none');

  await page.locator('[data-room="team"]').click();
  await expect(page.getByRole('log', { name: 'Messages' })).toBeVisible();
  expect(await pageScrolls()).toBe(false);

  // Other pages scroll as usual.
  await page.getByRole('link', { name: 'Schedule', exact: true }).filter({ visible: true }).click();
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  expect(await bounce()).toBe('auto');
});

test("every scroll area in the chat keeps a swipe to itself: room list, messages, @ list, emoji picker", async ({ page }) => {
  await openChat(page);
  await showRooms(page);
  const shell = page.locator('[data-chat-shell]');
  await expectSwipesKept(shell);

  await page.locator('[data-room="team"]').click();
  await composer(page).fill('@');
  await expect(page.getByRole('listbox', { name: 'Mention a teammate' })).toBeVisible();
  const areas = (await scrollAreas(shell)).map((a) => a.area);
  expect(areas).toEqual(expect.arrayContaining(['Messages', 'Mention a teammate']));
  await expectSwipesKept(shell);

  await composer(page).fill('');
  await page.getByRole('button', { name: 'Emoji' }).click();
  await expect(page.getByRole('button', { name: '😂', exact: true })).toBeVisible();
  await expectSwipesKept(shell);
});

test('New private chat: only the names scroll; the title, search box and Start chat stay on screen', async ({ page }) => {
  await openChat(page);
  await startNew(page, 'private');
  const dialog = page.getByRole('dialog', { name: 'New private chat' });
  const names = dialog.getByTestId('people-list');
  await expect(names).toBeVisible();
  expect(await canScroll(names), 'the names scroll').toBe(true);
  expect(await canScroll(dialog), 'the window itself does not').toBe(false);
  expect(await canScroll(dialog.locator('form')), 'nor does the part below the title').toBe(false);
  await expectSwipesKept(dialog);

  // Scroll to the last name and pick it: everything else stayed put.
  await names.evaluate((el) => (el.scrollTop = el.scrollHeight));
  const last = names.locator('label').last();
  await last.click();
  await expect(dialog).toContainText('1 picked');
  await expect(dialog.getByRole('heading', { name: 'New private chat' })).toBeInViewport();
  await expect(dialog.getByPlaceholder('Find a teammate')).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Start chat' })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Start chat' })).toBeEnabled();
});

test("Add people: who's in the chat steps aside, and only the names to pick scroll", async ({ page }) => {
  await openChat(page);
  await showRooms(page);
  await page.locator('[data-room]').filter({ has: page.getByText('Jordan R.', { exact: true }) }).click();
  await page.getByRole('button', { name: 'Chat options' }).click();
  await page.getByRole('button', { name: 'People' }).click();
  const dialog = page.getByRole('dialog', { name: 'People in this chat' });
  const inIt = dialog.getByRole('list', { name: 'People in this chat' });
  await expect(inIt).toBeVisible();

  await dialog.getByRole('button', { name: 'Add people' }).click();
  await expect(inIt).toHaveCount(0);
  const names = dialog.getByTestId('people-list');
  expect(await canScroll(names), 'the names scroll').toBe(true);
  expect(await canScroll(dialog), 'the window itself does not').toBe(false);
  await expectSwipesKept(dialog);
  await expect(dialog.getByRole('button', { name: 'Pick who to add' })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeInViewport();

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(inIt.getByRole('listitem')).toHaveCount(2);
});

test('chat search keeps a swipe to itself', async ({ page }) => {
  await openChat(page);
  await showRooms(page);
  await page.getByRole('button', { name: 'Search the chat' }).click();
  await expectSwipesKept(page.getByRole('dialog'));
});
