// Adding the site to a phone's Home Screen so it opens like an app.
import { expect, isPhone, signIn, test } from './helpers';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const card = (page) => page.getByRole('region', { name: 'Add to Home Screen' });
const guide = (page) => page.getByRole('dialog', { name: 'Add to your Home Screen' });

test('the site describes itself as an installable app with proper icons', async ({ page, request }) => {
  const manifest = await (await request.get('/manifest.json')).json();
  expect(manifest).toMatchObject({ short_name: 'Jive Turkeys', start_url: '/', scope: '/', display: 'standalone' });
  const sizes = manifest.icons.map((i) => `${i.sizes}:${i.purpose}`);
  expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));

  await page.goto('/login');
  for (const icon of [
    ...manifest.icons.map((i) => ({ src: i.src, size: Number(i.sizes.split('x')[0]) })),
    { src: '/apple-touch-icon.png', size: 180 },
  ]) {
    const size = await page.evaluate(
      (src) =>
        new Promise((resolve) =>
          Object.assign(new Image(), {
            onload() {
              resolve(this.naturalWidth);
            },
            onerror: () => resolve(0),
            src,
          }),
        ),
      icon.src,
    );
    expect(size, icon.src).toBe(icon.size);
  }
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.json');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png');
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Jive Turkeys');
});

test('the background helper installs, and never serves stale pages', async ({ page, request }) => {
  await page.goto('/login');
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(new URL(scope).pathname).toBe('/');
  // No fetch handler: pages and data always come straight from the site.
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).not.toMatch(/addEventListener\(\s*['"]fetch/);
});

test.describe('on a phone', () => {
  test.beforeEach(async ({}, testInfo) => test.skip(!isPhone(testInfo), 'phones only'));

  test('the Schedule page offers it once; Not now hides it for good', async ({ page }) => {
    await signIn(page);
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText('Get the app');
    await page.getByRole('link', { name: 'Chat', exact: true }).filter({ visible: true }).click();
    await expect(card(page)).toHaveCount(0);
    await page.getByRole('link', { name: 'Schedule', exact: true }).filter({ visible: true }).click();
    await card(page).getByRole('button', { name: 'Not now' }).click();
    await expect(card(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    // Still available from the menu.
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: 'Add to Home Screen' }).click();
    await expect(guide(page)).toBeVisible();
  });

  test('Android: menu steps, or a one-tap Install button when Chrome offers it', async ({ page }) => {
    await signIn(page);
    await card(page).getByRole('button', { name: 'How' }).click();
    await expect(guide(page)).toContainText('at the top right of Chrome');
    await guide(page).getByRole('button', { name: 'Close' }).click();

    // Chrome announces it can install the app.
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      event.prompt = () => (window.promptShown = true);
      event.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(event);
    });
    await card(page).getByRole('button', { name: 'How' }).click();
    await guide(page).getByRole('button', { name: 'Install Jive Turkeys' }).click();
    expect(await page.evaluate(() => window.promptShown)).toBe(true);
    await expect(guide(page)).toHaveCount(0);
  });

  test.describe('iPhone', () => {
    test.use({ userAgent: IPHONE_UA });

    test('shows the Share → Add to Home Screen steps', async ({ page }) => {
      await signIn(page);
      await card(page).getByRole('button', { name: 'How' }).click();
      await expect(guide(page)).toContainText('Tap the Share button');
      await expect(guide(page)).toContainText('Add to Home Screen');
      await expect(guide(page)).toContainText('sign in once more');
    });
  });

  test.describe('opened from the Home Screen', () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        const real = window.matchMedia.bind(window);
        window.matchMedia = (query) =>
          query.includes('display-mode: standalone')
            ? { matches: true, media: query, addEventListener() {}, removeEventListener() {} }
            : real(query);
      });
    });

    test('no longer offers to add it', async ({ page }) => {
      await signIn(page);
      await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
      await expect(card(page)).toHaveCount(0);
      await page.getByRole('button', { name: 'Menu' }).click();
      await expect(page.getByRole('button', { name: 'How to Use' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add to Home Screen' })).toHaveCount(0);
    });
  });
});

test('computers are not offered a Home Screen install', async ({ page }, testInfo) => {
  test.skip(isPhone(testInfo), 'computers only');
  await signIn(page);
  await expect(card(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('button', { name: 'Add to Home Screen' })).toHaveCount(0);
});
