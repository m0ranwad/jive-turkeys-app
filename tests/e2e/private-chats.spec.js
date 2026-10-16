// Private chats and the Captains' Lounge: only the people in a private chat
// see it (captains included), and only captains see the Lounge. Sample data:
// Casey (captain) and Jordan have a private chat; Jordan, Sam and Riley have a
// ride chat Casey can't see; Casey and Priya are the captains.
// See docs/chat.md, section 4.
import {
  composer,
  expect,
  message,
  openChat,
  openRoom,
  openTeamChat,
  roomRow,
  send,
  showRooms,
  signIn,
  tapMessage,
  test,
} from './helpers';

const mentionList = (page) => page.getByRole('listbox', { name: 'Mention a teammate' });
// A private chat nobody named shows the other people in it ("Jordan R." to Casey), so
// match the room's name exactly (Team Chat's preview can say "Jordan R.: …").
const chatRow = (page, name) => page.locator('[data-room]').filter({ has: page.getByText(name, { exact: true }) });
const heading = (page, name) => page.getByRole('heading', { name, exact: true });

async function openChatRoom(page, name) {
  await showRooms(page);
  await chatRow(page, name).click();
  await expect(chatRow(page, name)).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('log', { name: 'Messages' })).toBeVisible();
}

/** Signs out and back in as someone else, with the same sample data. */
async function switchTo(page, email) {
  await page.getByRole('link', { name: 'My profile' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('demo1234');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
}

test('captains have the Captains\' Lounge; players never see it', async ({ page }) => {
  await signIn(page);
  await openChat(page);
  await showRooms(page);
  await expect(page.locator('[data-room]:visible').nth(1)).toContainText("Captains' Lounge");
  await openRoom(page, "Captains' Lounge");
  await expect(page.getByText(/Captains only · 2 captains/)).toBeVisible();
  await expect(message(page, 'Lineup idea for Thursday')).toBeVisible();
  // Built in: nothing to rename, close or delete. Mentions are for captains only, and no @team.
  await expect(page.getByRole('button', { name: /options$/ })).toHaveCount(0);
  await composer(page).pressSequentially('@');
  await expect(mentionList(page).getByRole('option')).toHaveText([/@Priya S\./]);
  await composer(page).fill('');

  await switchTo(page, 'jordan@demo.test');
  await openChat(page);
  await showRooms(page);
  await expect(roomRow(page, "Captains' Lounge")).toHaveCount(0);
  await openTeamChat(page);
  await page.getByRole('button', { name: 'Search the chat' }).click();
  await page.getByRole('searchbox', { name: 'Search the chat' }).fill('Lineup idea');
  await expect(page.getByRole('dialog', { name: 'Search the chat' })).toContainText('Nothing found.');
});

test("captains can't see private chats they aren't in", async ({ page }) => {
  await signIn(page);
  await openChat(page);
  await showRooms(page);
  await expect(chatRow(page, 'Jordan R.')).toBeVisible();
  await expect(roomRow(page, 'Ride to Thursday')).toHaveCount(0);

  await switchTo(page, 'jordan@demo.test');
  await openChat(page);
  await openRoom(page, 'Ride to Thursday');
  await expect(page.getByText('Private · You, Riley N. & Sam O.')).toBeVisible();
  await expect(message(page, 'Leaving Lakewood at 6:15')).toBeVisible();
});

test('start a private chat: pick teammates, it is named after them, and only they see it', async ({ page }) => {
  await signIn(page);
  await openChat(page);
  await showRooms(page);
  await page.getByRole('button', { name: 'New private chat' }).click();
  const dialog = page.getByRole('dialog', { name: 'New private chat' });
  await expect(dialog).toContainText("Captains can't either, unless you add them");
  await expect(dialog.getByRole('button', { name: 'Start chat' })).toBeDisabled();
  await dialog.getByPlaceholder('Find a teammate').fill('sam ok');
  await dialog.getByText('Sam Okafor').click();
  await expect(dialog.getByRole('checkbox', { name: 'Sam Okafor' })).toBeChecked();
  await dialog.locator('#private-first').fill('Can you cover goal Thursday?');
  await dialog.getByRole('button', { name: 'Start chat' }).click();

  // Nobody named it, so it shows the other person.
  await expect(heading(page, 'Sam O.')).toBeVisible();
  await expect(page.getByText('Private · You & Sam O.')).toBeVisible();
  await expect(message(page, 'Can you cover goal Thursday?')).toBeVisible();
  await send(page, 'Taylor is out');
  await showRooms(page);
  await expect(chatRow(page, 'Sam O.').getByLabel('Private')).toBeVisible();

  // Jordan isn't in it.
  await switchTo(page, 'jordan@demo.test');
  await openChat(page);
  await showRooms(page);
  await expect(chatRow(page, 'Sam O.')).toHaveCount(0);
  await expect(chatRow(page, 'Casey C.'), 'their own chat with Casey is there').toHaveCount(1);

  // Sam is (to Sam it's "Casey C."), and it counts as unread for them right away.
  await switchTo(page, 'sam@demo.test');
  await openChat(page);
  await showRooms(page);
  await expect(chatRow(page, 'Casey C.').getByLabel('2 unread')).toBeVisible();
  await openChatRoom(page, 'Casey C.');
  await expect(message(page, 'Taylor is out')).toBeVisible();
});

test("a teammate's Message button opens your private chat with them, or starts one", async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Team', exact: true }).filter({ visible: true }).click();
  await page.getByRole('link', { name: 'Message Jordan Rivera' }).click();
  await expect(heading(page, 'Jordan R.')).toBeVisible();
  await expect(message(page, 'Paycheck hits Friday')).toBeVisible();

  await page.getByRole('link', { name: 'Team', exact: true }).filter({ visible: true }).click();
  await page.getByRole('link', { name: 'Message Drew Patel' }).click();
  const dialog = page.getByRole('dialog', { name: 'New private chat' });
  await expect(dialog.getByRole('checkbox', { name: 'Drew Patel' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Start chat' }).click();
  await expect(heading(page, 'Drew P.')).toBeVisible();
  await expect(page.getByText('Only the people in this chat can see it.')).toBeVisible();
});

test('people in a private chat: add someone, and leave', async ({ page }) => {
  await signIn(page);
  await openChat(page);
  await openChatRoom(page, 'Jordan R.');
  await page.getByRole('button', { name: 'Chat options' }).click();
  // Jordan started it: Casey can't rename or delete it, captain or not. Anyone can leave.
  await expect(page.getByRole('button', { name: 'Rename' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete chat' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Leave chat' })).toBeVisible();
  await page.getByRole('button', { name: 'People' }).click();

  // Styled like the Team page: who you are, who started it, who's a captain.
  const people = page.getByRole('dialog', { name: 'People in this chat' });
  await expect(people).toContainText('Only the two of you can see it.');
  const rows = people.getByRole('list', { name: 'People in this chat' }).getByRole('listitem');
  await expect(rows).toHaveText([/Casey Captain\s*You\s*Captain/, /Jordan Rivera\s*Started it/]);
  await expect(people.getByRole('button', { name: /Take .* out/ }), 'only the starter takes people out').toHaveCount(0);

  await people.getByRole('button', { name: 'Add people' }).click();
  await expect(people).toContainText("They'll see the whole chat, earlier messages included.");
  await expect(people.getByRole('button', { name: 'Pick who to add' })).toBeDisabled();
  await people.getByPlaceholder('Find a teammate').fill('priya');
  await people.getByText('Priya Shah').click();
  await people.getByRole('button', { name: 'Add Priya S.' }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2)).toHaveText(/Priya Shah\s*Captain/);
  await expect(people).toContainText('Only these 3 people can see it.');
  await page.keyboard.press('Escape');
  await expect(page.getByText('Private · You, Jordan R. & Priya S.')).toBeVisible();
  // Its name follows who's in it.
  await expect(heading(page, 'Jordan R. & Priya S.')).toBeVisible();

  // Leaving, from the people window.
  await page.getByRole('button', { name: 'Chat options' }).click();
  await page.getByRole('button', { name: 'People' }).click();
  await people.getByRole('button', { name: 'Leave chat' }).click();
  const confirm = page.getByRole('dialog', { name: 'Leave this chat?' });
  await confirm.getByRole('button', { name: 'Leave' }).click();
  await expect(page.getByRole('heading', { name: 'Team Chat' })).toBeVisible();
  await showRooms(page);
  await expect(chatRow(page, 'Jordan R. & Priya S.')).toHaveCount(0);
});

test('the starter of a private chat takes someone out', async ({ page }) => {
  await signIn(page);
  await openChat(page);
  await showRooms(page);
  await page.getByRole('button', { name: 'New private chat' }).click();
  const start = page.getByRole('dialog', { name: 'New private chat' });
  await start.getByText('Sam Okafor').click();
  await start.getByText('Drew Patel').click();
  await expect(start).toContainText('2 picked');
  await start.getByRole('button', { name: 'Start chat' }).click();
  await expect(heading(page, 'Drew P. & Sam O.')).toBeVisible();

  await page.getByRole('button', { name: 'Chat options' }).click();
  await page.getByRole('button', { name: 'People' }).click();
  const people = page.getByRole('dialog', { name: 'People in this chat' });
  await expect(people.getByRole('listitem').first()).toHaveText(/Casey Captain\s*You\s*Started it\s*Captain/);
  await people.getByRole('button', { name: 'Take Drew Patel out' }).click();
  await expect(people.getByRole('listitem')).toHaveCount(2);
  await expect(people).toContainText('Only the two of you can see it.');
  await page.keyboard.press('Escape');
  await expect(heading(page, 'Sam O.')).toBeVisible();
});

test('in a private chat, mentions are only its people, and captains delete only their own messages', async ({ page }) => {
  await signIn(page);
  await openChat(page);
  await openChatRoom(page, 'Jordan R.');
  await composer(page).pressSequentially('@');
  await expect(mentionList(page).getByRole('option')).toHaveText([/@Jordan R\./]);
  await composer(page).fill('');

  await tapMessage(page, 'Paycheck hits Friday');
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await tapMessage(page, 'thanks for the heads up');
  await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();
});

test('the starter of a private chat renames, closes and deletes it', async ({ page }) => {
  await signIn(page, 'jordan@demo.test');
  await openChat(page);
  await openChatRoom(page, 'Casey C.');
  await page.getByRole('button', { name: 'Chat options' }).click();
  await page.getByRole('button', { name: 'Rename' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename chat' });
  await expect(rename.locator('#thread-title')).toHaveValue('Casey C.');
  await rename.locator('#thread-title').fill('💸 Dues');
  await rename.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Dues' })).toBeVisible();

  await page.getByRole('button', { name: 'Chat options' }).click();
  await page.getByRole('button', { name: 'Close chat' }).click();
  await expect(page.getByText('This chat is closed.')).toBeVisible();
  await expect(composer(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Chat options' }).click();
  await page.getByRole('button', { name: 'Delete chat' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete chat?' });
  await expect(confirm).toContainText('removed for everyone in it');
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('heading', { name: 'Team Chat' })).toBeVisible();
});

test('an old Message link to someone not on the team says so instead of starting a chat', async ({ page }) => {
  await signIn(page);
  await page.goto('/banter?dm=00000000-0000-4000-8000-000000000000');
  await expect(page.getByText("They're not on the team anymore")).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'New private chat' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Team Chat' })).toBeVisible();
});
