// "Add to calendar" on an upcoming game: an .ics file for Apple Calendar,
// Outlook and most calendars, or Google Calendar. What the event says is checked in
// tests/unit/calendar.test.js.
import { expect, signIn, test } from './helpers';

test('players add an upcoming game to their calendar', async ({ page }) => {
  await signIn(page, 'jordan@demo.test');
  await page.getByRole('link', { name: /vs Goal Diggers/ }).filter({ hasNotText: 'Vote for Player of the Match' }).first().click();
  await page.getByRole('button', { name: 'Add to calendar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add to calendar' });

  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Apple Calendar, Outlook & others' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('jive-turkeys-vs-goal-diggers.ics');
  const text = await (await file.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString());
  expect(text).toContain('SUMMARY:Jive Turkeys vs Goal Diggers');

  await page.getByRole('button', { name: 'Add to calendar' }).click();
  await expect(dialog.getByRole('link', { name: 'Google Calendar' })).toHaveAttribute('href', /calendar\.google\.com.*Goal\+Diggers/);
});

test('games that were already played have no Add to calendar', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: /vs The Hat Tricks/ }).filter({ hasNotText: 'Vote for Player of the Match' }).first().click();
  await expect(page.getByRole('heading', { name: 'vs The Hat Tricks' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to calendar' })).toHaveCount(0);
});
