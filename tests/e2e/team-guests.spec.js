// Teammates who aren't on the app are on the Team page roster with everyone
// else: captains add them, set their status, edit them, move them to their
// account when they join, or take them off the team. Their roster status
// decides whether they split the dues, like everyone else's.
// The database enforces who can do what (supabase/tests/dues.test.sql).
import { expect, signIn, test } from './helpers';

// Mike Russo (man, Defense) and Dana Wells (woman, Forward) are Active and not on the app in the sample data.
async function openTeam(page) {
  await page.locator('a[href="/team"]:visible').first().click();
  await expect(page.getByRole('heading', { name: 'Team', exact: true })).toBeVisible();
}

async function openDues(page) {
  await page.locator('a[href="/dues"]:visible').first().click();
  await expect(page.getByRole('heading', { name: 'Dues', exact: true })).toBeVisible();
}

const card = (page, name) => page.locator('div.rounded-3xl', { hasText: name }).filter({ has: page.getByText(name, { exact: true }) }).last();

test('everyone sees teammates who are not on the app on the roster, in the counts', async ({ page }) => {
  await signIn(page, 'jordan@demo.test');
  await openTeam(page);
  // 10 active app players plus Mike and Dana.
  await expect(page.getByText('12 active · 2 subs (incl. on break)')).toBeVisible();
  await expect(card(page, 'Mike Russo')).toContainText('Not on the app');
  await expect(card(page, 'Dana Wells')).toContainText('Forward');
  // Players can't change them.
  await expect(page.getByRole('button', { name: 'Edit Mike Russo' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add teammate not on the app' })).toHaveCount(0);
});

test('a captain adds a teammate not on the app, and they split the dues', async ({ page }) => {
  await signIn(page);
  await openTeam(page);
  await page.getByRole('button', { name: 'Add teammate not on the app' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add teammate not on the app' });
  await dialog.getByLabel('Name').fill('Pat Lee');
  await dialog.getByRole('button', { name: 'Woman' }).click();
  await dialog.getByLabel('Position').selectOption('Goalie');
  await dialog.getByRole('button', { name: 'Add to the team' }).click();
  await expect(page.getByText('Pat Lee added to the team')).toBeVisible();
  await expect(page.getByText('13 active · 2 subs (incl. on break)')).toBeVisible();
  await expect(card(page, 'Pat Lee')).toContainText('Goalie');

  // $721 across 13: $55.46, rounded up.
  await openDues(page);
  await expect(page.getByText('$56 each')).toBeVisible();
  await expect(page.getByTestId('dues-unpaid')).toContainText('Pat Leenot on the app');
});

test("a captain's status change takes a teammate not on the app out of the split", async ({ page }) => {
  await signIn(page);
  await openTeam(page);
  await card(page, 'Mike Russo').getByRole('button', { name: 'Sub Pool' }).click();
  await expect(page.getByText('Mike Russo marked Sub Pool')).toBeVisible();
  await expect(page.getByText('11 active · 3 subs (incl. on break)')).toBeVisible();

  // $721 across 11: $65.55, rounded up.
  await openDues(page);
  await expect(page.getByText('$66 each')).toBeVisible();
  await expect(page.getByText('Mike Russo')).toHaveCount(0);
});

test('a captain moves a teammate who joined the app to their account', async ({ page }) => {
  await signIn(page);
  await openDues(page);
  await page.getByRole('button', { name: 'Mark Mike Russo paid' }).click();
  await expect(page.getByRole('heading', { name: '7 of 12 paid' })).toBeVisible();

  // Say Mike joined the app as Chris Dunn: his payment and history move to that account.
  await openTeam(page);
  await page.getByRole('button', { name: 'Edit Mike Russo' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mike Russo' });
  await dialog.getByLabel('Joined the app?').selectOption({ label: 'Chris Dunn' });
  await dialog.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(dialog).toContainText("Mike Russo's dues payments and history move to Chris Dunn's account");
  await dialog.getByRole('button', { name: 'Move them' }).click();
  await expect(page.getByText("Mike Russo moved to Chris Dunn's account")).toBeVisible();
  await expect(page.getByText('11 active · 2 subs (incl. on break)')).toBeVisible();
  await expect(page.getByText('Mike Russo', { exact: true })).toHaveCount(0);

  await openDues(page);
  await expect(page.getByRole('heading', { name: '7 of 11 paid' })).toBeVisible();
  await expect(page.getByTestId('dues-paid')).toContainText('Chris Dunn');
  await expect(page.locator('section', { hasText: 'Recent changes' })).toContainText('You marked Chris D. paid');
});

test('a captain edits a teammate not on the app, removes them, and adds them back', async ({ page }) => {
  await signIn(page);
  await openTeam(page);
  await page.getByRole('button', { name: 'Edit Dana Wells' }).click();
  const dialog = page.getByRole('dialog', { name: 'Dana Wells' });
  await dialog.getByLabel('Name').fill('Dana Wells-Ortiz');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(card(page, 'Dana Wells-Ortiz')).toContainText('Not on the app');

  await page.getByRole('button', { name: 'Edit Dana Wells-Ortiz' }).click();
  const edit = page.getByRole('dialog', { name: 'Dana Wells-Ortiz' });
  await edit.getByRole('button', { name: 'Remove from the team' }).click();
  await expect(edit).toContainText('comes off the roster and out of the dues split');
  await edit.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText('Dana Wells-Ortiz removed from the team')).toBeVisible();
  await expect(page.getByText('11 active · 2 subs (incl. on break)')).toBeVisible();

  await page.getByRole('button', { name: 'Add teammate not on the app' }).click();
  const add = page.getByRole('dialog', { name: 'Add teammate not on the app' });
  await add.getByRole('button', { name: 'Add back' }).click();
  await expect(page.getByText('Dana Wells-Ortiz added back')).toBeVisible();
  await expect(page.getByText('12 active · 2 subs (incl. on break)')).toBeVisible();
});
