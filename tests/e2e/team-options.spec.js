import { expect, playerOptions, signIn, test } from './helpers';

for (const name of ['Jordan Rivera', 'Mike Russo']) {
  test(`keyboard focus enters ${name}'s options and stays inside`, async ({ page }) => {
    // Keyboard behavior doesn't depend on external fonts.
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
    );
    await signIn(page);
    await page.locator('a[href="/team"]:visible').first().click();
    const trigger = page.locator(`button[data-options-for="${name}"]`);
    await trigger.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name, exact: true });
    const playing = dialog.getByRole('button', { name: 'Playing', exact: true });
    await expect(dialog).toBeVisible();
    await expect(playing).toBeFocused();

    // Both directions wrap inside the window instead of reaching the page behind it.
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(playing).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Available to sub', exact: true })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
}

// Jamie Fox (Forward) is Unavailable in the sample data, Drew Patel (Defense) is Available to sub,
// and Riley Novak hasn't picked a position.
test("Unavailable players aren't on the field, and come back when they're playing again", async ({ page }) => {
  await signIn(page);
  await page.locator('a[href="/team"]:visible').first().click();
  const field = page.locator('section').filter({ has: page.getByRole('heading', { name: 'On the field' }) });
  await expect(field).toContainText('Alex Chen');
  await expect(field).toContainText('Drew Patel');
  await expect(field).not.toContainText('Jamie Fox');
  await expect(page.locator('[data-status-group="on_break"]')).toContainText('Jamie Fox');

  // Unavailable: off the field, from their position and from the floaters.
  await (await playerOptions(page, 'Alex Chen')).getByRole('button', { name: 'Unavailable' }).click();
  await expect(page.getByText('Alex Chen marked Unavailable')).toBeVisible();
  await page.keyboard.press('Escape');
  await (await playerOptions(page, 'Riley Novak')).getByRole('button', { name: 'Unavailable' }).click();
  await expect(page.getByText('Riley Novak marked Unavailable')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(field).not.toContainText('Alex Chen');
  await expect(field).not.toContainText('Riley Novak');
  await expect(page.getByTestId('floaters')).toContainText('Chris Dunn');

  // Playing again: back at their position.
  await (await playerOptions(page, 'Jamie Fox')).getByRole('button', { name: 'Playing', exact: true }).click();
  await expect(page.getByText('Jamie Fox marked Playing')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(field).toContainText('Jamie Fox');
});
