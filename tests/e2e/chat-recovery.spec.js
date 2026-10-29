import { chatTab, composer, expect, message, openChat, send, showRooms, signIn, test } from './helpers';

test.beforeEach(async ({ page }) => signIn(page));

test('a failed send stays available while typing the next message, survives refresh, and retries once', async ({ page }) => {
  await openChat(page);
  await page.evaluate(async () => {
    localStorage.setItem('jt_demo_offline', '1');
    const { api } = await import('/src/api/index.js');
    const create = api.entities.Message.create;
    api.entities.Message.create = async (row) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return create(row);
    };
  });
  await composer(page).fill('First message in bad signal');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await composer(page).fill('The next message I am typing');
  const failed = page.locator('[data-message-id]').filter({ hasText: 'First message in bad signal' });
  await expect(failed.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(composer(page)).toHaveValue('The next message I am typing');
  const id = await failed.getAttribute('data-message-id');
  await page.reload();
  await expect(composer(page)).toHaveValue('The next message I am typing');
  await expect(failed.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.removeItem('jt_demo_offline'));
  await failed.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(failed.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await expect(message(page, 'First message in bad signal')).toBeVisible();
  expect(await page.evaluate((messageId) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('jt_demo_db_'));
    return JSON.parse(localStorage.getItem(key)).messages.filter((m) => m.id === messageId).length;
  }, id)).toBe(1);
  await expect(composer(page)).toHaveValue('The next message I am typing');
});

test('a message whose confirmation was lost is confirmed without sending a duplicate', async ({ page }) => {
  await openChat(page);
  await page.evaluate(async () => {
    const { api } = await import('/src/api/index.js');
    const create = api.entities.Message.create;
    api.entities.Message.create = async (row) => { await create(row); throw new TypeError('Failed to fetch'); };
    api.entities.Message.filter = async () => { throw new TypeError('Failed to fetch'); };
  });
  await send(page, 'Saved despite the lost response');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await expect(page.getByText("That didn't send", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('jt_demo_db_'));
    return JSON.parse(localStorage.getItem(key)).messages.filter((m) => m.body === 'Saved despite the lost response').length;
  })).toBe(1);
});

test('a failed reply still shows its older original after refreshing beyond the latest history page', async ({ page }) => {
  await openChat(page);
  await message(page, 'Who is bringing the pinnies this week?').click();
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await page.evaluate(() => localStorage.setItem('jt_demo_offline', '1'));
  await composer(page).fill('Keep this reply and its original');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  // A busy room: after a refresh, the quoted original is older than the newest 60 messages.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('jt_demo_db_'));
    const db = JSON.parse(localStorage.getItem(key));
    const sam = db.player_profiles.find((p) => p.display_name.startsWith('Sam'));
    for (let i = 0; i < 70; i += 1) {
      const when = new Date(Date.now() + i * 1000).toISOString();
      db.messages.push({ id: crypto.randomUUID(), user_id: sam.user_id, author_name: sam.display_name, body: `Newer message ${i}`, thread_id: null, reply_to_id: null, created_date: when, updated_date: when });
    }
    localStorage.setItem(key, JSON.stringify(db));
  });
  await page.reload();
  const failed = page.locator('[data-message-id]').filter({ hasText: 'Keep this reply and its original' });
  await expect(failed.getByRole('button', { name: /Jordan R\. Who is bringing the pinnies/ })).toBeVisible();
  await expect(failed.getByText('Original message was deleted', { exact: true })).toHaveCount(0);
});

test('removing a failed message removes only the unsent copy and keeps the next draft', async ({ page }) => {
  await openChat(page);
  await page.evaluate(() => localStorage.setItem('jt_demo_offline', '1'));
  await composer(page).fill('Discard this unsent message');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const failed = page.locator('[data-message-id]').filter({ hasText: 'Discard this unsent message' });
  await expect(failed.getByRole('button', { name: 'Remove', exact: true })).toBeVisible();
  await composer(page).fill('Keep this draft');
  await failed.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.reload();
  await expect(composer(page)).toHaveValue('Keep this draft');
  await expect(message(page, 'Discard this unsent message')).toHaveCount(0);
});

test('failed history looks different from an empty room and offers a working retry', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('jt_demo_fail_reads', 'messages'));
  await chatTab(page).click();
  await showRooms(page);
  await page.locator('[data-room="team"]').click();
  await expect(page.getByText("Messages didn't load", { exact: true })).toBeVisible();
  await expect(page.getByText('No messages yet. Break the ice.', { exact: true })).toHaveCount(0);
  await page.evaluate(() => localStorage.removeItem('jt_demo_fail_reads'));
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(message(page, 'Paid 💸')).toBeVisible();
});

test('the room list can be retried after loading fails', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('jt_demo_fail_reads', 'chat_threads'));
  await chatTab(page).click();
  await expect(page.getByText("Chats didn't load", { exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.removeItem('jt_demo_fail_reads'));
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('[data-room]', { hasText: 'Sunday pickup?' })).toBeVisible();
});

test('drafts stay with their room after refresh and are cleared when signing out', async ({ page }) => {
  await openChat(page);
  await composer(page).fill('A team-only draft');
  await page.reload();
  await expect(composer(page)).toHaveValue('A team-only draft');
  await showRooms(page);
  await page.locator('[data-room]', { hasText: 'Sunday pickup?' }).click();
  await expect(composer(page)).toHaveValue('');
  await composer(page).fill('A pickup-only draft');
  await openChat(page);
  await expect(composer(page)).toHaveValue('A team-only draft');
  await page.getByRole('link', { name: /^My profile/ }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in as a player', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Schedule', exact: true })).toBeVisible();
  await openChat(page);
  await expect(composer(page)).toHaveValue('');
});

test('editing the latest message updates its preview right away', async ({ page }) => {
  await openChat(page);
  await send(page, 'Kickoff is at 7');
  await message(page, 'Kickoff is at 7').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await composer(page).fill('Kickoff is at 8');
  await page.getByRole('button', { name: 'Save edit', exact: true }).click();
  await expect(message(page, 'Kickoff is at 8')).toBeVisible();
  await showRooms(page);
  await expect(page.locator('[data-room="team"]')).toContainText('You: Kickoff is at 8');
});
