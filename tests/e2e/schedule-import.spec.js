import { fileURLToPath } from 'node:url';
import { expect, signIn, test } from './helpers';

test('the league PDF previews only our games and saves them in the year printed on the schedule', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import schedule' });
  await dialog.locator('input[type="file"]').setInputFiles(fileURLToPath(new URL('../fixtures/league-grid.pdf', import.meta.url)));
  await expect(dialog.getByText('7 rows ready for 2025–26 · Session 2')).toBeVisible();
  await expect(dialog.getByLabel('Game date').first()).toHaveValue('2026-01-03');
  await expect(dialog.getByLabel('Kickoff time').first()).toHaveValue('13:30');
  await expect(dialog.getByLabel('Field number').first()).toHaveValue('2');
  await expect(dialog.getByLabel('Opponent').first()).toHaveValue('TEST TEAM A');
  await expect(dialog.getByLabel('Game date').last()).toHaveValue('2026-02-21');
  await expect(dialog.getByLabel('Opponent').last()).toHaveValue('TEST TEAM D');
  await dialog.getByRole('button', { name: 'Confirm 7 games' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('7 games imported')).toBeVisible();
  await page.reload();
  const saved = await page.evaluate(() => Object.entries(localStorage)
    .filter(([key]) => /^jt_demo/.test(key))
    .flatMap(([, value]) => {
      try { return JSON.parse(value).games || []; } catch { return []; }
    }));
  // Verify persisted tags too; a correct date filed under the wrong season
  // would otherwise disappear from session lists and dues.
  expect(saved.filter((game) => game.opponent === 'TEST TEAM A')).toEqual([
    expect.objectContaining({ date: '2026-01-03', season_year: 2025, session: 2, time: '13:30', field_number: '2' }),
  ]);
});

test('a captain can correct rows, and an unreadable file leaves manual entry available', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import schedule' });
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-invalid') });
  await expect(dialog.getByText("That PDF couldn't be opened.", { exact: false })).toBeVisible();
  await expect(dialog.getByText('Invalid PDF structure')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Add a row' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Confirm 0 games' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Add a row' }).click();
  await dialog.getByLabel('Game date').fill('2026-11-07');
  await dialog.getByLabel('Kickoff time').fill('19:30');
  await dialog.getByLabel('Opponent').fill('Corrected opponent');
  await dialog.getByLabel('Field number').fill('2');
  await expect(dialog.getByRole('button', { name: 'Confirm 1 game' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Choose another file' }).click();
  await expect(dialog.getByRole('button', { name: 'Upload PDF, .xlsx or .csv' })).toBeVisible();
});
