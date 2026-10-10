// Team Chat: reading, sending, reactions, replies, deleting, and chats
// surviving a reload. See docs/chat.md for the expected behavior.
import { composer, expect, isPhone, message, messageRow, openChat, send, signIn, tapMessage, test } from './helpers';

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await openChat(page);
});

test('opens Team Chat at the New messages line', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Team Chat' })).toBeVisible();
  const line = page.getByText('New messages', { exact: true });
  await expect(line).toBeInViewport();
  // The first unread message (Morgan's) comes right after the line.
  const rows = page.locator('[data-unread-divider] ~ [data-message-id]');
  await expect(rows.first()).toContainText('Paid 💸');
  await expect(page.getByText('Morgan L.')).toBeVisible();
});

test('groups messages by sender and labels the day', async ({ page }) => {
  await expect(page.getByText('Yesterday', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Today', { exact: true })).toHaveCount(1);
  // Sam's two messages in a row show his name once.
  await expect(messageRow(page, 'Defense was locked in')).toContainText('Sam O.');
  await expect(messageRow(page, 'who grabbed my water bottle')).not.toContainText('Sam O.');
});

test('sends a message that is still there after a reload', async ({ page }) => {
  await send(page, 'See everyone Thursday!');
  await expect(composer(page)).toHaveValue('');
  await page.reload();
  await expect(message(page, 'See everyone Thursday!')).toBeVisible();
});

test('Enter sends on a computer, Shift+Enter starts a new line; phones use the Send button', async ({ page }, testInfo) => {
  const box = composer(page);
  await box.fill('Line one');
  await box.press('Shift+Enter');
  await box.pressSequentially('line two');
  await expect(box).toHaveValue('Line one\nline two');
  await box.press('Enter');
  if (isPhone(testInfo)) {
    await expect(box).toHaveValue('Line one\nline two\n');
    await page.getByRole('button', { name: 'Send' }).click();
  }
  await expect(message(page, 'line two')).toBeVisible();
  await expect(box).toHaveValue('');
});

test('the Send button only works with something to send', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
  await composer(page).fill('   ');
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
});

test('react to a message, see who reacted, and take it back', async ({ page }) => {
  await tapMessage(page, 'Running 10 min late');
  // Existing reactions list who left them.
  await expect(page.getByText('Alex C., Morgan L.')).toBeVisible();
  await page.getByRole('button', { name: 'React 🔥' }).click();

  const row = messageRow(page, 'Running 10 min late');
  const mine = row.getByRole('button', { name: '🔥 1, including you' });
  await expect(mine).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(mine).toBeVisible();

  await mine.click();
  await expect(row.getByRole('button', { name: /^🔥/ })).toHaveCount(0);
});

test('react with any emoji from the full picker', async ({ page }) => {
  await tapMessage(page, 'Paid 💸');
  await page.getByRole('button', { name: 'More reactions' }).click();
  await page.getByRole('button', { name: 'Game day' }).click();
  await page.getByRole('button', { name: '🏆', exact: true }).click();
  const row = messageRow(page, 'Paid 💸');
  await expect(row.getByRole('button', { name: '🏆 1, including you' })).toBeVisible();
});

test('tapping a reaction someone else left adds yours to the count', async ({ page }) => {
  const row = messageRow(page, 'Running 10 min late');
  await row.getByRole('button', { name: '😂 2' }).click();
  await expect(row.getByRole('button', { name: '😂 3, including you' })).toBeVisible();
});

test('reply quotes the original, and tapping the quote jumps to it', async ({ page }) => {
  await tapMessage(page, 'Who is bringing the pinnies this week?');
  await page.getByRole('button', { name: 'Reply' }).click();
  await expect(page.getByText('Replying to Jordan R.')).toBeVisible();
  await expect(composer(page)).toBeFocused();
  await send(page, 'I can grab extras');

  const reply = messageRow(page, 'I can grab extras');
  const quote = reply.getByRole('button', { name: /Jordan R\. Who is bringing the pinnies/ });
  await expect(quote).toBeVisible();
  await page.getByRole('log').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await quote.click();
  await expect(message(page, 'Who is bringing the pinnies this week?').first()).toBeInViewport();
});

test('jumping to a quoted message is not undone when a message finishes sending', async ({ page }) => {
  // Regression: a send finishing mid-jump used to snap the view back to the bottom.
  await tapMessage(page, 'Who is bringing the pinnies this week?');
  await page.getByRole('button', { name: 'Reply' }).click();
  await composer(page).fill('I can grab extras');
  // Hold time so the save can finish exactly when we choose.
  await page.clock.pauseAt(new Date('2026-10-08T13:00:00'));
  await page.getByRole('button', { name: 'Send' }).click();
  await page.clock.runFor(10); // the message shows up live; its save hasn't finished
  await expect(page.getByText('Sending…')).toHaveCount(0);

  const quote = messageRow(page, 'I can grab extras').getByRole('button', { name: /Jordan R\. Who is bringing the pinnies/ });
  await page.getByRole('log').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await quote.click();
  await page.clock.runFor(1000); // now the save finishes
  await page.clock.resume();
  await expect(message(page, 'Who is bringing the pinnies this week?').first()).toBeInViewport();
});

test('cancel a reply', async ({ page }) => {
  await tapMessage(page, 'Paid 💸');
  await page.getByRole('button', { name: 'Reply' }).click();
  await page.getByRole('button', { name: 'Cancel reply' }).click();
  await expect(page.getByText(/^Replying to/)).toHaveCount(0);
});

test('copy a message', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await tapMessage(page, 'Paid 💸');
  await page.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByText('Copied', { exact: true })).toBeVisible();
});

