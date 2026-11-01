import { answerPlaying, chatTab, enterTeamCode, expect, expectTeam, message, messageRow, notJoinedRows, openRoom, test } from './helpers';

test('a new player has to set up their profile, which puts them on the team', async ({ page }) => {
  await page.goto('/register');
  await page.getByRole('button', { name: 'Email', exact: true }).click();
  await page.locator('#email').fill('newbie@demo.test');
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Create account' }).click();
  await enterTeamCode(page);

  // Joining opens directly on the roster name, without introductory slides.
  await expect(page.getByRole('heading', { name: 'Join the team' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);

  // Not one of the names the captain put on the roster.
  await page.getByRole('button', { name: "I'm not on the list" }).click();
  // Full name and gender, and a phone number if they like, so teammates can tap to call.
  await expect(page.getByText('Only your teammates can see any of this.')).toBeVisible();
  await expect(page.getByLabel('Phone (optional)')).toBeVisible();
  await expect(page.getByLabel('Year joined (optional)')).toHaveCount(0);
  // A first name alone ("Fuzzy" could be anyone) isn't enough.
  await page.getByLabel('Full name').fill('Newbie');
  await page.getByRole('button', { name: 'Start using the app' }).click();
  await expect(page.getByText('Add your last name too, so teammates know who you are.')).toBeVisible();
  await page.getByLabel('Full name').fill('Newbie Nguyen');
  await page.getByRole('button', { name: 'Female' }).click();
  // Whether they're playing is asked, with nothing picked for them: a fan shouldn't split the dues by accident.
  const playing = page.getByRole('group', { name: 'Are you playing?' });
  await expect(playing.getByRole('button')).toHaveText([/^Playing/, /^Available to sub/, /^Just following along/]);
  for (const choice of await playing.getByRole('button').all()) await expect(choice).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Start using the app' }).click();
  await expect(page.getByText("Pick whether you're playing.")).toBeVisible();
  await answerPlaying(page);
  await expect(playing.getByRole('button', { name: /^Playing/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Start using the app' }).click();
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Join the team' })).toHaveCount(0);

  // Playing: on the team, and one more splitting this session's dues.
  await page.locator('a[href="/team"]:visible').first().click();
  await expect(page.getByText('Newbie Nguyen').first()).toBeVisible();
  await expectTeam(page, { playing: 13, sub: 1, unavailable: 1, notJoined: 2 });
  await page.locator('a[href="/dues"]:visible').first().click();
  await expect(page.getByTestId('team-progress')).toContainText('Team · 5 of 13 paid');
});

test('a fan or partner who signs up to follow along does not split the dues', async ({ page }) => {
  await page.goto('/register');
  await page.getByRole('button', { name: 'Email', exact: true }).click();
  await page.locator('#email').fill('fan@demo.test');
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Create account' }).click();
  await enterTeamCode(page);

  await page.getByRole('button', { name: "I'm not on the list" }).click();
  await page.getByLabel('Full name').fill('Frankie Fan');
  await page.getByRole('button', { name: 'Male', exact: true }).click();
  await answerPlaying(page, 'Just following along');
  await page.getByRole('button', { name: 'Start using the app' }).click();
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();

  // They're on the team as Unavailable, and the same twelve split the dues.
  await page.locator('a[href="/team"]:visible').first().click();
  await expectTeam(page, { playing: 12, sub: 1, unavailable: 2, notJoined: 2 });
  await expect(page.locator('[data-status-group="on_break"]')).toContainText('Frankie Fan');
  await page.locator('a[href="/dues"]:visible').first().click();
  await expect(page.getByTestId('team-progress')).toContainText('Team · 5 of 12 paid');
  await page.getByRole('tab', { name: 'Team dues' }).click();
  await expect(page.getByTestId('dues-unpaid')).not.toContainText('Frankie Fan');
});

test('a new player can sign out instead of setting up a profile', async ({ page }) => {
  await page.goto('/register');
  await page.getByRole('button', { name: 'Email', exact: true }).click();
  await page.locator('#email').fill('wrong@demo.test');
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Create account' }).click();
  await enterTeamCode(page);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

// Mike Russo is on the roster (with a paid session) but hasn't joined yet in the sample data.
test('a new player picks their name on the roster, and their spot and dues come with them', async ({ page }) => {
  await page.goto('/register');
  await page.getByRole('button', { name: 'Email', exact: true }).click();
  await page.locator('#email').fill('mike@demo.test');
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Create account' }).click();
  await enterTeamCode(page);

  await expect(page.getByText('Find your name.')).toBeVisible();
  await page.getByRole('button', { name: 'Mike Russo' }).click();
  await expect(page.getByText("You're joining as Mike Russo.")).toBeVisible();
  await expect(page.getByLabel('Full name')).toHaveValue('Mike Russo');
  // Finishing the profile reloads the page; wait for that before moving on.
  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Start using the app' }).click();
  await reloaded;
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();

  // On the roster as a joined player, no longer a grey card.
  await page.locator('a[href="/team"]:visible').first().click();
  await expectTeam(page, { playing: 12, sub: 1, unavailable: 1, notJoined: 1 });
  await expect(notJoinedRows(page)).toHaveCount(1);

  // His paid session came with him.
  await page.locator('a[href="/dues"]:visible').first().click();
  await expect(page.getByText('Other sessions')).toBeVisible();
  await expect(page.locator('section', { hasText: 'Other sessions' })).toContainText('Paid');
  await page.getByRole('tab', { name: 'Team dues' }).click();
  await expect(page.getByTestId('dues-unpaid')).toContainText('Mike Russo');
  await expect(page.getByTestId('dues-unpaid')).not.toContainText('Mike Russonot joined yet');
});

test('a name someone already picked is no longer on the list', async ({ page }) => {
  // Dana Wells is still on the list; once picked, she's gone from it.
  await page.goto('/register');
  await page.getByRole('button', { name: 'Email', exact: true }).click();
  await page.locator('#email').fill('dana@demo.test');
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Create account' }).click();
  await enterTeamCode(page);
  await page.getByRole('button', { name: 'Dana Wells' }).click();
  // Finishing the profile reloads the page; wait for that before using the menu.
  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Start using the app' }).click();
  await reloaded;
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /Sign out/ }).click();
  // Signing out finishes by opening the sign-in page; wait for it before signing up again.
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/register');
  await page.getByRole('button', { name: 'Email', exact: true }).click();
  await page.locator('#email').fill('someone@demo.test');
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Create account' }).click();
  await enterTeamCode(page);
  await expect(page.getByRole('button', { name: 'Mike Russo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dana Wells' })).toHaveCount(0);
});

async function register(page, email) {
  await page.goto('/register');
  await page.getByRole('button', { name: 'Email', exact: true }).click();
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Create account' }).click();
  await enterTeamCode(page);
}

async function finishProfile(page) {
  // Finishing the profile reloads the page; wait for that before moving on.
  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Start using the app' }).click();
  await reloaded;
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
}

test('a new player who taps the wrong name, or says they are not on the list, can go back', async ({ page }) => {
  await register(page, 'rosa@demo.test');
  await page.getByRole('button', { name: 'Mike Russo' }).click();
  await expect(page.getByText("You're joining as Mike Russo.")).toBeVisible();
  await page.getByRole('button', { name: 'Not you?' }).click();
  await expect(page.getByText('Find your name.')).toBeVisible();

  await page.getByRole('button', { name: "I'm not on the list" }).click();
  await expect(page.getByLabel('Full name')).toHaveValue('');
  await page.getByRole('button', { name: 'Back to the list' }).click();
  await page.getByRole('button', { name: 'Dana Wells' }).click();
  await expect(page.getByLabel('Full name')).toHaveValue('Dana Wells');
  // What the captain entered can still be corrected.
  await page.getByLabel('Full name').fill('Dana W.');
  await finishProfile(page);

  await page.locator('a[href="/team"]:visible').first().click();
  await expect(page.getByText('Dana W.', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Dana Wells', { exact: true })).toHaveCount(0);
  await expect(notJoinedRows(page)).toHaveCount(1);
  await expect(page.getByText('Mike Russo', { exact: true }).last()).toBeVisible();
});

test('once every name is picked, new players go straight to their profile', async ({ page }) => {
  for (const [email, name] of [
    ['dana@demo.test', 'Dana Wells'],
    ['mike@demo.test', 'Mike Russo'],
  ]) {
    await register(page, email);
    await page.getByRole('button', { name }).click();
    await finishProfile(page);
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: /Sign out/ }).click();
    await expect(page).toHaveURL(/\/login$/);
  }

  await register(page, 'latecomer@demo.test');
  await expect(page.getByLabel('Full name')).toBeVisible();
  await expect(page.getByText('Find your name.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Back to the list' })).toHaveCount(0);
});

test('a new player who types their name instead of picking it is asked if that is them', async ({ page }) => {
  await register(page, 'dana@demo.test');
  await page.getByRole('button', { name: "I'm not on the list" }).click();
  await page.getByLabel('Full name').fill('Dana W');
  await page.getByRole('button', { name: 'Female' }).click();
  await answerPlaying(page);
  await page.getByRole('button', { name: 'Start using the app' }).click();
  const ask = page.getByTestId('is-that-you');
  await expect(ask).toContainText('Dana Wells is already on the roster');
  await expect(ask).toContainText('you keep the name Dana W.');
  const reloaded = page.waitForEvent('load');
  await ask.getByRole('button', { name: "Yes, I'm Dana Wells" }).click();
  await reloaded;
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();

  // Her spot came with her: no grey card for Dana Wells, and her payments are hers.
  await page.locator('a[href="/team"]:visible').first().click();
  await expect(notJoinedRows(page)).toHaveCount(1);
  await expect(page.getByText('Dana Wells', { exact: true })).toHaveCount(0);
  await page.locator('a[href="/dues"]:visible').first().click();
  await page.getByRole('tab', { name: 'Team dues' }).click();
  await expect(page.getByTestId('dues-paid')).toContainText('Dana');
});

test('someone else with the same first name can say so', async ({ page }) => {
  await register(page, 'mikey@demo.test');
  await page.getByRole('button', { name: "I'm not on the list" }).click();
  await page.getByLabel('Full name').fill('Mike Rossi');
  await page.getByRole('button', { name: 'Male', exact: true }).click();
  await answerPlaying(page);
  // "Mike Rossi" isn't "Mike Russo": no question.
  await finishProfile(page);
  await expect(page.getByTestId('is-that-you')).toHaveCount(0);

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /Sign out/ }).click();
  await expect(page).toHaveURL(/\/login$/);
  await register(page, 'mike2@demo.test');
  await page.getByRole('button', { name: "I'm not on the list" }).click();
  await page.getByLabel('Full name').fill('Mike R');
  await page.getByRole('button', { name: 'Male', exact: true }).click();
  await answerPlaying(page);
  await page.getByRole('button', { name: 'Start using the app' }).click();
  await expect(page.getByTestId('is-that-you')).toContainText('Mike Russo is already on the roster');
  await finishAnswer(page, "No, that's someone else");
  // Mike Russo is still waiting for his own sign-up.
  await page.locator('a[href="/team"]:visible').first().click();
  await expect(notJoinedRows(page)).toHaveCount(2);
  await expect(page.getByText('Mike Russo', { exact: true }).last()).toBeVisible();
});

async function finishAnswer(page, name) {
  // Answering creates the profile and reloads the page; wait for that before moving on.
  const reloaded = page.waitForEvent('load');
  await page.getByTestId('is-that-you').getByRole('button', { name }).click();
  await reloaded;
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
}

async function signOutAndInAsCaptain(page) {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /Sign out/ }).click();
  await expect(page).toHaveURL(/\/login$/);
  // No chat tip or notifications offer in the way.
  await page.evaluate(() => {
    localStorage.setItem('jt_chat_tip_seen', '1');
    localStorage.setItem('jt_push_prompt_dismissed', '1');
  });
  await page.locator('#email').fill('captain@demo.test');
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
}

