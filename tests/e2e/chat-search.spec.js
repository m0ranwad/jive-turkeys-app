// Searching the chat: results from Team Chat and threads, and tapping one
// jumps to that message, loading further back if it's old. What the database
// search matches is checked in supabase/tests/chat.test.sql.
import { expect, message, openChat, openSearch, signIn, test } from './helpers';

const searchBox = (page) => page.getByRole('searchbox', { name: 'Search the chat' });

test('find a message in a thread and jump to it', async ({ page }) => {
  await signIn(page);
  await openChat(page);
  await openSearch(page);
  await searchBox(page).fill('fantasy');
  const result = page.getByRole('dialog', { name: 'Search the chat' }).getByRole('button', { name: /Starting a team fantasy league/ });
  await expect(result).toContainText('🏈 Fantasy football league');
  await expect(result.locator('mark')).toHaveText('fantasy');
  await result.click();
  await expect(page.getByRole('heading', { name: 'Fantasy football league' })).toBeVisible();
  await expect(message(page, 'Starting a team fantasy league')).toBeInViewport();
});

test('an old message is loaded and shown', async ({ page }) => {
  await signIn(page);
  // A long Team Chat history (sample data lives in this browser).
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('jt_demo_db_'));
    const db = JSON.parse(localStorage.getItem(key));
    const sam = db.player_profiles[2];
    for (let i = 1; i <= 150; i += 1) {
      const when = new Date(Date.now() - (3000 + i * 3) * 60000).toISOString();
      db.messages.push({
        id: crypto.randomUUID(), thread_id: null, reply_to_id: null, user_id: sam.user_id, author_name: sam.display_name,
        body: i === 140 ? 'The gate code is 4417' : `Old message #${i}`, created_date: when, updated_date: when,
      });
    }
    localStorage.setItem(key, JSON.stringify(db));
  });
  await page.reload();
  await openChat(page);
  await openSearch(page);
  await searchBox(page).fill('gate code');
  await page.getByRole('dialog', { name: 'Search the chat' }).getByRole('button', { name: /The gate code is 4417/ }).click();
  await expect(message(page, 'The gate code is 4417')).toBeInViewport();
});

test('nothing found says so', async ({ page }) => {
  await signIn(page);
  await openChat(page);
  await openSearch(page);
  await searchBox(page).fill('zzzz');
  await expect(page.getByText('Nothing found.')).toBeVisible();
});
