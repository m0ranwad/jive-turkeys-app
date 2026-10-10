// Makes the site's icons from the logo drawing:
//   node scripts/make-icons.mjs [path/to/logo.svg]
// Default: the Jive Turkey with an Afro and a soccer ball (docs/design/jive-turkey/c6-just-the-ball.svg,
// drawn by docs/design/jive-turkey/classic.py). Uses the Chromium that Playwright already installs.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2] || join(root, 'docs/design/jive-turkey/c6-just-the-ball.svg');
const svg = readFileSync(source, 'utf8');

const ICONS = [
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-192.png', size: 192 },
  { file: 'apple-touch-icon.png', size: 180 }, // iOS rounds the corners itself
  { file: 'favicon.png', size: 64 }, // browser tab
  // Android crops "maskable" icons to a circle or other shape: keep the art inside the middle 80%.
  { file: 'icon-maskable-512.png', size: 512, scale: 0.8 },
  // The small icon in Android's status bar: only its shape shows, so white on transparent.
  { file: 'badge-96.png', size: 96, badge: true },
  { file: 'logo.jpg', size: 1024, type: 'image/jpeg' },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const icon of ICONS) {
  const dataUrl = await page.evaluate(
    async ({ svg, size, scale = 1, badge = false, type = 'image/png' }) => {
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
      await img.decode();
      const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, size, size);
      const art = size * scale;
      ctx.drawImage(img, (size - art) / 2, (size - art) / 2, art, art);
      if (badge) {
        // Bright parts become white, black becomes see-through.
        const pixels = ctx.getImageData(0, 0, size, size);
        const d = pixels.data;
        for (let i = 0; i < d.length; i += 4) {
          const alpha = Math.min(255, Math.max(d[i], d[i + 1], d[i + 2]) * 1.6);
          d[i] = d[i + 1] = d[i + 2] = 255;
          d[i + 3] = alpha;
        }
        ctx.putImageData(pixels, 0, 0);
      }
      return canvas.toDataURL(type, 0.92);
    },
    { svg, ...icon },
  );
  writeFileSync(join(root, 'public', icon.file), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`public/${icon.file}`);
}
await browser.close();
