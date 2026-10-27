// Posting in Team Chat from other screens: a game's Remind team and Call for
// subs, Remind who owes on Team dues, and announcements. The message shows
// first; it posts as you, @mentioning the teammates it names. docs/chat.md,
// section 2.
//
// Sample data: Drew Patel is the one teammate available to sub; he said MAYBE
// for the next game (vs Goal Diggers). Mike Russo is a roster name who hasn't
// joined the site.
import { expect, signIn, test } from './helpers';

// What a message saved with, from the preview's sample data.
async function savedMessage(page, text) {
  return page.evaluate((t) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('jt_demo_db_'));
    const db = JSON.parse(localStorage.getItem(key));
    const message = db.messages.find((m) => m.body.includes(t));
    const name = (id) => db.player_profiles.find((p) => p.user_id === id)?.display_name;
    return message && { thread: message.thread_id, mentions: (message.mentions || []).map(name), team: !!message.mentions_team };
  }, text);
}

test('a captain calls for subs in Team Chat, naming the available subs', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: /vs Goal Diggers/ }).click();
  await page.getByRole('button', { name: 'Call for subs' }).click();

  const dialog = page.getByRole('dialog', { name: 'Call for subs' });
  await expect(dialog.getByTestId('post-preview')).toContainText('Available to sub: @Drew P.');
  await expect(dialog).toContainText('1 teammate gets a buzz: Drew P.');
  await dialog.getByRole('button', { name: 'Post in Team Chat' }).click();
  await expect(page.getByText('Posted in Team Chat')).toBeVisible();
  await expect(dialog).toHaveCount(0);

  expect(await savedMessage(page, 'subs needed')).toEqual({ thread: null, mentions: ['Drew Patel'], team: false });
  await page.goto('/banter?room=team');
  await expect(page.getByText(/subs needed for/).last()).toBeVisible();
});

test("the game reminder names whoever hasn't answered, and roster names get a note", async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page);
  await page.getByRole('link', { name: /vs FC Lightning/ }).click();
  await page.getByRole('button', { name: 'Remind team' }).click();

  const dialog = page.getByRole('dialog', { name: 'Remind the team' });
  await expect(dialog.getByTestId('post-preview')).toContainText('@Jordan R.');
  await expect(dialog).toContainText("Dana Wells, Mike Russo aren't on the site yet");
  // Copy instead has plain names, for texting them.
  await dialog.getByRole('button', { name: 'Copy instead' }).click();
  await expect(page.getByText('Text it to Dana Wells, Mike Russo')).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('Jordan Rivera');
  expect(copied).not.toContain('@');
  expect(await savedMessage(page, 'vs FC Lightning · Field')).toBeUndefined();
});

test('anyone can post who still owes in Team Chat', async ({ page }) => {
  await signIn(page);
  await page.goto('/dues');
  await page.getByRole('tab', { name: 'Team dues' }).click();
  await page.getByRole('button', { name: 'Remind who owes' }).click();

  const dialog = page.getByRole('dialog', { name: 'Remind who owes' });
  await expect(dialog.getByTestId('post-preview')).toContainText('Still to pay: @Alex C. & @Riley N. ($122)');
  await dialog.getByRole('button', { name: 'Post in Team Chat' }).click();
  await expect(page.getByText('Posted in Team Chat')).toBeVisible();
  const saved = await savedMessage(page, 'Session 2 dues');
  expect(saved.mentions).toEqual(expect.arrayContaining(['Alex Chen', 'Riley Novak', 'Chris Dunn']));
  // You don't mention yourself.
  expect(saved.mentions).not.toContain('Casey Captain');
});

test('a new announcement can go straight into Team Chat with @team', async ({ page }) => {
  await signIn(page);
  await page.goto('/announcements');
  await page.getByRole('button', { name: 'New post' }).click();
  await page.getByLabel('Title').fill('Bring both jerseys');
  await page.getByLabel('Message').fill('Playoff seeding game on Thursday.');
  await page.getByRole('button', { name: 'Post', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Post in Team Chat?' });
  await expect(dialog.getByTestId('post-preview')).toContainText('@team 📣 Bring both jerseys');
  await expect(dialog).toContainText('Everyone with notifications on gets a buzz');
  await dialog.getByRole('button', { name: 'Post in Team Chat' }).click();
  await expect(page.getByText('Posted in Team Chat')).toBeVisible();
  expect(await savedMessage(page, 'Bring both jerseys')).toMatchObject({ thread: null, team: true });
});

test('players copy an announcement; only captains post it in Team Chat', async ({ page }) => {
  await signIn(page, 'jordan@demo.test');
  await page.goto('/announcements');
  await expect(page.getByRole('button', { name: 'Copy announcement' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Post in Team Chat' })).toHaveCount(0);
});