test("captains get a heads-up in their Lounge when someone new joins as Playing, but not for a roster name's pick", async ({ page }) => {
  await register(page, 'newbie@demo.test');
  await page.getByRole('button', { name: "I'm not on the list" }).click();
  await page.getByLabel('Full name').fill('Newbie Nguyen');
  await page.getByRole('button', { name: 'Female' }).click();
  await answerPlaying(page);
  await finishProfile(page);

  // Mike picks his roster name: a captain already set him to Playing, so there's nothing to check.
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /Sign out/ }).click();
  await expect(page).toHaveURL(/\/login$/);
  await register(page, 'mike@demo.test');
  await page.getByRole('button', { name: 'Mike Russo' }).click();
  await finishProfile(page);

  await signOutAndInAsCaptain(page);
  await chatTab(page).click();
  await openRoom(page, "Captains' Lounge");
  const headsUp = message(page, 'Newbie Nguyen just joined');
  await expect(headsUp).toContainText(
    /Newbie Nguyen just joined and said they're Playing, so they now split session \d's dues\. If they're not playing, change their status on the Team page before people pay\./,
  );
  await expect(messageRow(page, 'Newbie Nguyen just joined')).toContainText('Roster');
  await expect(message(page, 'Mike Russo just joined')).toHaveCount(0);
});
