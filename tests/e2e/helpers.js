import { expect, test as base } from '@playwright/test';

export { expect };

export const CAPTAIN = 'captain@demo.test';
export const PLAYER = 'jordan@demo.test'; // Jordan Rivera, a regular player in the sample data
const PASSWORD = 'demo1234';

/** Every test also fails if the page logs an error or crashes. */
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(`page error: ${err.message}`));
    page.on('console', (msg) => msg.type() === 'error' && errors.push(`console error: ${msg.text()}`));
    await use(page);
    expect(errors, 'the browser reported errors').toEqual([]);
  },
});

/** Signs in to the demo site (fresh sample data per test) and skips the welcome slides and chat tip. */
export async function signIn(page, email = CAPTAIN, { tip = false } = {}) {
  // A fixed midday start, so sample messages from "26 hours ago" are always Yesterday.
  await page.clock.install({ time: new Date('2026-10-08T12:00:00') });
  await page.goto('/login');
  if (!tip) await page.evaluate(() => localStorage.setItem('jt_chat_tip_seen', '1'));
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
}

/** The Chat tab: bottom bar on phones, top bar on computers. */
export const chatTab = (page) => page.locator('a[href="/banter"]:visible').first();
export const chatBadge = (page) => chatTab(page).locator('[aria-label$="unread"]');

export async function openChat(page) {
  await chatTab(page).click();
  await expect(page.getByRole('log', { name: 'Messages' })).toBeVisible();
}

export const isPhone = (testInfo) => testInfo.project.name === 'phone';

/** Shows the list of rooms (on computers it's always beside the chat). */
export async function showRooms(page) {
  const list = page.locator('[data-room="team"]');
  if (!(await list.isVisible())) {
    // Phones: "Threads" in Team Chat, or the back arrow in a thread.
    const threads = page.getByRole('button', { name: /^Threads/ });
    if (await threads.isVisible()) await threads.click();
    else await page.getByRole('button', { name: 'All chats' }).click();
  }
  await expect(list).toBeVisible();
}

export async function openRoom(page, name) {
  await showRooms(page);
  await page.locator('[data-room]', { hasText: name }).click();
  await expect(page.getByRole('log', { name: 'Messages' })).toBeVisible();
}

export async function openTeamChat(page) {
  await showRooms(page);
  await page.locator('[data-room="team"]').click();
  await expect(page.getByRole('heading', { name: 'Team Chat' })).toBeVisible();
}

/** A room's row in the room list. */
export const roomRow = (page, name) => page.locator('[data-room]', { hasText: name });

export const composer = (page) => page.getByRole('textbox', { name: 'Message' });

export async function send(page, text) {
  await composer(page).fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(message(page, text)).toBeVisible();
  // Wait for it to be saved (the "Sending…" copy is replaced).
  await expect(page.getByText('Sending…')).toHaveCount(0);
}

/** A message bubble (the tappable part, not a reply quote of it) by its text. */
export const message = (page, text) =>
  page.locator('[data-message-id] [role="button"][aria-expanded]').filter({ hasText: text }).last();

/** A whole message row (name, reply quote, bubble, reactions) by the message's own text. */
export const messageRow = (page, text) =>
  page.locator('[data-message-id]').filter({ has: page.locator('[role="button"][aria-expanded]', { hasText: text }) });

/** Goes to the Schedule page the way a player would (no reload). */
export async function goToSchedule(page) {
  await page.getByRole('link', { name: 'Schedule', exact: true }).filter({ visible: true }).click();
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
}

/** Taps a message to show its reactions and options. */
export async function tapMessage(page, text) {
  await message(page, text).click();
  await expect(page.getByRole('button', { name: 'Reply' })).toBeVisible();
}
