// GIFs in chat: the GIF button searches GIFs and tapping one sends it right away.
// Previews find pretend GIFs (public/demo-gifs/); the live site searches KLIPY.
// docs/chat.md section 8.
import { composer, expect, openChat, send, signIn, tapMessage, test } from './helpers';

const gifs = (page) => page.locator('[data-message-id] img[data-gif]');

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await openChat(page);
});

test("searches GIFs (trending first) and sends one with a tap, still there after a reload", async ({ page }) => {
  const before = await gifs(page).count();
  await page.getByRole('button', { name: 'GIF', exact: true }).click();
  const search = page.getByRole('region', { name: 'GIF search' });
  await expect(search).toContainText('Trending');
  await expect(search).toContainText('Powered by KLIPY');
  await expect(search.getByRole('button', { name: /^Send GIF:/ }).first()).toBeVisible();

  await search.getByRole('searchbox', { name: 'Search GIFs' }).fill('zzzz');
  await expect(search).toContainText('No GIFs for "zzzz".');
  await search.getByRole('searchbox', { name: 'Search GIFs' }).fill('goal');
  await search.getByRole('button', { name: 'Send GIF: Goal!' }).click();

  await expect(search).toHaveCount(0);
  await expect(gifs(page)).toHaveCount(before + 1);
  await expect(gifs(page).last()).toHaveAttribute('src', '/demo-gifs/goal.gif');
  await expect(page.getByText('Sending…')).toHaveCount(0);
  await page.reload();
  await expect(gifs(page)).toHaveCount(before + 1);
});

test("a GIF can be replied to, reacted to and deleted, but not edited or copied", async ({ page }) => {
  await send(page, 'Who scored the winner?');
  await tapMessage(page, 'Who scored the winner?');
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await page.getByRole('button', { name: 'GIF', exact: true }).click();
  await page.getByRole('region', { name: 'GIF search' }).getByRole('searchbox').fill('turkey');
  await page.getByRole('button', { name: 'Send GIF: Turkey dance' }).click();

  const row = page.locator('[data-message-id]').filter({ has: page.locator('img[data-gif]') }).last();
  // Sent as a reply to the question.
  await expect(row).toContainText('Who scored the winner?');
  await expect(page.getByText('Sending…')).toHaveCount(0);
  await row.getByRole('button', { name: 'GIF: Turkey dance' }).click();
  await expect(page.getByRole('button', { name: 'Reply', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'React 😂' }).click();
  await expect(row.getByRole('button', { name: /^😂 1/ })).toBeVisible();
});

test('the GIF button hides while editing, and the search closes without sending', async ({ page }) => {
  await page.getByRole('button', { name: 'GIF', exact: true }).click();
  await page.getByRole('button', { name: 'Close GIF search' }).click();
  await expect(page.getByRole('region', { name: 'GIF search' })).toHaveCount(0);
  await expect(composer(page)).toBeFocused();

  await send(page, 'Typo hree');
  await tapMessage(page, 'Typo hree');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'GIF', exact: true })).toHaveCount(0);
});

test("says so when GIFs can't load, and tries again", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('jt_demo_offline', '1'));
  await page.getByRole('button', { name: 'GIF', exact: true }).click();
  const search = page.getByRole('region', { name: 'GIF search' });
  await expect(search).toContainText("Couldn't load GIFs. Check your signal and try again.");
  await expect(search.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.evaluate(() => localStorage.removeItem('jt_demo_offline'));
  await search.getByRole('button', { name: 'Try again' }).click();
  await expect(search.getByRole('button', { name: /^Send GIF:/ }).first()).toBeVisible();
});
