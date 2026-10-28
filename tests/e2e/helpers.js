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

/** Signs in to the demo site (fresh sample data per test) and dismisses the chat tip and notifications card. */
export async function signIn(page, email = CAPTAIN, { tip = false, pushPrompt = false } = {}) {
  // A fixed midday start, so sample messages from "26 hours ago" are always Yesterday.
  await page.clock.install({ time: new Date('2026-10-08T12:00:00') });
  await page.goto('/login');
  if (!tip) await page.evaluate(() => localStorage.setItem('jt_chat_tip_seen', '1'));
  if (!pushPrompt) await page.evaluate(() => localStorage.setItem('jt_push_prompt_dismissed', '1'));
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
}

/** Records what the site puts on the app icon (the Badging API). Call before the page loads; read it with iconBadge(). */
export async function recordIconBadge(page) {
  await page.addInitScript(() => {
    window.__iconBadge = [];
    const record = (n) => {
      window.__iconBadge.push(n);
      return Promise.resolve();
    };
    Object.defineProperty(Navigator.prototype, 'setAppBadge', { configurable: true, value: (n) => record(n) });
    Object.defineProperty(Navigator.prototype, 'clearAppBadge', { configurable: true, value: () => record(0) });
  });
}

/** The number on the app icon right now (0: none). */
export const iconBadge = (page) => page.evaluate(() => window.__iconBadge.at(-1));

/** The Chat tab: bottom bar on phones, top bar on computers. It links to the room you were last in, if any. */
export const chatTab = (page) => page.locator('a[href^="/banter"]:visible').first();
export const chatBadge = (page) => chatTab(page).locator('[aria-label$="unread"]');

export const isPhone = (testInfo) => testInfo.project.name === 'phone';

/** Phones show the room list or a room; computers show both side by side. */
export const phoneLayout = (page) => page.viewportSize().width < 768;

/** Taps the Chat tab (the room list, or the room you were last in) and opens Team Chat. */
export async function openChat(page) {
  await chatTab(page).click();
  await openTeamChat(page);
  await expect(page.getByRole('log', { name: 'Messages' })).toBeVisible();
}

/** Where the chat starts: the room list on phones, Team Chat beside it on computers. */
export async function expectChatStart(page) {
  await expect(page.locator('[data-room="team"]')).toBeVisible();
  if (phoneLayout(page)) await expect(page.getByRole('log', { name: 'Messages' })).toHaveCount(0);
  else await expect(page.getByRole('heading', { name: 'Team Chat' })).toBeVisible();
}

/** Shows the list of rooms (on computers it's always beside the chat). */
export async function showRooms(page) {
  const list = page.locator('[data-room="team"]');
  // Wait for the chat to be on screen (say, after a reload): the list, or a room with its back arrow.
  await expect(page.locator('[data-room="team"]:visible').or(page.getByRole('button', { name: /^All chats/ })).first()).toBeVisible();
  // Phones: the back arrow in a room.
  if (!(await list.isVisible())) await page.getByRole('button', { name: 'All chats' }).click();
  await expect(list).toBeVisible();
}

/** New at the top of the room list, then "Thread for everyone" or "Private chat". */
export async function startNew(page, kind) {
  await showRooms(page);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const pick = page.getByRole('dialog', { name: 'Start a chat' });
  await pick.getByRole('button', { name: kind === 'thread' ? /^Thread for everyone/ : /^Private chat/ }).click();
}

/** Opens search, at the top of the room list. */
export async function openSearch(page) {
  await showRooms(page);
  await page.getByRole('button', { name: 'Search the chat' }).click();
}

export async function openRoom(page, name) {
  await showRooms(page);
  const row = page.locator('[data-room]', { hasText: name });
  await row.click();
  // The room you were in shows for a moment longer: wait for this one, so typing goes to it.
  await expect(row).toHaveAttribute('aria-current', 'page');
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

/** A new account's first step: the team code (TURKEY in the sample data). */
/** Opens a section that starts closed (Payment details, Recent changes), unless it's open already. */
export async function openSection(page, name) {
  const section = page.locator('details', { has: page.locator('summary', { hasText: name }) });
  if (!(await section.evaluate((d) => d.open))) await section.locator('summary').click();
  return section;
}

export async function enterTeamCode(page, code = 'TURKEY') {
  await expect(page.getByRole('heading', { name: 'Enter the team code' })).toBeVisible();
  await page.getByLabel('Team code').fill(code);
  await page.getByRole('button', { name: 'Join the team' }).click();
}

/** A rare dues action, reached from the player's compact payment sheet. */
export async function duesOption(sheet, name) {
  await sheet.getByRole('button', { name: 'More options', exact: true }).click();
  await sheet.getByRole('button', { name, exact: true }).click();
}

/** Captains: a player's options on the Team page (status, captain, remove or edit), opened by tapping their name. */
export async function playerOptions(page, name) {
  await page.locator(`button[data-options-for="${name}"]`).click();
  const dialog = page.getByRole('dialog', { name, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * The Team page's groups: how many are Playing, Available to sub and Unavailable (a group with
 * nobody isn't shown), and how many rows haven't joined the site yet.
 */
export async function expectTeam(page, { playing, sub = 0, unavailable = 0, notJoined }) {
  const heading = (status) => page.locator(`[data-status-group="${status}"] h3`);
  for (const [status, label, n] of [['active', 'Playing', playing], ['sub_pool', 'Available to sub', sub], ['on_break', 'Unavailable', unavailable]]) {
    if (n) await expect(heading(status)).toHaveText(new RegExp(`^${label} · ${n}( ·|$)`));
    else await expect(heading(status)).toHaveCount(0);
  }
  if (notJoined !== undefined) {
    await expect(page.locator('[data-roster-row]').filter({ hasText: 'Not joined yet' })).toHaveCount(notJoined);
  }
}

/** A row on the Team page, by name. */
export const rosterRow = (page, name) => page.locator(`[data-roster-row="${name}"]`);

/** Team page rows for teammates who haven't joined the site yet. */
export const notJoinedRows = (page) => page.locator('[data-roster-row]').filter({ hasText: 'Not joined yet' });
