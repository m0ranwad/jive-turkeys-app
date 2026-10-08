# Team Chat: how it should work

This is the expected behavior of the chat, and the promise it makes about the team's messages. Each rule
says which automated test checks it, so a change that breaks one shows up as a red check on its pull request
before anyone can publish it. If you change how the chat works on purpose, update this page and the tests in
the same change.

**Tests:** `[browser]` = `tests/e2e/*.spec.js` (Playwright, demo mode, phone and desktop) ·
`[db]` = `supabase/tests/chat.test.sql` · `[unit]` = `tests/unit/*.test.js` ·
`[rehearsal]` = `scripts/db-rehearsal.sh`. How to run them: see [Running the tests](#running-the-tests).

## 1. Chats are kept

The team's chat history is the one thing a site update must never lose.

| Promise | Checked by |
|---|---|
| A database update can't remove or change existing messages, threads, reactions or any other team data. Every new migration is rehearsed on a copy of the database filled with sample data, and the check fails if any existing row is missing or different afterwards. This runs on every pull request, and again right before the live database is updated. | `[rehearsal]` |
| The one exception is a data-removing change a co-owner approved in plain words: its migration file says `-- owner-approved`. The rehearsal then lists what it removed instead of failing. | `[rehearsal]` |
| Database update files that were already applied can't be edited or deleted. | `[rehearsal]` |
| When a player's account is deleted, their messages and threads stay, under the name they posted with. Only their reactions and read markers go. | `[db]` |
| Messages are only removed when someone deletes them on purpose (their own, or any as a captain), or when their thread is deleted. | `[db]` |
| The rules that decide what deleting removes ("delete rules" on the links between tables) are locked by a test. Changing one, for example so deleting an account also deletes its messages, fails the check. | `[db]` |
| Chats, threads and reactions in demo mode survive a page reload, and survive a later version adding new kinds of data. | `[unit]` `[browser]` |
| Previews and local development use sample data (demo mode) and can never touch the real chat. | `vite.config.js` |

Deleting in the app is permanent: there's no trash or undo. Supabase's free plan has no backups we can
restore from, so a deleted message or thread is gone for good.

## 2. Team Chat

The one room everyone is in. In the database it's the messages with no thread (`thread_id` is null).

| Expected behavior | Checked by |
|---|---|
| Opens at a **New messages** line above the first message from someone else since you last read. Without unread messages it opens at the bottom. | `[browser]` `[unit]` |
| Messages are grouped by sender: name once, then their next messages within 5 minutes stacked under it. A new day gets a label (Today, Yesterday, then the date). | `[browser]` `[unit]` |
| Your messages are dark, on the right. Others' are light, on the left, with initials, short name ("Jordan R.") and a **Capt** tag for captains. Names come from players' profiles. | `[browser]` |
| Send with the Send button. On a computer, Enter sends and Shift+Enter starts a new line. On phones, Enter starts a new line. Blank messages can't be sent. Up to 2000 characters. | `[browser]` `[db]` |
| A sent message shows right away ("Sending…"), and stays after a reload. | `[browser]` `[unit]` |
| If sending fails (say, no signal), the text goes back in the box and a message says it didn't send. | not automated |
| Links (http/https only) can be tapped, open in a new tab, and long ones are shortened. Messages of 1 to 3 emoji show big, without a bubble. | `[browser]` `[unit]` |
| Shows the latest 60 messages. **Load earlier messages** adds the 60 before, without jumping away from where you were. | `[browser]` `[unit]` |
| New messages that arrive while you're scrolled up show a "↓ N new messages" button instead of yanking you down. | manual (see below) |
| On phones the chat fills the screen, with the message box just above the tab bar. Only the messages scroll, not the page. | `[browser]` |
| A one-time tip explains tapping a message. It stays dismissed. | `[browser]` |
| Unsent text is kept per room while you switch rooms (until the page is reloaded). | `[browser]` |

## 3. Message options: react, reply, copy, delete

Tapping (or clicking) a message shows its options. Tap it again, or press Escape, to close them.

| Expected behavior | Checked by |
|---|---|
| Quick reactions 👍 ❤️ 😂 😮 🔥 🦃, plus ➕ for any emoji from the picker. | `[browser]` |
| Reactions show under the message with a count. Yours are highlighted. Tapping a reaction adds or removes yours. The options list who reacted with what. | `[browser]` `[unit]` |
| One of each emoji per player per message. You can only add or remove your own reactions; captains can also remove others'. | `[db]` |
| **Reply** quotes the message above yours ("Replying to Jordan R." while typing, Esc or ✕ cancels). Tapping the quote jumps to the original and flashes it. If the original was deleted, the quote says "Original message was deleted". | `[browser]` `[db]` |
| **Copy** copies the text. | `[browser]` |
| **Delete** (after a confirm) removes the message for everyone, with its reactions. Replies to it stay. Players see Delete only on their own messages; captains on every message. The database enforces the same. | `[browser]` `[db]` |
| Nobody can edit messages yet (planned: issue #6). | `[db]` |

## 4. Threads

Side conversations, so Team Chat stays about the team. Every thread is visible to the whole team.

| Expected behavior | Checked by |
|---|---|
| The room list shows Team Chat first, then open threads with the most recent activity first. Each row shows the last message ("Riley N.: Can't this week"), when it was sent, and an unread count. | `[browser]` `[unit]` |
| Phones: the **Threads** button in the Team Chat header opens the list (with an unread count, or a dot for new threads), and ‹ goes back. Computers: the list is always beside the chat. | `[browser]` |
| **New thread** asks for a topic (1 to 80 characters) and an optional first message. A leading emoji becomes the thread's icon. You land in the new thread. | `[browser]` `[unit]` `[db]` |
| Anyone can post in an open thread. | `[db]` `[browser]` |
| The person who started a thread, and captains, get **⋯** with Rename, Close thread / Reopen thread and Delete thread. Others don't, and the database refuses them too. | `[browser]` `[db]` |
| A **closed** thread moves to the collapsed "Closed (N)" section. It stays readable, but there's no message box, and the database refuses new messages. The starter or a captain can reopen it. | `[browser]` `[db]` |
| **Deleting** a thread (after a confirm that says it removes all its messages for everyone) removes it with its messages, reactions and read markers. Team Chat and other threads are untouched. You go back to Team Chat. | `[browser]` `[db]` `[unit]` |
| A link to a thread that no longer exists says "This thread isn't here anymore" with a button back to Team Chat. | `[browser]` |
| Messages only show in the room they were posted in. | `[browser]` `[unit]` |

## 5. Unread counts

Read markers are stored per player in the database (`chat_reads`), so phone and computer agree.

| Expected behavior | Checked by |
|---|---|
| The **Chat tab** (bottom bar on phones, top bar on computers, and the menu) shows a count: unread Team Chat messages plus unread messages in threads you've opened. No badge while you're on the chat page. | `[browser]` `[unit]` |
| Your own messages never count. History from before you signed up doesn't count. | `[browser]` `[db]` |
| Opening a room marks it read up to its latest message, shortly after it's shown and while the page is in view. The marker only ever moves forward. | `[browser]` `[db]` `[unit]` |
| Threads you've never opened show **New** in the list instead of a count, and don't add to the Chat tab badge. A dot on the Threads button flags ones with activity in the last 3 days. | `[browser]` `[unit]` |
| Read markers are private: nobody can see or change another player's. | `[db]` |

## 6. Who can see what

| Expected behavior | Checked by |
|---|---|
| Only signed-in players can read anything. Signed-out visitors get nothing, not even the unread summary. | `[db]` |
| Every table has row level security on, and signed-out visitors have no access to any table. | `[db]` |
| You post, react and start threads only as yourself. | `[db]` |
| Messages, threads and reactions update live for everyone on the page (Supabase Realtime). | `[db]` (publication), `[unit]` (subscriptions) |

## What automation can't check (try these by hand before relying on a big chat change)

The browser tests run in demo mode, so they can't cover real-time delivery between two people, the real
database's response times, or phone keyboards. After publishing a chat change, take two minutes with two
devices signed in as different players:

1. Send from one. It appears on the other within a second or two, without a refresh, and the other's Chat tab
   badge goes up when they're on another page.
2. On the receiving phone, scroll up in Team Chat, then send another message from the first device. The
   "↓ 1 new message" button appears, and tapping it scrolls down.
3. React on one, and the reaction appears on the other. Delete a message on one, and it disappears on the other.
4. Start a thread on one; it appears in the other's list. Close it, and the other's message box goes away.
5. On an iPhone, tap the message box: the keyboard opens and the box stays visible above it.

## Running the tests

| Command | What it runs | Needs |
|---|---|---|
| `npm test` | Unit tests: chat logic and both data backends (a few seconds) | Nothing extra |
| `npm run test:e2e` | Browser tests on a phone and a desktop screen, in demo mode (a few minutes). Starts its own dev server. | `npx playwright install chromium` once (Claude's cloud sessions already have it) |
| `npm run test:db` | Database rules on a scratch database built from every migration | Postgres 15+ and `psql`, connected through `PGHOST`/`PGUSER`/`PGPASSWORD` |
| `npm run test:db-rehearsal` | Rehearses migrations that aren't on `origin/main` yet | Same as above |

GitHub runs all of them on every pull request and on `main` (`.github/workflows/tests.yml`). The Database
update workflow also runs the database rules and the rehearsal right before it touches the live database, and
stops if either fails.