test('delete your own message; it stays gone after a reload', async ({ page }) => {
  await send(page, 'Oops, wrong chat');
  await tapMessage(page, 'Oops, wrong chat');
  await page.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete message?' });
  await expect(dialog).toContainText('removed for everyone');
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(message(page, 'Oops, wrong chat')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Paid 💸')).toBeVisible();
  await expect(message(page, 'Oops, wrong chat')).toHaveCount(0);
});

test('cancelling a delete keeps the message', async ({ page }) => {
  await tapMessage(page, 'Paid 💸');
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(message(page, 'Paid 💸')).toBeVisible();
});

test('a reply to a deleted message says so', async ({ page }) => {
  await tapMessage(page, 'Who is bringing the pinnies this week?');
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  const reply = messageRow(page, 'I got them');
  await expect(reply).toContainText('Original message was deleted');
});

test('the emoji button adds emoji to the message', async ({ page }) => {
  await composer(page).fill('Great game ');
  await page.getByRole('button', { name: 'Emoji' }).click();
  await page.getByRole('button', { name: 'Game day' }).click();
  await page.getByRole('button', { name: '🦃', exact: true }).click();
  await expect(composer(page)).toHaveValue('Great game 🦃');
});

test('links open in a new tab and long ones are shortened', async ({ page }) => {
  const link = page.getByRole('link', { name: /^google\.com\/maps\/search/ });
  await expect(link).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/search\//);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  await expect(link).toHaveText(/…$/);
});

test('emoji-only messages show big', async ({ page }) => {
  await expect(message(page, '🔥🔥🔥')).toHaveClass(/text-4xl/);
});

test('load earlier messages keeps your place', async ({ page }) => {
  // Give Team Chat a long history (sample data lives in this browser).
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('jt_demo_db_v7'));
    const sam = db.player_profiles[2];
    for (let i = 1; i <= 80; i += 1) {
      const when = new Date(Date.now() - (3000 + i * 3) * 60000).toISOString();
      db.messages.push({
        id: crypto.randomUUID(),
        thread_id: null,
        reply_to_id: null,
        user_id: sam.user_id,
        author_name: sam.display_name,
        body: `Old message #${81 - i}`,
        created_date: when,
        updated_date: when,
      });
    }
    localStorage.setItem('jt_demo_db_v7', JSON.stringify(db));
  });
  await page.reload();
  const log = page.getByRole('log');
  await expect(page.getByText('Paid 💸')).toBeVisible();
  await expect(log.locator('[data-message-id]')).toHaveCount(60);
  await log.evaluate((el) => (el.scrollTop = 0));
  const oldestShown = message(page, /^Old message #32$/);
  await expect(oldestShown).toBeInViewport();

  await page.getByRole('button', { name: 'Load earlier messages' }).click();
  await expect(log.locator('[data-message-id]')).toHaveCount(91);
  await expect(oldestShown).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Load earlier messages' })).toHaveCount(0);
  await log.evaluate((el) => (el.scrollTop = 0));
  await expect(message(page, /^Old message #1$/)).toBeVisible();
});

test('load earlier keeps your place even if reactions change while it loads', async ({ page }) => {
  // Regression: a reaction landing between tapping "Load earlier" and the older
  // messages arriving used to throw the view back to the very top.
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('jt_demo_db_v7'));
    const [sam, alex] = [db.player_profiles[2], db.player_profiles[4]];
    for (let i = 1; i <= 80; i += 1) {
      const when = new Date(Date.now() - (3000 + i * 3) * 60000).toISOString();
      const id = crypto.randomUUID();
      db.messages.push({
        id,
        thread_id: null,
        reply_to_id: null,
        user_id: sam.user_id,
        author_name: sam.display_name,
        body: `Old message #${81 - i}`,
        created_date: when,
        updated_date: when,
      });
      if (81 - i === 32)
        db.message_reactions.push({
          id: crypto.randomUUID(),
          message_id: id,
          user_id: alex.user_id,
          emoji: '👍',
          created_date: when,
          updated_date: when,
        });
    }
    localStorage.setItem('jt_demo_db_v7', JSON.stringify(db));
  });
  await page.reload();
  const log = page.getByRole('log');
  const anchor = messageRow(page, /^Old message #32$/);
  await expect(anchor.getByRole('button', { name: '👍 1' })).toBeVisible();
  await log.evaluate((el) => (el.scrollTop = 0));
  await expect(anchor).toBeInViewport();

  // Freeze time so the older messages can't arrive until we say so.
  await page.clock.pauseAt(new Date('2026-10-08T13:00:00'));
  await page.getByRole('button', { name: 'Load earlier messages' }).click();
  await anchor.getByRole('button', { name: '👍 1' }).click();
  await page.clock.runFor(2000);

  await expect(log.locator('[data-message-id]')).toHaveCount(91);
  await expect(anchor).toBeInViewport();
  await page.clock.resume();
});

test('the chat fills the screen with the message box above the tab bar', async ({ page }, testInfo) => {
  const box = await composer(page).boundingBox();
  const viewport = page.viewportSize();
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  if (isPhone(testInfo)) {
    const tabBar = await page.locator('[data-bottom-nav]').boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(tabBar.y);
  }
  // The page itself doesn't scroll; only the messages do.
  const scrolls = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 1);
  expect(scrolls).toBe(false);
});

test('the tip shows once', async ({ page }) => {
  await page.evaluate(() => localStorage.removeItem('jt_chat_tip_seen'));
  await page.reload();
  await expect(page.getByText(/tap any message to react, reply or copy it/)).toBeVisible();
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.getByText(/tap any message to react/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Paid 💸')).toBeVisible();
  await expect(page.getByText(/tap any message to react/)).toHaveCount(0);
});
