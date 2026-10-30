// Announcements: a post you haven't seen shows on the menu (a number on
// Announcements, a dot on the Menu button) until you open them, and captains
// fix or delete a post. Counting is the database's announcements_unread()
// (supabase/tests/announcements.test.sql); the demo backend mirrors it.
//
// Sample data: "Team photo next game" went up after everyone last opened
// Announcements; "Welcome to the new team hub" before.
import { CAPTAIN, expect, PLAYER, signIn, test } from './helpers';

const menuButton = (page) => page.getByRole('button', { name: 'Menu', exact: true });
const dot = (page) => page.locator('[data-new-posts-dot]');
const post = (page, title) => page.getByRole('article').filter({ hasText: title });

async function openAnnouncements(page) {
  await menuButton(page).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: /Announcements/ }).click();
  await expect(page.getByRole('heading', { name: 'Announcements', exact: true })).toBeVisible();
}

async function goToStats(page) {
  await page.locator('a[href="/stats"]:visible').first().click();
  await expect(page.getByRole('heading', { name: 'Stats', exact: true })).toBeVisible();
}

/** Changes players through the normal sign-in flow, keeping this session's sample data. */
async function switchTo(page, email) {
  await page.getByRole('link', { name: 'My profile' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
}

async function postOptions(page, title, action) {
  await post(page, title).getByRole('button', { name: 'Announcement options' }).click();
  await page.getByRole('dialog', { name: 'Announcement options' }).getByRole('button', { name: action }).click();
}

// When the signed-in player last opened Announcements, from the preview's sample data.
const lastRead = (page) =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('jt_demo_db_'));
    const db = JSON.parse(localStorage.getItem(key));
    const me = localStorage.getItem('jt_demo_session');
    return db.announcement_reads.find((r) => r.user_id === me)?.last_read_at;
  });

test("a post you haven't seen shows on the menu until you open Announcements", async ({ page }) => {
  await signIn(page, PLAYER);
  await expect(dot(page)).toBeVisible();
  await expect(menuButton(page)).toHaveAccessibleDescription('1 new announcement');
  await menuButton(page).click();
  await expect(page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: /Announcements/ }).getByLabel('1 new announcement')).toBeVisible();
  await page.keyboard.press('Escape');

  const before = await lastRead(page);
  await openAnnouncements(page);
  await expect(dot(page)).toHaveCount(0);
  await expect.poll(() => lastRead(page)).not.toBe(before);

  // Gone on the other screens too, and the next time the site opens.
  await goToStats(page);
  await expect(dot(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Stats', exact: true })).toBeVisible();
  await expect(dot(page)).toHaveCount(0);
  await expect(menuButton(page)).not.toHaveAttribute('aria-describedby');
});

test("a captain's own post isn't new to them; teammates see it", async ({ page }) => {
  await signIn(page);
  await openAnnouncements(page);
  await page.getByRole('button', { name: 'New post' }).click();
  await page.getByLabel('Title').fill('Bring both jerseys');
  await page.getByLabel('Message').fill('Playoff seeding game on Thursday.');
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Post in Team Chat?' })).toBeVisible();
  await page.keyboard.press('Escape');
  await goToStats(page);
  await expect(menuButton(page)).toBeVisible();
  await expect(dot(page)).toHaveCount(0);

  await switchTo(page, PLAYER);
  await expect(menuButton(page)).toHaveAccessibleDescription('2 new announcements');
});

test('captains fix a post: it says Edited, and teammates who read it don\'t see it as new again', async ({ page }) => {
  await signIn(page, PLAYER);
  await openAnnouncements(page);
  await expect(page.getByRole('button', { name: 'Announcement options' })).toHaveCount(0);

  await switchTo(page, CAPTAIN);
  await openAnnouncements(page);
  await postOptions(page, 'Team photo next game', 'Edit');
  const form = page.getByRole('dialog', { name: 'Edit announcement' });
  await expect(form.getByLabel('Title')).toHaveValue('Team photo next game');
  // Nothing to save until something changes.
  await expect(form.getByRole('button', { name: 'Save' })).toBeDisabled();
  await form.getByLabel('Message').fill('Wear your jersey and get there 20 minutes early.');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Announcement saved')).toBeVisible();
  await expect(form).toHaveCount(0);
  await expect(post(page, 'Team photo next game')).toContainText('20 minutes early');
  await expect(post(page, 'Team photo next game')).toContainText('· Edited');
  await expect(post(page, 'Welcome to the new team hub')).not.toContainText('Edited');

  await switchTo(page, PLAYER);
  await goToStats(page);
  await expect(menuButton(page)).not.toHaveAttribute('aria-describedby');
  await expect(dot(page)).toHaveCount(0);
});

test('deleting a post asks first, and says a Team Chat copy stays', async ({ page }) => {
  await signIn(page);
  await openAnnouncements(page);
  await postOptions(page, 'Team photo next game', 'Delete');
  const confirm = page.getByRole('dialog', { name: 'Delete announcement?' });
  await expect(confirm).toContainText("This can't be undone.");
  await expect(confirm).toContainText('If it was posted in Team Chat, that message stays.');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(post(page, 'Team photo next game')).toBeVisible();

  await postOptions(page, 'Team photo next game', 'Delete');
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Announcement deleted')).toBeVisible();
  await expect(post(page, 'Team photo next game')).toHaveCount(0);
  await expect(page.getByRole('article')).toHaveCount(1);
});

test("an edit that doesn't save says so and keeps what was typed", async ({ page }) => {
  await signIn(page);
  await openAnnouncements(page);
  await postOptions(page, 'Welcome to the new team hub', 'Edit');
  const form = page.getByRole('dialog', { name: 'Edit announcement' });
  await form.getByLabel('Title').fill('Welcome, Jive Turkeys');

  await page.evaluate(() => localStorage.setItem('jt_demo_offline', '1'));
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText("That didn't save")).toBeVisible();
  await expect(page.getByText('No connection. Check your signal and try again.')).toBeVisible();
  await expect(form.getByLabel('Title')).toHaveValue('Welcome, Jive Turkeys');

  await page.evaluate(() => localStorage.removeItem('jt_demo_offline'));
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Announcement saved')).toBeVisible();
  await expect(post(page, 'Welcome, Jive Turkeys')).toContainText('· Edited');
});
