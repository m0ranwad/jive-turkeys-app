// Screen heights. On iPhones, vh (and Tailwind's h-screen) counts the screen under Safari's toolbar, so a
// popup sized with it hid its bottom and buttons there, and the chat's page scrolled under the toolbar. dvh
// is the part of the screen you can see. docs/chat.md section 2.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const sourceFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(jsx?|css)$/.test(entry.name) ? [path] : [];
  });

it('screen heights use the part of the screen you can see (dvh), never vh', () => {
  const found = sourceFiles('src').flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .map((line, i) => [line, i])
      .filter(([line]) => /\d(\.\d+)?vh\b|\b(min-|max-)?h-screen\b/.test(line))
      .map(([line, i]) => `${file}:${i + 1}: ${line.trim()}`),
  );
  expect(found).toEqual([]);
});
