import { expect, signIn, test } from './helpers';

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
