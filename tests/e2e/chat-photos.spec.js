// Photos in the chat: adding them (button or paste), sending with a caption or
// without, the progress bar, full screen with reactions, Reply and Delete, and
// what happens when sending fails. docs/chat.md lists the rules; who may upload,
// see and remove photos is checked in supabase/tests/chat-photos.test.sql.
import { readFileSync } from 'node:fs';
import { PLAYER, composer, expect, message, messageRow, openChat, signIn, test } from './helpers';

const PHOTO = 'public/chat-samples/standings.jpg';
const GIF = 'public/chat-samples/goal.gif';

const picker = (page) => page.getByTestId('photo-picker');
const tray = (page) => page.getByRole('list', { name: 'Photos to send' });
const viewer = (page) => page.getByRole('dialog');
const goOffline = (page) => page.evaluate(() => localStorage.setItem('jt_demo_offline', '1'));
const goOnline = (page) => page.evaluate(() => localStorage.removeItem('jt_demo_offline'));

/** The last message with photos in the room (sent ones are at the bottom). */
const lastPhotos = (page) => page.locator('[data-message-id]').filter({ has: page.locator('[data-photos]') }).last();

/** True once every picture in the element has loaded. */
const loaded = (locator) =>
  locator.locator('img').evaluateAll((imgs) => imgs.length > 0 && imgs.every((img) => img.complete && img.naturalWidth > 0));

async function addPhotos(page, files) {
  await picker(page).setInputFiles(files);
  await expect(tray(page).getByRole('img', { name: 'Photo to send' })).toHaveCount(files.length);
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await openChat(page);
});

test('sample photos show in Team Chat and open full screen', async ({ page }) => {
  // Jordan's GIF after her "Great win last night!"
  const gif = page.locator('[data-photos]', { hasText: 'GIF' });
  await expect(gif).toHaveCount(1);
  await expect.poll(() => loaded(gif)).toBe(true);

  const standings = messageRow(page, 'Standings after week 4');
  await standings.getByRole('button', { name: 'Open photo' }).click();
  const full = viewer(page);
  await expect(full.getByRole('heading', { name: 'Alex C.' })).toBeVisible();
  await expect(full.getByText('Standings after week 4 👀 2nd place, 3 points back')).toBeVisible();
  await expect.poll(() => loaded(full)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(full).toHaveCount(0);
});

test('send a photo with a caption: it shows right away with a progress bar, and stays after a reload', async ({ page }) => {
  await addPhotos(page, [PHOTO]);
  await expect(composer(page)).toHaveAttribute('placeholder', 'Add a caption (optional)');
  await composer(page).fill('Week 4 board');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByRole('progressbar', { name: 'Uploading' })).toBeVisible();
  await expect(tray(page)).toHaveCount(0);
  await expect(composer(page)).toHaveValue('');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByText('Sending…')).toHaveCount(0);
  const sent = messageRow(page, 'Week 4 board');
  await expect(sent.getByRole('button', { name: 'Open photo' })).toBeVisible();

  await page.reload();
  const again = messageRow(page, 'Week 4 board');
  await expect(again.getByRole('button', { name: 'Open photo' })).toBeVisible();
  await expect.poll(() => loaded(again)).toBe(true);
});

test('a photo without a caption has no bubble, and replies quote it as "📷 Photo"', async ({ page }) => {
  await addPhotos(page, [PHOTO]);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Sending…')).toHaveCount(0);
  const row = lastPhotos(page);
  await expect(row.locator('[role="button"][aria-expanded]')).toHaveCount(0);

  await row.getByRole('button', { name: 'Open photo' }).click();
  await viewer(page).getByRole('button', { name: 'Reply' }).click();
  await expect(viewer(page)).toHaveCount(0);
  await expect(page.getByText('Replying to yourself')).toBeVisible();
  await expect(composer(page)).toBeFocused();
  await composer(page).fill('Nice one');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(messageRow(page, 'Nice one').getByRole('button', { name: /📷 Photo/ })).toBeVisible();
});

