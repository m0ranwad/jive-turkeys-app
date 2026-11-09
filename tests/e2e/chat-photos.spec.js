// Photos in chat: the Photo button picks an image, optional caption, upload, then send.
// Previews keep upload bytes in memory for this visit; sample photos survive a reload.
// The live site uses chat-media Storage. docs/chat.md section 9.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, openChat, signIn, tapMessage, test } from './helpers';

const fixtures = path.dirname(fileURLToPath(import.meta.url));
const PHOTO = path.join(fixtures, 'fixtures', 'chat-photo.png');

const photos = (page) => page.locator('[data-message-id] img[data-photo]');
const captionBox = (page) => page.getByRole('textbox', { name: 'Caption' });
const messageBox = (page) => page.getByRole('textbox', { name: 'Message' });

async function pickPhoto(page) {
  // Set the file on the hidden input (don't open the OS picker).
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles(PHOTO);
  await expect(page.getByText('Photo ready')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await openChat(page);
});

test('sends a photo with a caption; the caption survives a reload', async ({ page }) => {
  // Sample data already has one standings photo.
  await expect(photos(page).first()).toBeVisible();
  const before = await photos(page).count();

  await pickPhoto(page);
  await captionBox(page).fill('Look at this!');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(page.getByText('Sending…')).toHaveCount(0);
  await expect(photos(page)).toHaveCount(before + 1);
  await expect(page.getByRole('button', { name: 'Photo: Look at this!' })).toBeVisible();
  await page.reload();
  // Sample photos and the message stay; demo upload bytes are in-memory for this visit only.
  await expect(photos(page).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Photo: Look at this!' })).toBeVisible();
});

test('sends a photo with no caption as "Photo", and opens full screen', async ({ page }) => {
  await expect(photos(page).first()).toBeVisible();
  const before = await photos(page).count();
  await pickPhoto(page);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Sending…')).toHaveCount(0);
  await expect(photos(page)).toHaveCount(before + 1);

  const row = page.locator('[data-message-id]').filter({ has: page.locator('img[data-photo]') }).last();
  // One tap on the photo opens it full screen, without selecting the message.
  await row.getByRole('button', { name: 'View photo' }).click();
  const viewer = page.getByRole('dialog', { name: 'Photo' });
  await expect(viewer).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close photo' }).click();
  await expect(viewer).toHaveCount(0);

  // Options in the viewer shows the message's actions.
  await row.getByRole('button', { name: 'View photo' }).click();
  await viewer.getByRole('button', { name: 'Options' }).click();
  await expect(viewer).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reply', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(viewer).toBeVisible();
});

test('tapping beside a photo shows its options', async ({ page }) => {
  await expect(photos(page).first()).toBeVisible();
  const row = page.locator('[data-message-id]').filter({ has: page.locator('img[data-photo]') }).first();
  await row.locator('[data-message-gutter]').click();
  await expect(page.getByRole('button', { name: 'Reply', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Photo' })).toHaveCount(0);
});

test('a long press on a photo shows its options', async ({ page }) => {
  await expect(photos(page).first()).toBeVisible();
  const row = page.locator('[data-message-id]').filter({ has: page.locator('img[data-photo]') }).first();
  const thumb = row.getByRole('button', { name: 'View photo' });
  await thumb.scrollIntoViewIfNeeded();
  const box = await thumb.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Reply', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Photo' })).toHaveCount(0);
});

test('pasting a copied photo into the message box attaches it', async ({ page }) => {
  await expect(photos(page).first()).toBeVisible();
  const before = await photos(page).count();
  const bytes = [...(await import('node:fs')).readFileSync(PHOTO)];
  await messageBox(page).click();
  await messageBox(page).evaluate((box, data) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(data)], 'image.png', { type: 'image/png' }));
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, bytes);
  await expect(page.getByText('Photo ready')).toBeVisible();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Sending…')).toHaveCount(0);
  await expect(photos(page)).toHaveCount(before + 1);
});

test('the Photo button hides while editing', async ({ page }) => {
  await messageBox(page).fill('Typo hree');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Typo hree', exact: true })).toBeVisible();
  await tapMessage(page, 'Typo hree');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Photo', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'GIF', exact: true })).toHaveCount(0);
});
