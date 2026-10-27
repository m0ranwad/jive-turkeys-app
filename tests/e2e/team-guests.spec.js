// Captains put the whole team on the roster by name; players who haven't
// joined yet show as grey cards until they sign up and pick their name.
// Captains set their status, edit them, link an account, undo a pick, or take
// them off the team. Their roster status decides whether they split the dues, like
// everyone else's.
// The database enforces who can do what (supabase/tests/dues.test.sql).
import { enterTeamCode, expect, openSection, signIn, test } from './helpers';

// Mike Russo (man, Defense) and Dana Wells (woman, Forward) are Active and haven't joined yet in the sample data.
// Kelly Moss picked "Kelly M" on the roster when she joined.
async function openTeam(page) {
  await page.locator('a[href="/team"]:visible').first().click();
  await expect(page.getByRole('heading', { name: 'Team', exact: true })).toBeVisible();
}

async function openDues(page) {
  await page.locator('a[href="/dues"]:visible').first().click();
  await expect(page.getByRole('heading', { name: 'Dues', exact: true })).toBeVisible();
}

// A new account: signs up, enters the team code and skips the welcome slides.
async function register(page, email) {
  await page.goto('/register');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('demo1234');
  await page.locator('#confirm').fill('demo1234');
  await page.getByRole('button', { name: 'Create account' }).click();
  await enterTeamCode(page);
}

// Says "No, that's someone else" to "Already on the site?"; with a name nobody has, that makes the profile.
async function notThem(page) {
  await page.getByTestId('already-on-site').getByRole('button', { name: "No, that's someone else" }).click();
}

async function signOutAndInAsCaptain(page) {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /Sign out/ }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.locator('#email').fill('captain@demo.test');
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Log in' }).click();
}

const field = (page) => page.locator('section').filter({ has: page.getByRole('heading', { name: 'On the field' }) });

const card = (page, name) => page.locator('div.rounded-3xl', { hasText: name }).filter({ has: page.getByText(name, { exact: true }) }).last();

test('everyone sees players who have not joined yet as grey cards, in the counts, with an invite to copy', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page, 'jordan@demo.test');
  await openTeam(page);
  // 10 active app players plus Mike and Dana.
  await expect(page.getByText('12 playing · 1 available to sub · 1 unavailable · 2 not joined yet')).toBeVisible();
  await expect(card(page, 'Mike Russo')).toContainText('Not joined yet');
  await expect(card(page, 'Mike Russo')).toHaveClass(/border-dashed/);
  await expect(card(page, 'Dana Wells')).toContainText('Forward');
  // Players can't change them, or see which roster name someone joined as.
  await expect(page.getByRole('button', { name: 'Edit Mike Russo' })).toHaveCount(0);
  await expect(page.getByTestId('joined-as')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add players to the roster' })).toHaveCount(0);

  const notJoined = page.getByTestId('not-joined');
  await expect(notJoined).toContainText("2 haven't joined yet");
  // Players on the site come first; everyone still to join is listed under the invite.
  await expect(page.getByText('On the site · 12')).toBeVisible();
  const top = async (locator) => (await locator.boundingBox()).y;
  expect(await top(card(page, 'Kelly Moss'))).toBeLessThan(await top(notJoined));
  expect(await top(card(page, 'Dana Wells'))).toBeGreaterThan(await top(notJoined));
  expect(await top(card(page, 'Mike Russo'))).toBeGreaterThan(await top(notJoined));
  // They have positions, so they're on the field too: dashed, with a note (and screen reader text) saying why.
  await expect(page.getByTestId('field-legend')).toHaveText("Dashed outline = hasn't joined yet");
  await expect(field(page)).toContainText("Mike Russo (hasn't joined yet)");
  await expect(field(page)).not.toContainText("Kelly Moss (hasn't joined yet)");
  await notJoined.getByRole('button', { name: 'Copy invite' }).click();
  await expect(page.getByText('Invite copied')).toBeVisible();
  const invite = await page.evaluate(() => navigator.clipboard.readText());
  expect(invite).toContain("You're on the Jive Turkeys roster!");
  expect(invite).toContain('enter the team code TURKEY, then pick your name from the list');
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
  await expect(page.getByText('14 playing · 1 available to sub · 1 unavailable · 4 not joined yet')).toBeVisible();
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
  await expect(field(page)).toContainText("Pat Lee (hasn't joined yet)");

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
  await expect(page.getByText('16 playing · 1 available to sub · 1 unavailable · 6 not joined yet')).toBeVisible();
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
  await openTeam(page);
  await expect(card(page, 'Jamie F')).toContainText('Not joined yet');
  await expect(page.getByText('Joined as Jamie Fox?')).toHaveCount(0);
});

