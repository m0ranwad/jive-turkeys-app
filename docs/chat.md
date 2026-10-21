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
| When a player's account is deleted, their messages and threads stay, under the name they posted with. Only their reactions, read markers and places in private chats go. | `[db]` |
| Messages are only removed when someone deletes them on purpose (their own, or any as a captain outside private chats), or when their thread or private chat is deleted. Leaving a private chat keeps your messages in it. | `[db]` |
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
| **@mentions:** typing @ in the message box lists teammates on the site (first names first; not yourself or removed players). Typing narrows it; tapping one (on a computer, the arrows and Enter or Tab) puts in their chat name, like "@Jordan R.", and Escape closes the list. Teammates who share a short name show their full names. A name typed out in full counts too, but only at the start of a word, so an email address doesn't. | `[browser]` `[unit]` |
| Mentions stand out in the message, and mentions of you (by name or @team) get a lime background. A message keeps who it mentions (`messages.mentions`); editing the text updates that, without a notification. | `[browser]` `[unit]` `[db]` |
| **@team** mentions everyone. Only captains get it in the list, only in Team Chat and threads, and the database ignores it anywhere else or from anyone else (`messages.mentions_team`). | `[browser]` `[db]` |
| A message only mentions teammates on the site (not an account that hasn't entered the team code) who can read its room, each once, and never its author, whatever the site sends. In a private chat the list only offers its people; in the Captains' Lounge, only captains. | `[db]` `[unit]` `[browser]` |
| Shows the latest 60 messages. **Load earlier messages** adds the 60 before, without jumping away from where you were. | `[browser]` `[unit]` |
| New messages that arrive while you're scrolled up show a "↓ N new messages" button instead of yanking you down. | manual (see below) |
| On phones the chat fills the screen, with the message box just above the tab bar. Only the messages scroll, not the page. The room header is just ‹ (back to the room list), the room's name (not in capitals, so long names fit) with one line under it, and **⋯** when the room has options. | `[browser]` |
| While typing on a phone, the chat fits the space above the keyboard: room name at the top, newest messages, and the message box with your words right above the keyboard. The site header and tab bar step aside until the keyboard closes. This holds when the iPhone keyboard covers the page without resizing it, and when Safari slides the page. Tapping Send or an emoji keeps the keyboard open. | `[browser]` (simulated keyboard), manual on a real iPhone |
| A one-time tip at the top of the room list (never over the messages) explains tapping a message and **New**. It stays dismissed. | `[browser]` |
| Unsent text is kept per room while you switch rooms (until the page is reloaded). | `[browser]` |

## 3. Message options: react, reply, copy, edit, delete

Tapping (or clicking) a message shows its options. Tap it again, or press Escape, to close them.

| Expected behavior | Checked by |
|---|---|
| Quick reactions 👍 ❤️ 😂 😮 🔥 🦃, plus ➕ for any emoji from the picker. | `[browser]` |
| Reactions show under the message with a count. Yours are highlighted. Tapping a reaction adds or removes yours. The options list who reacted with what. | `[browser]` `[unit]` |
| One of each emoji per player per message. You can only add or remove your own reactions; captains can also remove others'. | `[db]` |
| **Reply** quotes the message above yours ("Replying to Jordan R." while typing, Esc or ✕ cancels). Tapping the quote jumps to the original and flashes it. If the original was deleted, the quote says "Original message was deleted". | `[browser]` `[db]` |
| **Copy** copies the text. | `[browser]` |
| **Delete** (after a confirm) removes the message for everyone, with its reactions. Replies to it stay. Players see Delete only on their own messages; captains on every message, except in private chats, where everyone deletes only their own. The database enforces the same. | `[browser]` `[db]` |
| **Edit** (your own messages only) puts the text back in the message box to fix; saving changes it for everyone, live, with a small "edited" label. Cancel (✕ or Escape) changes nothing and brings back what you were typing. Only the text can change, never who wrote it or when; captains don't edit other people's messages (they delete); nobody edits in a closed thread; editing never sends a notification. | `[browser]` `[db]` |
| Nobody can edit messages yet (planned: issue #6). | `[db]` |

**Search** (the 🔍 at the top of the room list) finds messages in Team Chat, every thread, your private chats and (for captains) the Captains' Lounge:

| Expected behavior | Checked by |
|---|---|
| Words match in any form ("parked" finds "parking"); handles, numbers and anything else match as typed, and `%`, a leading `-` or the word "or" are just text. Two characters at least. | `[db]` |
| Results show who, where (Team Chat or the thread's name), when, and the match highlighted. Tapping one opens that room and jumps to the message, loading older messages until it's there. | `[browser]` |
| Players only find messages they can read: never a private chat they aren't in (captains included), nor the Lounge unless they're a captain. An account that hasn't joined the team finds nothing. | `[db]` `[unit]` `[browser]` |

## 4. Threads, private chats and the Captains' Lounge

Threads are side conversations, so Team Chat stays about the team. Every thread is visible to the whole team.
Private chats and the Captains' Lounge are the exceptions: see [below](#private-chats).

| Expected behavior | Checked by |
|---|---|
| The room list (**Chats**) shows Team Chat pinned at the top, then every other open room in one list, most recent activity first: threads, private chats and the Captains' Lounge (captains only) together, no sections. Each row shows the last message ("Riley N.: Can't this week"), when it was sent, and an unread count. Closed rooms are tucked away at the bottom. With nothing but Team Chat (and the Lounge), it says how to start a thread or a private chat. | `[browser]` `[unit]` |
| **Phones** open Chat on the room list, like a texting app. Tapping a room opens it full screen; ‹ in its header (or the phone's own back button) goes back to the list. Like a phone app's tab, the Chat tab brings you back to the room you were in during this visit (the list the first time, or if you left from the list), and tapping it while you're in the chat goes to the list. Team Chat has its own address (`/banter?room=team`, what its notifications and the menu's Team Chat open), so the list stays the starting point. There's no row of room chips. **Computers** keep the list beside the chat, which shows Team Chat until another room is picked. | `[browser]` |
| The top of the room list has 🔍 search, the notifications bell and **New**, since they cover every room. **New** asks **Thread for everyone** or **Private chat**. | `[browser]` |
| **New thread** asks for a topic (1 to 80 characters) and an optional first message. A leading emoji becomes the thread's icon. You land in the new thread. | `[browser]` `[unit]` `[db]` |
| Anyone can post in an open thread. | `[db]` `[browser]` |
| Every room has the same **⋯** menu (**Chat options**), showing only what you can do there; a room where you can't do anything (Team Chat, the Lounge, someone else's thread for players) has none. The person who started a thread, and captains, get Rename, Close thread / Reopen thread and Delete thread. Others don't, and the database refuses them too. | `[browser]` `[db]` |
| A **closed** thread moves to the collapsed "Closed (N)" section. It stays readable, but there's no message box, and the database refuses new messages. The starter or a captain can reopen it. | `[browser]` `[db]` |
| **Deleting** a thread (after a confirm that says it removes all its messages for everyone) removes it with its messages, reactions and read markers. Team Chat and other threads are untouched. You go back to the room list (Team Chat on computers). | `[browser]` `[db]` `[unit]` |
| A link to a thread that no longer exists says "This thread isn't here anymore" with a button back to Team Chat. | `[browser]` |
| Messages only show in the room they were posted in. | `[browser]` `[unit]` |

### Private chats

A private chat is a room only the teammates in it can see. **Captains can't read private chats they aren't
in**, and have no say over them (they can't delete messages, rename, close or delete them). In the database
it's a thread with `visibility = 'private'`, and who's in it is `chat_thread_members`.

| Expected behavior | Checked by |
|---|---|
| **New → Private chat** (at the top of the room list) picks teammates on the site (a search box shows once the list is long; "sam", "okafor" and "sam ok" all find Sam Okafor), an optional name and an optional first message. The starter is in it too. You land in the new chat. If the first message doesn't send, you still land in the chat, with the message in the box to send again (never a second chat). | `[browser]` `[unit]` `[db]` |
| Without a name, each person sees it called after the other people in it right now: "Jordan R." to Casey, "Casey C." to Jordan, "Jordan R. & Sam O." in a group (four names at most, then "& N more"; "Just you" once everyone else has left). That's the same in the list, the header, search and notifications, and it follows people joining and leaving. Renaming it gives it that name for everyone (`chat_threads.named`). | `[browser]` `[unit]` `[db]` |
| A teammate's **Message** button on the Team page opens your open private chat with just them, or starts one with them already picked (over the room list on phones). | `[browser]` `[unit]` |
| Private chats show a lock on their icon, and the header says "Private · You, Jordan R. & …". | `[browser]` |
| Only the people in it see it, its messages, reactions and who's in it, in the list, in search and in unread counts. Nobody else can post, react, add people or see it, captains included. | `[db]` `[unit]` `[browser]` |
| Its unread count adds to the Chat tab like Team Chat's, even before you open it. What was said before you were added (or added back) doesn't count as unread, even if you'd read further back before leaving. | `[db]` `[unit]` `[browser]` |
| A player a captain takes off the team drops out of every private chat they were in, and off its People list. Adding them back to the team doesn't bring the chats back: someone in each chat adds them again. | `[db]` `[unit]` |
| **⋯ → People** lists who's in it, like the Team page: initials colored by man / woman, and **You**, **Started it** and **Captain** badges, with "Only the two of you can see it" (or "these N people"). Anyone in it can **Add people** (teammates on the site), who then see the whole chat, earlier messages included (the window says so). Nobody can be added to a closed chat. | `[browser]` `[db]` `[unit]` |
| Its starter also gets **Remove** next to each person, and **Rename**, **Close chat** / **Reopen chat** and **Delete chat** (after a confirm that says it removes the messages for everyone in it). Once the starter leaves, nobody has those. | `[browser]` `[db]` `[unit]` |
| **Leave chat** (in **⋯**, or at the bottom of People; after a confirm) takes you out and back to the room list (Team Chat on computers); it's gone from your list until someone adds you back. Your messages stay in it. Leaving and taking someone out only say they worked once they really did. | `[browser]` `[db]` `[unit]` |
| A private chat can never be opened up to the team, and a thread can never be made private: a room's kind is set when it starts. | `[db]` `[unit]` |

### The Captains' Lounge

A room only captains see, built in (the database starts it). In the database it's the one thread with
`visibility = 'captains'`.

| Expected behavior | Checked by |
|---|---|
| Every captain sees it in the room list (by latest activity, like every room), with a "C" armband icon and "Captains only · N captains"; a player made captain sees it from then, and a captain made a player again loses it. Players never see it, its messages or its unread count, and can't post or react in it. | `[db]` `[unit]` `[browser]` |
| Nobody can rename, close or delete it (no **⋯** menu). Captains can delete any message in it, like in Team Chat. | `[db]` `[browser]` |
| Its unread count adds to captains' Chat tab like Team Chat's, opened or not. | `[db]` `[unit]` |

## 5. Unread counts

Read markers are stored per player in the database (`chat_reads`), so phone and computer agree.

| Expected behavior | Checked by |
|---|---|
| The **Chat tab** (bottom bar on phones, top bar on computers, and the menu) shows a count: unread messages in Team Chat, your private chats and (for captains) the Captains' Lounge, plus threads you've opened. No badge while you're on the chat page. | `[browser]` `[unit]` |
| Your own messages never count. History from before you signed up doesn't count. | `[browser]` `[db]` |
| Opening a room marks it read up to its latest message from someone else (yours never count), shortly after it's shown and while the page is in view. The marker only ever moves forward. Sending a message never marks read one that hasn't reached your screen. | `[browser]` `[db]` `[unit]` |
| Threads you've never opened show **New** in the list instead of a count, and don't add to the Chat tab badge (private chats and the Lounge always show their count). On phones, a dot on a room's ‹ flags ones with activity in the last 3 days. | `[browser]` `[unit]` |
| A closed room keeps what was unread when it closed. The collapsed **Closed (N)** shows that count (and each closed room its own), so the Chat tab never counts something you can't find. | `[unit]` |
| **@ count:** next to the unread number, the Chat tab (and the menu) shows a separate "@2": unread messages that mention you, by name or @team, in every room, threads you've never opened included. Each room in the list shows its own. Opening a room clears its mentions. | `[browser]` `[unit]` `[db]` |
| **Phones:** a room's ‹ shows what's waiting in the other rooms (Team Chat included), counted like the Chat tab and shown like a list row: their @ count and their unread number, or else the dot for new threads. Screen readers hear them too ("All chats, 1 mention, 3 unread"). | `[browser]` `[unit]` |
| Read markers are private: nobody can see or change another player's. | `[db]` |

## 6. Who can see what

| Expected behavior | Checked by |
|---|---|
| Only signed-in players can read anything. Signed-out visitors get nothing, not even the unread summary. | `[db]` |
| Team Chat and threads are for the whole team; a private chat only for its people (captains included only if they're in it); the Captains' Lounge only for captains. The database enforces this for messages, reactions, search, unread counts, notifications and live updates. | `[db]` |
| Every table has row level security on, and signed-out visitors have no access to any table. | `[db]` |
| You post, react and start threads and private chats only as yourself. | `[db]` |
| Messages, threads, reactions and who's in each private chat update live for everyone on the page who can see them (Supabase Realtime, which follows the same rules). Being added to a private chat makes it show up. | `[db]` (publication), `[unit]` (subscriptions) |
| Live updates miss whatever is posted while the page is out of view (a phone asleep, the app in the background) or the connection is down. So when the page comes back into view, or the connection comes back, the open room fetches its latest messages (new ones and edits) and the room list its summaries. Until that's in, the room isn't marked read. If more than a page of messages came in, the room starts again from the newest, with **Load earlier messages** for the rest. | `[browser]` `[unit]` |

## 7. Phone notifications

Players turn them on with the bell at the top of the chat's room list, on My Profile, or from the one-time offer on
Schedule, below the to-dos (also shown at the top of the room list until it's answered or dismissed). In the iPhone
browser, Schedule shows only its **Get the app** card instead, since notifications need the Home Screen app there
(the room list's offer still says so). Once on, players choose **Chat messages**,
**@mentions** and **Game alerts** separately (all on unless turned off; `player_profiles.notify_chat` /
`notify_mentions` / `notify_games`), and the choice covers all their devices. Chat messages off with @mentions on
means "only when someone @mentions me". They're standard Web Push: on an iPhone they only work once the site is on the Home Screen, so
the bell walks iPhone players through that first. No email.

How a message becomes a notification: posting a message fires a database trigger (`messages_push`) that calls
the `notify-chat` function with only the message id. The function asks the database who to notify
(`chat_push_targets`), encrypts the notification for each device and sends it. The database decides
everything, so the function can't be made to send anything else.

| Expected behavior | Checked by |
|---|---|
| Team Chat messages notify everyone who turned notifications on, except the author. | `[db]` |
| Thread messages notify only the thread's starter and players who have opened the thread. | `[db]` |
| Private chat messages notify everyone in it (opened or not); Lounge messages notify every captain. Nobody who can't read a room is ever notified about it. | `[db]` |
| A message that mentions a player (by name or @team) notifies them wherever it is, even in a thread they haven't opened and even with **Chat messages** off, unless they turned **@mentions** off. | `[db]` |
| Only players on the team get notifications: a player a captain removed gets none until they're added back. | `[db]` |
| A player who turned **Chat messages** off gets no chat notifications except @mentions; **@mentions** off, none for mentions in rooms they don't follow; **Game alerts** off, no Player of the Match ones. All start on, and only the player can change theirs. | `[db]` `[browser]` |
| Nobody gets buzzed for the room they're looking at right now (the chat page checks in every 15 seconds while it's on screen; on any of their devices). | `[db]` `[browser]` |
| Each message is sent out once, and messages older than 10 minutes never are. | `[db]` |
| The notification shows the room (Team Chat or the thread's title) and "Name: message", one line, cut at 160 characters. Tapping it opens that room (Team Chat's is `/banter?room=team`, since plain `/banter` is the room list on phones); ‹ then goes to the list. | `[unit]` `[browser]` |
| If notifications can't be sent (the sender is down, not set up yet), messages still post normally. | `[db]` |
| A player's devices are private to them. A phone that changes hands notifies whoever turned notifications on last. Signing out turns them off on that device. | `[db]` `[browser]` |
| Phones that unsubscribed are forgotten the next time a send to them fails. | `[unit]` |
| **The app icon shows the unread number**, the same as the Chat tab (Team Chat, your private chats and the Lounge for captains, plus threads you've opened; not your own messages). Each chat notification carries it (`chat_push_unread`), so it goes up while the app is closed; game alerts leave it as it is. If the count isn't available, the notification still goes out. | `[db]` `[unit]` `[browser]` |
| While the site is open, the icon follows the Chat tab and clears once everything is read. Players who turn **Chat messages** off, or turn notifications off on the device (signing out does), get no number (an @mention notification clears it instead). On an iPhone it only shows on the Home Screen app. | `[browser]` `[db]` |
| The bell shows the right state: on, off, blocked in settings (with how to fix it), or "add to Home Screen first" on iPhone. **Send a test** sends one to all your devices. | `[browser]` |
| Encryption and signing follow the Web Push standards, checked against an independent implementation. | `[unit]` |
| Previews (demo mode) never send real notifications; turning them on shows a sample on that device. | `[browser]` |

**Player of the Match notifications** use the same devices and sender. Posting a result opens voting for a set
time (Team Settings, 12 hours unless changed); a timer (`pg_cron`, every 5 minutes, `potm_tick()`) sends the
reminder and posts the winners. The database writes the words and picks who gets each one
(`potm_push_targets`), so the function can't be made to send anything else.

| Expected behavior | Checked by |
|---|---|
| Posting a result tells everyone on the team that voting is open, with the score and when it closes. Tapping it opens the game. Captains can turn this off. | `[db]` `[unit]` |
| A set time before voting closes (3 hours unless changed, or off), players who played and haven't cast every vote are reminded how long is left. | `[db]` |
| Each goes out once; correcting the score doesn't send it again. | `[db]` |
| Game reminders ("Are you in?", "We need subs") and "Playing session N?" use the same devices and the **Game alerts** switch; their rules are in `docs/games.md` sections 5 and 6. | `[db]` |
| When voting closes, the winners are posted in Team Chat by "Scoreboard" (ties and roster names included), which notifies like any Team Chat message. Captains can turn this off. | `[db]` `[browser]` |

The sending keys (VAPID) are created once by `.github/workflows/functions.yml` and kept as Supabase function
secrets. They're never in the code. Never replace them: every phone that turned notifications on would
stop getting them until the player turns them on again.

## What automation can't check (try these by hand before relying on a big chat change)

The browser tests run in demo mode, so they can't cover real-time delivery between two people, the real
database's response times, or phone keyboards. After publishing a chat change, take two minutes with two
devices signed in as different players:

1. Send from one. It appears on the other within a second or two, without a refresh, and the other's Chat tab
   badge goes up when they're on another page.
2. On the receiving phone, scroll up in Team Chat, then send another message from the first device. The
   "↓ 1 new message" button appears, and tapping it scrolls down.
   Then lock the receiving phone (or switch to another app) for a minute, post from the first device, and come
   back to Team Chat: the message shows without leaving the room. The same after turning Airplane Mode on and off.
3. React on one, and the reaction appears on the other. Delete a message on one, and it disappears on the other.
4. Start a thread on one; it appears in the other's list. Close it, and the other's message box goes away.
5. On a phone, open Chat: the room list shows, and it scrolls by itself without moving the page. Tap a room, then ‹:
   back to the list. The same with the phone's back gesture.
6. On an iPhone, tap the message box: the keyboard opens, and the room name, newest messages and the box (with what you type) all stay visible above it. Send a message: the keyboard stays open. Tap outside the box: everything goes back to normal.
7. Notifications (after a change to them): on a phone, turn them on with the bell (on an iPhone, from the Home
   Screen app) and tap **Send a test**: it arrives within a few seconds. Close the app and post in Team Chat
   from the other device: the phone gets "Name: message", and tapping it opens Team Chat. With Team Chat open
   on the phone, post again: no notification. Close the app and post twice more: the Home Screen icon shows
   2. Open the app and read Team Chat, then close it: the number is gone.
8. @mentions (after a change to them): from one device, @mention the other player in a thread they've never
   opened. Their phone gets the notification, and their Chat tab shows "@1" until they open that thread.
9. Private chats (after a change to them): from one device, start a private chat with the other player. It shows
   up on the other device without a refresh, with a lock, and their phone gets a notification for its first
   message. A third player (or a captain) who isn't in it doesn't see it. Leave it on one device: it disappears
   there, and the other still sees the messages.

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
