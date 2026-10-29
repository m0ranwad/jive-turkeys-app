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

test('search opens directly from an open conversation', async ({ page }) => {
  await signIn(page);
  await openChat(page);
  await page.getByRole('button', { name: 'Search messages', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Search the chat' })).toBeVisible();
  await searchBox(page).fill('parking');
  await expect(page.getByRole('dialog').getByRole('button', { name: /Parking tip/ })).toBeVisible();
});

test('changing a query clears its old matches and a late result cannot replace the current search', async ({ page }) => {
  await signIn(page);
  await openChat(page);
  await openSearch(page);
  await searchBox(page).fill('parking');
  const old = page.getByRole('dialog').getByRole('button', { name: /Parking tip/ });
  await expect(old).toBeVisible();
  await page.evaluate(async () => {
    const { api } = await import('/src/api/index.js');
    const search = api.chat.search;
    window.resolveSearch = {};
    api.chat.search = (query) => new Promise((resolve) => { window.resolveSearch[query] = async () => resolve(await search(query)); });
  });
  await searchBox(page).fill('dues');
  await expect(page.getByText('Searching…', { exact: true })).toBeVisible();
  await expect(old).toHaveCount(0);
  await page.waitForFunction(() => window.resolveSearch.dues);
  await searchBox(page).fill('zzzz');
  await page.waitForFunction(() => window.resolveSearch.zzzz);
  await page.evaluate(() => window.resolveSearch.zzzz());
  await expect(page.getByText('Nothing found.', { exact: true })).toBeVisible();
  await page.evaluate(() => window.resolveSearch.dues());
  await expect(page.getByText('Nothing found.', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: /dues for session/ })).toHaveCount(0);
});