test("a captain's status change takes a player who has not joined out of the split", async ({ page }) => {
  await signIn(page);
  await openTeam(page);
  await card(page, 'Mike Russo').getByRole('button', { name: 'Available to sub' }).click();
  await expect(page.getByText('Mike Russo marked Available to sub')).toBeVisible();
  await expect(page.getByText('11 playing · 2 available to sub · 1 unavailable · 2 not joined yet')).toBeVisible();

  // $721 across 11: $65.55, rounded up.
  await openDues(page);
  await expect(page.getByText('$66 each')).toBeVisible();
  await expect(page.getByText('Mike Russo')).toHaveCount(0);
});

test('a captain links a player who joined without picking their name', async ({ page }) => {
  await signIn(page);
  await openDues(page);
  await page.getByRole('button', { name: 'Mark paid for Mike Russo' }).click();
  await expect(page.getByRole('heading', { name: '6 of 12 paid' })).toBeVisible();

  // Say Mike joined the app as Chris Dunn: his payment and history move to that account.
  await openTeam(page);
  await page.getByRole('button', { name: 'Edit Mike Russo' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mike Russo' });
  await dialog.getByLabel('Joined without picking their name?').selectOption({ label: 'Chris Dunn' });
  await dialog.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(dialog).toContainText("Chris Dunn's account takes over Mike Russo's spot");
  await dialog.getByRole('button', { name: 'Move them' }).click();
  await expect(page.getByText("Mike Russo moved to Chris Dunn's account")).toBeVisible();
  await expect(page.getByText('11 playing · 1 available to sub · 1 unavailable · 1 not joined yet')).toBeVisible();
  // The grey card is gone; captains see the name on Chris's card instead.
  await expect(page.getByRole('button', { name: 'Edit Mike Russo' })).toHaveCount(0);
  await expect(card(page, 'Chris Dunn').getByTestId('joined-as')).toHaveText(/Joined as Mike Russo/);

  await openDues(page);
  await expect(page.getByRole('heading', { name: '6 of 11 paid' })).toBeVisible();
  await expect(page.getByTestId('dues-paid')).toContainText('Chris Dunn');
  await expect((await openSection(page, 'Recent changes'))).toContainText('You marked Chris D. paid');
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
  await expect(page.getByText('11 playing · 1 available to sub · 1 unavailable · 1 not joined yet')).toBeVisible();

  await page.getByRole('button', { name: 'Add players to the roster' }).click();
  const add = page.getByRole('dialog', { name: 'Add players to the roster' });
  await add.getByRole('button', { name: 'Add back' }).click();
  await expect(page.getByText('Dana Wells-Ortiz added back')).toBeVisible();
  await expect(page.getByText('12 playing · 1 available to sub · 1 unavailable · 2 not joined yet')).toBeVisible();
});

test('a captain undoes a pick: the roster name goes back to a grey card with its dues', async ({ page }) => {
  await signIn(page);
  await openTeam(page);
  const kelly = card(page, 'Kelly Moss');
  await expect(kelly.getByTestId('joined-as')).toHaveText(/Joined as Kelly M/);
  await kelly.getByRole('button', { name: 'Unlink Kelly M from Kelly Moss' }).click();
  const dialog = page.getByRole('dialog', { name: 'Unlink Kelly M?' });
  await expect(dialog).toContainText("Kelly M's spot and dues go back to a grey card. Kelly Moss keeps their account.");
  await dialog.getByRole('button', { name: 'Unlink', exact: true }).click();
  await expect(page.getByText('Kelly M is a grey card again')).toBeVisible();
  await expect(page.getByText('13 playing · 1 available to sub · 1 unavailable · 3 not joined yet')).toBeVisible();
  await expect(card(page, 'Kelly M')).toContainText('Not joined yet');
  await expect(page.getByTestId('joined-as')).toHaveCount(0);
  // Kelly Moss isn't suggested for it again: a captain just took it off her account.
  await expect(card(page, 'Kelly M')).not.toContainText('Joined as Kelly Moss?');

  // Its session 1 payment came back with it, and it's in this session's split.
  await openDues(page);
  await expect(page.getByTestId('dues-unpaid')).toContainText('Kelly Mnot joined yet');

  // It was right after all: move it back.
  await openTeam(page);
  await page.getByRole('button', { name: 'Edit Kelly M' }).click();
  const edit = page.getByRole('dialog', { name: 'Kelly M' });
  await expect(edit.getByLabel('Joined without picking their name?')).toHaveValue('');
  await edit.getByLabel('Joined without picking their name?').selectOption({ label: 'Kelly Moss' });
  await edit.getByRole('button', { name: 'Move', exact: true }).click();
  await edit.getByRole('button', { name: 'Move them' }).click();
  await expect(page.getByText("Kelly M moved to Kelly Moss's account")).toBeVisible();
  await expect(page.getByText('12 playing · 1 available to sub · 1 unavailable · 2 not joined yet')).toBeVisible();
  await expect(card(page, 'Kelly Moss').getByRole('button', { name: 'Unlink Kelly M from Kelly Moss' })).toBeVisible();
});

test('when someone signs up twice, captains see it and can move the roster spot to the account they use', async ({ page }) => {
  // Kelly makes a second account and says she isn't the Kelly already on the site.
  await register(page, 'kelly.again@demo.test');
  await page.getByRole('button', { name: "I'm not on the list" }).click();
  await page.getByLabel('Display name').fill('Kelly M.');
  await page.getByRole('button', { name: 'Female' }).click();
  await page.getByRole('button', { name: 'Start using the app' }).click();
  const reloaded = page.waitForEvent('load');
  await notThem(page);
  await reloaded;
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  await signOutAndInAsCaptain(page);

  // Captains see both accounts, and which one has her roster spot.
  await openTeam(page);
  await expect(card(page, 'Kelly Moss').getByTestId('two-accounts')).toContainText('Two accounts? Kelly M. looks like the same person.');
  await expect(card(page, 'Kelly M.').getByTestId('two-accounts')).toContainText('Kelly Moss looks like the same person.');
  // She signs in with the new one. Removing the old one first warns that it has her spot.
  await card(page, 'Kelly Moss').getByRole('button', { name: 'Remove Kelly Moss' }).click();
  const remove = page.getByRole('dialog', { name: 'Remove Kelly Moss?' });
  await expect(remove.getByTestId('remove-has-name')).toContainText('Kelly joined as Kelly M, so that spot\'s dues are on this account.');
  await expect(remove.getByTestId('remove-has-name')).toContainText('cancel and unlink Kelly M first');
  await remove.getByRole('button', { name: 'Cancel' }).click();

  await card(page, 'Kelly Moss').getByRole('button', { name: 'Unlink Kelly M from Kelly Moss' }).click();
  await page.getByRole('dialog', { name: 'Unlink Kelly M?' }).getByRole('button', { name: 'Unlink', exact: true }).click();
  await expect(page.getByText('Kelly M is a grey card again')).toBeVisible();
  // The new account is the one suggested now.
  await expect(card(page, 'Kelly M')).toContainText('Joined as Kelly M.? Tap Edit to move this spot to their account.');
  await page.getByRole('button', { name: 'Edit Kelly M' }).click();
  const edit = page.getByRole('dialog', { name: 'Kelly M' });
  await expect(edit.getByLabel('Joined without picking their name?').locator('option:checked')).toHaveText('Kelly M.');
  await edit.getByRole('button', { name: 'Move', exact: true }).click();
  await edit.getByRole('button', { name: 'Move them' }).click();
  await expect(page.getByText("Kelly M moved to Kelly M.'s account")).toBeVisible();
  await expect(card(page, 'Kelly M.').getByTestId('joined-as')).toHaveText(/Joined as Kelly M/);

  // Then the old account comes off the team.
  await card(page, 'Kelly Moss').getByRole('button', { name: 'Remove Kelly Moss' }).click();
  await expect(page.getByRole('dialog', { name: 'Remove Kelly Moss?' }).getByTestId('remove-has-name')).toHaveCount(0);
  await page.getByRole('dialog', { name: 'Remove Kelly Moss?' }).getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText('Kelly Moss removed from the team')).toBeVisible();
  await expect(page.getByTestId('two-accounts')).toHaveCount(0);
});

test('two different people with names alike: the second adds a last name if needed, and a captain clears the notes once', async ({ page }) => {
  // Another Kelly joins and types "Kelly Moss", the same as a teammate's name.
  await register(page, 'kelly.two@demo.test');
  await page.getByRole('button', { name: "I'm not on the list" }).click();
  await page.getByLabel('Display name').fill('Kelly Moss');
  await page.getByRole('button', { name: 'Female' }).click();
  await page.getByRole('button', { name: 'Start using the app' }).click();
  await notThem(page);
  await expect(page.getByTestId('name-taken')).toContainText(
    "There's already a Kelly Moss on the team. Add your last name or an initial so teammates can tell you apart.",
  );
  await expect(page.getByLabel('Display name')).toHaveValue('Kelly Moss');
  // Just "Kelly" isn't anyone's name: she's asked once more if she's the Kelly on the site, then joins.
  await page.getByLabel('Display name').fill('Kelly');
  await page.getByRole('button', { name: 'Start using the app' }).click();
  const reloaded = page.waitForEvent('load');
  await notThem(page);
  await reloaded;
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  await signOutAndInAsCaptain(page);

  await openTeam(page);
  await expect(card(page, 'Kelly').getByTestId('two-accounts')).toContainText('Two accounts? Kelly Moss looks like the same person.');
  await expect(card(page, 'Kelly').getByTestId('no-roster-name')).toContainText("Didn't pick a roster name.");
  // Chris Dunn joined this session without picking a name too.
  await expect(card(page, 'Chris Dunn').getByTestId('no-roster-name')).toBeVisible();

  await card(page, 'Kelly').getByRole('button', { name: "They're different people: Kelly and Kelly Moss" }).click();
  await expect(page.getByText('Got it: Kelly and Kelly Moss are different people')).toBeVisible();
  await expect(page.getByTestId('two-accounts')).toHaveCount(0);
  await card(page, 'Kelly').getByRole('button', { name: 'Not on the roster: Kelly' }).click();
  await expect(page.getByText("Got it: Kelly isn't on the roster")).toBeVisible();
  await expect(card(page, 'Kelly').getByTestId('no-roster-name')).toHaveCount(0);

  // The answers stay.
  await openDues(page);
  await openTeam(page);
  await expect(page.getByTestId('two-accounts')).toHaveCount(0);
  await expect(card(page, 'Kelly').getByTestId('no-roster-name')).toHaveCount(0);
  await expect(card(page, 'Chris Dunn').getByTestId('no-roster-name')).toBeVisible();
});
