// @mentions: typing @ to pick a teammate, highlighting, the separate @ count,
// @team for captains, and the @mentions notification choice. See docs/chat.md.
import {
  PLAYER,
  chatBadge,
  chatTab,
  composer,
  expect,
  goToSchedule,
  isPhone,
  message,
  openChat,
  openRoom,
  roomRow,
  send,
  showRooms,
  signIn,
  test,
} from './helpers';

const mentionBadge = (page) => chatTab(page).getByLabel(/^\d+ mentions?$/);
const list = (page) => page.getByRole('listbox', { name: 'Mention a teammate' });
const option = (page, name) => list(page).getByRole('option', { name });

test('the Chat tab shows a separate @ count, threads you have never opened included, and reading clears it', async ({ page }) => {
  await signIn(page);
  // The captain is mentioned once in Team Chat and once in the never-opened fantasy thread.
  await expect(chatBadge(page)).toHaveText('6');
  await expect(mentionBadge(page)).toHaveText('@2');

  await openChat(page);
  await expect(mentionBadge(page), 'no badge while you are in the chat').toHaveCount(0);
  await expect(message(page, 'worth adding to the field rules')).toBeVisible();
  await goToSchedule(page);
  await expect(mentionBadge(page)).toHaveText('@1');

  await openChat(page);
  await openRoom(page, 'Fantasy football league');
  await expect(message(page, 'you in?')).toBeVisible();
  await goToSchedule(page);
  await expect(mentionBadge(page)).toHaveCount(0);
});

test('the room list shows each room\'s @ count next to its unread number', async ({ page }) => {
  await signIn(page);
  await openChat(page);
  await openRoom(page, 'Sunday pickup?');
  await showRooms(page);
  const fantasy = roomRow(page, 'Fantasy football league');
  // Not opened yet: "New" instead of a count, and the mention still shows.
  await expect(fantasy.getByLabel('1 mention')).toHaveText('@1');
  await expect(fantasy).toContainText('New');
  await expect(roomRow(page, 'Team Chat').getByLabel(/mention/)).toHaveCount(0);
});

test('mentions are highlighted, and mentions of you get a lime background', async ({ page }) => {
  await signIn(page);
  await openChat(page);
  const mine = message(page, 'worth adding to the field rules').locator('[data-mention]');
  await expect(mine).toHaveText('@Casey C.');
  await expect(mine).toHaveAttribute('data-mention', 'you');
  await expect(mine).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  // The captain's own @team is highlighted too, but it's their own message.
  await openRoom(page, 'Post-game food spot');
  await expect(message(page, 'wings place on Lake Rd?').locator('[data-mention]')).toHaveAttribute('data-mention', 'other');
});

test('typing @ lists teammates; picking one inserts their name and the message mentions them', async ({ page }, testInfo) => {
  await signIn(page, PLAYER);
  await openChat(page);
  const box = composer(page);
  await box.fill('Thanks ');
  await box.pressSequentially('@');
  await expect(list(page)).toBeVisible();
  await expect(option(page, /Casey C\./)).toBeVisible();
  await expect(option(page, /Jordan R\./), 'not yourself').toHaveCount(0);
  await expect(option(page, /@team/), 'only captains get @team').toHaveCount(0);

  await box.pressSequentially('sa');
  await expect(list(page).getByRole('option')).toHaveCount(1);
  await option(page, /Sam O\./).click();
  await expect(list(page)).toHaveCount(0);
  await expect(box).toHaveValue('Thanks @Sam O. ');
  await expect(box, 'the cursor stays in the box to keep typing').toBeFocused();
  await box.pressSequentially('for the pinnies');
  await page.getByRole('button', { name: 'Send' }).click();

  const sent = message(page, 'Thanks @Sam O. for the pinnies');
  await expect(sent.locator('[data-mention]')).toHaveText('@Sam O.');
  await page.reload();
  await expect(sent.locator('[data-mention]'), 'saved with the message').toHaveText('@Sam O.');

  if (!isPhone(testInfo)) {
    // On a computer: arrows choose, Enter picks, Escape closes the list and keeps the text.
    // First names first: Casey, Chris, then Alex Chen.
    await box.pressSequentially('@c');
    await expect(list(page).getByRole('option')).toHaveText([/@Casey C\./, /@Chris D\./, /@Alex C\./]);
    await expect(list(page).getByRole('option', { selected: true })).toContainText('@Casey C.');
    await box.press('ArrowDown');
    await expect(list(page).getByRole('option', { selected: true })).toContainText('@Chris D.');
    await box.press('Enter');
    await expect(box).toHaveValue('@Chris D. ');
    await box.pressSequentially('@mo');
    await expect(option(page, /@Morgan L\./)).toBeVisible();
    await box.press('Escape');
    await expect(list(page)).toHaveCount(0);
    await expect(box).toHaveValue('@Chris D. @mo');
  }
});

test('a mention you type yourself counts too, and nothing else does', async ({ page }) => {
  await signIn(page, PLAYER);
  await openChat(page);
  await send(page, 'see you there @casey c. and my email is me@riley.com');
  await expect(message(page, 'my email is').locator('[data-mention]')).toHaveText('@casey c.');
});

test('@team pings everyone, and only captains can use it', async ({ page }) => {
  await signIn(page);
  await openChat(page);
  const box = composer(page);
  await box.pressSequentially('@te');
  await option(page, /@team/).click();
  await box.pressSequentially('pizza after the game');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(message(page, '@team pizza after the game').locator('[data-mention]')).toHaveText('@team');

  // The same sample data, as a player: it mentions them.
  await page.getByRole('link', { name: 'My profile' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Sign in as a player' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  // The captain's two @team messages (this one, and the one in the food thread they haven't opened).
  await expect(mentionBadge(page)).toHaveText('@2');
  await openChat(page);
  await expect(message(page, '@team pizza after the game').locator('[data-mention]')).toHaveAttribute('data-mention', 'you');
});

test('the @mentions notification choice is on unless turned off', async ({ context, page }) => {
  await context.grantPermissions(['notifications']);
  await signIn(page, PLAYER);
  await openChat(page);
  await page.getByRole('button', { name: /^Notifications/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Notifications' });
  await dialog.getByRole('button', { name: 'Turn on notifications' }).click();
  const choice = dialog.getByRole('switch', { name: '@mentions' });
  await expect(choice).toHaveAttribute('aria-checked', 'true');
  await choice.click();
  await expect(page.getByText('@mentions: off')).toBeVisible();
  await expect(choice).toHaveAttribute('aria-checked', 'false');
});
