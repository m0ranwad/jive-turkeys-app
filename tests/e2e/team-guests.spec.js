// Captains put the whole team on the roster by name; players who haven't
// joined yet show as grey cards until they sign up and pick their name.
// Captains set their status, edit them, link an account, or take them off the
// team. Their roster status decides whether they split the dues, like
// everyone else's.
// The database enforces who can do what (supabase/tests/dues.test.sql).
import { expect, signIn, test } from './helpers';

// Mike Russo (man, Defense) and Dana Wells (woman, Forward) are Active and haven't joined yet in the sample data.
async function openTeam(page) {
  await page.locator('a[href="/team"]:visible').first().click();
  await expect(page.getByRole('heading', { name: 'Team', exact: true })).toBeVisible();
}

async function openDues(page) {
  await page.locator('a[href="/dues"]:visible').first().click();
  await expect(page.getByRole('heading', { name: 'Dues', exact: true })).toBeVisible();
}

const card = (page, name) => page.locator('div.rounded-3xl', { hasText: name }).filter({ has: page.getByText(name, { exact: true }) }).last();

test('everyone sees players who have not joined yet as grey cards, in the counts, with an invite to copy', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page, 'jordan@demo.test');
  await openTeam(page);
  // 10 active app players plus Mike and Dana.
  await expect(page.getByText('12 active · 2 subs (incl. on break) · 2 not joined yet')).toBeVisible();
  await expect(card(page, 'Mike Russo')).toContainText('Not joined yet');
  await expect(card(page, 'Mike Russo')).toHaveClass(/border-dashed/);
  await expect(card(page, 'Dana Wells')).toContainText('Forward');
  // Players can't change them.
  await expect(page.getByRole('button', { name: 'Edit Mike Russo' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add players to the roster' })).toHaveCount(0);

  const notJoined = page.getByTestId('not-joined');
  await expect(notJoined).toContainText("2 haven't joined yet");
  // Players on the site come first; everyone still to join is listed under the invite.
  await expect(page.getByText('On the site · 12')).toBeVisible();
  const top = async (locator) => (await locator.boundingBox()).y;
  expect(await top(card(page, 'Kelly Moss'))).toBeLessThan(await top(notJoined));
  expect(await top(card(page, 'Dana Wells'))).toBeGreaterThan(await top(notJoined));
  expect(await top(card(page, 'Mike Russo'))).toBeGreaterThan(await top(notJoined));
  await notJoined.getByRole('button', { name: 'Copy invite' }).click();
  await expect(page.getByText('Invite copied')).toBeVisible();
  const invite = await page.evaluate(() => navigator.clipboard.readText());
  expect(invite).toContain("You're on the Jive Turkeys roster!");
  expect(invite).toContain('pick your name from the list');
  expect(invite).toContain('Still to join: Dana Wells, Mike Russo');
});

test('a captain adds several players at once, and they split the dues', async ({ page }) => {
  await signIn(page);
  await openTeam(page);
  await page.getByRole('button', { name: 'Add players to the roster' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add players to the roster' });
  await dialog.getByLabel('Names').fill('Pat Lee\n\nSam Ortiz\nmike russo\nPat Lee');
  await expect(dialog).toContainText('Already on the roster, so skipped: mike russo');
  await dialog.getByRole('button', { name: 'Add 2 players' }).click();
  await expect(page.getByText('2 players added to the roster')).toBeVisible();
  await expect(page.getByText('14 active · 2 subs (incl. on break) · 4 not joined yet')).toBeVisible();
  await expect(card(page, 'Pat Lee')).toContainText('Not joined yet');
  // They haven't picked a position, so they aren't listed as floaters on the field (Riley and Chris are).
  await expect(page.getByText('Floaters · none chosen · 2')).toBeVisible();

  // Man / woman and position can be set with Edit (or by them when they join).
  await page.getByRole('button', { name: 'Edit Pat Lee' }).click();
  const edit = page.getByRole('dialog', { name: 'Pat Lee' });
  await edit.getByRole('button', { name: 'Woman' }).click();
  await edit.getByLabel('Position').selectOption('Goalie');
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card(page, 'Pat Lee')).toContainText('Goalie');

  // $721 across 14: $51.50, rounded up.
  await openDues(page);
  await expect(page.getByText('$52 each')).toBeVisible();
  await expect(page.getByTestId('dues-unpaid')).toContainText('Pat Leenot joined yet');
});

test('pasting someone already on the app under a different name asks before counting them twice', async ({ page }) => {
  await signIn(page);
  await openTeam(page);
  await page.getByRole('button', { name: 'Add players to the roster' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add players to the roster' });
  await dialog.getByLabel('Names').fill(['Jamie F.', 'Kelly', 'Kelly Martin', 'Mike R', 'X'.repeat(61)].join('\n'));
  const lookalikes = dialog.getByTestId('lookalikes');
  await expect(lookalikes).toContainText('Jamie F. looks like Jamie Fox');
  await expect(lookalikes).toContainText('Kelly looks like Kelly Moss');
  await expect(lookalikes).toContainText('Mike R looks like Mike Russo');
  await expect(dialog).toContainText(`Too long (60 letters at most): ${'X'.repeat(61)}`);
  // Only Kelly Martin is new, unless they really are different people.
  await expect(dialog.getByRole('button', { name: 'Add to the roster' })).toBeEnabled();
  await lookalikes.getByLabel("They're different people. Add them too.").check();
  await dialog.getByRole('button', { name: 'Add 4 players' }).click();
  await expect(page.getByText('4 players added to the roster')).toBeVisible();
  await expect(page.getByText('16 active · 2 subs (incl. on break) · 6 not joined yet')).toBeVisible();
  await expect(card(page, 'Jamie F.')).toContainText('Not joined yet');
});

test('a captain sees when someone on the roster probably joined under a fuller name', async ({ page }) => {
  await signIn(page);
  await openTeam(page);
  // Say the roster said "Chris D" and Chris joined as Chris Dunn without picking it.
  await page.getByRole('button', { name: 'Add players to the roster' }).click();
  const add = page.getByRole('dialog', { name: 'Add players to the roster' });
  await add.getByLabel('Names').fill('Chris D');
  await add.getByTestId('lookalikes').getByLabel("They're different people. Add them too.").check();
  await add.getByRole('button', { name: 'Add to the roster' }).click();
  await expect(card(page, 'Chris D')).toContainText('Joined as Chris Dunn? Tap Edit to move this spot to their account.');

  await page.getByRole('button', { name: 'Edit Chris D' }).click();
  const edit = page.getByRole('dialog', { name: 'Chris D' });
  await expect(edit.getByLabel('Joined without picking their name?')).toHaveValue(/.+/);
  await expect(edit.getByLabel('Joined without picking their name?').locator('option:checked')).toHaveText('Chris Dunn');
  await edit.getByRole('button', { name: 'Move', exact: true }).click();
  await edit.getByRole('button', { name: 'Move them' }).click();
  await expect(page.getByText("Chris D moved to Chris Dunn's account")).toBeVisible();
  await expect(page.getByText('Joined as Chris Dunn?')).toHaveCount(0);

  // Only captains see the hint (only they can move a spot).
  await page.getByRole('button', { name: 'Add players to the roster' }).click();
  await page.getByRole('dialog', { name: 'Add players to the roster' }).getByLabel('Names').fill('Jamie F');
  await page.getByTestId('lookalikes').getByLabel("They're different people. Add them too.").check();
  await page.getByRole('button', { name: 'Add to the roster' }).click();
  await expect(card(page, 'Jamie F')).toContainText('Joined as Jamie Fox?');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /Sign out/ }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.locator('#email').fill('jordan@demo.test');
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await openTeam(page);
  await expect(card(page, 'Jamie F')).toContainText('Not joined yet');
  await expect(page.getByText('Joined as Jamie Fox?')).toHaveCount(0);
});

test("a captain's status change takes a player who has not joined out of the split", async ({ page }) => {
  await signIn(page);
  await openTeam(page);
  await card(page, 'Mike Russo').getByRole('button', { name: 'Sub Pool' }).click();
  await expect(page.getByText('Mike Russo marked Sub Pool')).toBeVisible();
  await expect(page.getByText('11 active · 3 subs (incl. on break) · 2 not joined yet')).toBeVisible();

  // $721 across 11: $65.55, rounded up.
  await openDues(page);
  await expect(page.getByText('$66 each')).toBeVisible();
  await expect(page.getByText('Mike Russo')).toHaveCount(0);
});

test('a captain links a player who joined without picking their name', async ({ page }) => {
  await signIn(page);
  await openDues(page);
  await page.getByRole('button', { name: 'Mark Mike Russo paid' }).click();
  await expect(page.getByRole('heading', { name: '7 of 12 paid' })).toBeVisible();

  // Say Mike joined the app as Chris Dunn: his payment and history move to that account.
  await openTeam(page);
  await page.getByRole('button', { name: 'Edit Mike Russo' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mike Russo' });
  await dialog.getByLabel('Joined without picking their name?').selectOption({ label: 'Chris Dunn' });
  await dialog.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(dialog).toContainText("Chris Dunn's account takes over Mike Russo's spot");
  await dialog.getByRole('button', { name: 'Move them' }).click();
  await expect(page.getByText("Mike Russo moved to Chris Dunn's account")).toBeVisible();
  await expect(page.getByText('11 active · 2 subs (incl. on break) · 1 not joined yet')).toBeVisible();
  await expect(page.getByText('Mike Russo', { exact: true })).toHaveCount(0);

  await openDues(page);
  await expect(page.getByRole('heading', { name: '7 of 11 paid' })).toBeVisible();
  await expect(page.getByTestId('dues-paid')).toContainText('Chris Dunn');
  await expect(page.locator('section', { hasText: 'Recent changes' })).toContainText('You marked Chris D. paid');
});

test('a captain edits a player who has not joined, removes them, and adds them back', async ({ page }) => {
  await signIn(page);
  await openTeam(page);
  await page.getByRole('button', { name: 'Edit Dana Wells' }).click();
  const dialog = page.getByRole('dialog', { name: 'Dana Wells' });
  await dialog.getByLabel('Name', { exact: true }).fill('Dana Wells-Ortiz');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(card(page, 'Dana Wells-Ortiz')).toContainText('Not joined yet');

  await page.getByRole('button', { name: 'Edit Dana Wells-Ortiz' }).click();
  const edit = page.getByRole('dialog', { name: 'Dana Wells-Ortiz' });
  await edit.getByRole('button', { name: 'Remove from the team' }).click();
  await expect(edit).toContainText('comes off the roster and out of the dues split');
  await edit.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText('Dana Wells-Ortiz removed from the team')).toBeVisible();
  await expect(page.getByText('11 active · 2 subs (incl. on break) · 1 not joined yet')).toBeVisible();

  await page.getByRole('button', { name: 'Add players to the roster' }).click();
  const add = page.getByRole('dialog', { name: 'Add players to the roster' });
  await add.getByRole('button', { name: 'Add back' }).click();
  await expect(page.getByText('Dana Wells-Ortiz added back')).toBeVisible();
  await expect(page.getByText('12 active · 2 subs (incl. on break) · 2 not joined yet')).toBeVisible();
});