test('several photos: a grid, and arrows between them full screen', async ({ page }) => {
  await addPhotos(page, [PHOTO, GIF]);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Sending…')).toHaveCount(0);
  const row = lastPhotos(page);
  await row.getByRole('button', { name: 'Open photo 2 of 2' }).click();
  await expect(viewer(page).getByText(/2 of 2/)).toBeVisible();
  await viewer(page).getByRole('button', { name: 'Next photo' }).click();
  await expect(viewer(page).getByText(/1 of 2/)).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(viewer(page).getByText(/2 of 2/)).toBeVisible();
});

test('react to a photo from full screen', async ({ page }) => {
  const standings = messageRow(page, 'Standings after week 4');
  await standings.getByRole('button', { name: 'Open photo' }).click();
  await viewer(page).getByRole('button', { name: 'React 😮' }).click();
  await expect(viewer(page).getByRole('button', { name: 'React 😮' })).toHaveAttribute('aria-pressed', 'true');
  await viewer(page).getByRole('button', { name: 'Close photo' }).click();
  await expect(standings.getByRole('button', { name: '😮 1, including you' })).toBeVisible();
});

test('delete your own photo from full screen, after a confirm', async ({ page }) => {
  await addPhotos(page, [GIF]);
  await composer(page).fill('Delete me');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Sending…')).toHaveCount(0);

  await expect.poll(() => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('jt_demo_photos_v1') || '{}')).length)).toBe(1);
  await messageRow(page, 'Delete me').getByRole('button', { name: 'Open photo' }).click();
  await viewer(page).getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete message?' });
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(message(page, 'Delete me')).toHaveCount(0);
  // Its file goes too (the preview keeps sent photos in the browser).
  await expect.poll(() => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('jt_demo_photos_v1') || '{}')).length)).toBe(0);
  await page.reload();
  await expect(message(page, 'Delete me')).toHaveCount(0);
});

test("players can reply to anyone's photo but only delete their own", async ({ page }) => {
  await signIn(page, PLAYER);
  await openChat(page);
  await messageRow(page, 'Standings after week 4').getByRole('button', { name: 'Open photo' }).click();
  await expect(viewer(page).getByRole('button', { name: 'Reply' })).toBeVisible();
  await expect(viewer(page).getByRole('button', { name: 'Delete' })).toHaveCount(0);
});

test('up to 4 photos in a message, and only pictures', async ({ page }) => {
  await picker(page).setInputFiles([PHOTO, PHOTO, PHOTO, GIF, GIF]);
  await expect(page.getByText('Up to 4 photos in one message')).toBeVisible();
  await expect(tray(page).getByRole('img', { name: 'Photo to send' })).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Add photos' })).toBeDisabled();
  await tray(page).getByRole('button', { name: 'Remove photo' }).first().click();
  await expect(tray(page).getByRole('img', { name: 'Photo to send' })).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Add photos' })).toBeEnabled();

  await picker(page).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a photo') });
  await expect(page.getByText("That isn't a photo")).toBeVisible();
  await expect(tray(page).getByRole('img', { name: 'Photo to send' })).toHaveCount(3);
});

test('a pasted picture is added to the message', async ({ page }) => {
  const gif = readFileSync(GIF).toString('base64');
  await composer(page).evaluate((box, data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const files = new DataTransfer();
    files.items.add(new File([bytes], 'goal.gif', { type: 'image/gif' }));
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: files, bubbles: true, cancelable: true }));
  }, gif);
  await expect(tray(page).getByRole('img', { name: 'Photo to send' })).toHaveCount(1);
  await expect(tray(page).getByText('GIF', { exact: true })).toBeVisible();
});

test('if a photo fails to send, it stays in the message box with its caption', async ({ page }) => {
  await addPhotos(page, [PHOTO]);
  await composer(page).fill('Try again');
  await goOffline(page);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText("That didn't send")).toBeVisible();
  await expect(page.getByText('No connection. Check your signal and try again.')).toBeVisible();
  await expect(composer(page)).toHaveValue('Try again');
  await expect(tray(page).getByRole('img', { name: 'Photo to send' })).toHaveCount(1);
  await expect(page.locator('[data-photos]').filter({ has: page.getByRole('progressbar') })).toHaveCount(0);

  await goOnline(page);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(messageRow(page, 'Try again').getByRole('button', { name: 'Open photo' })).toBeVisible();
  await expect(tray(page)).toHaveCount(0);
});
