# Game day: how it should work

The expected behavior of the schedule, RSVPs, headcounts, results, stats and Player of the Match. Each rule
says which automated test checks it, so a change that breaks one shows up as a red check before anyone can
publish it. If you change how game day works on purpose, update this page and the tests in the same change.

**Tests:** `[browser]` = `tests/e2e/game-day.spec.js` and the other `tests/e2e/*.spec.js` (Playwright, demo
mode, phone and desktop) · `[db]` = `supabase/tests/games.test.sql`, `potm.test.sql`, `session_asks.test.sql` and `session_notify.test.sql` ·
`[unit]` = `tests/unit/game-day.test.js`, `games.test.js`, `results.test.js`, `roster.test.js`. How to run them: see the Tests section of
`CLAUDE.md`.

## 1. RSVPs and the headcount

| Rule | Checked by |
|---|---|
| Players answer IN, MAYBE or OUT for themselves; the headcount updates right away and after a reload. | `[browser]` |
| The soonest game without a result is the **Next game** card at the top of Schedule, with its headcount and the player's answer. Each later upcoming game can be answered under its card in the list. | `[browser]` |
| On Schedule, the next game's session and the one before it stay open; older sessions fold under **Past sessions**. | `[browser]` |
| Players can't answer, change or take back anyone else's RSVP. Captains can answer for anyone, including roster names who haven't joined. | `[db]` |
| Active players who haven't answered are **No reply**; Sub Pool and On Break players who haven't are **Subs**, so reminders don't nag them. | `[unit]` |
| A woman playing goalie doesn't count toward the women-on-the-field minimum. | `[unit]` |
| The game is short when IN is under the minimum players or women on the field (8 and 3 unless captains change them). | `[unit]` |
| Players off the roster (removed, or roster names who joined under their own account) aren't counted. | `[unit]` |
| A roster name's RSVPs, stat lines and Player of the Match votes move to the account that picks it, and go back to the grey card if a captain unlinks that pick (`supabase/tests/unlink.test.sql`). | `[db]` |
| A red card sits the player out the next game with a result after it, and only that one. Blue cards never do. | `[unit]` |

## 2. Games and results

| Rule | Checked by |
|---|---|
| Only captains add, change or delete games, and enter results and stat lines. | `[db]` |
| A season runs November to April (session 1 Nov–Dec, 2 Jan–Feb, 3 Mar–Apr) and is filed under the year it starts in. It's shown as both years, "2026–27 · Session 2", on Schedule, game pages, Stats and Dues, and in the note on dues payments. | `[unit]` `[browser]` |
| A captain's new games (Add game, Import) start on the session captains are asking about ahead; otherwise the newest session on the schedule while it has games to come, else the one after it. Captains can pick another season or session. | `[unit]` `[browser]` |
| A captain's result shows on the game and in Stats. | `[browser]` |
| A result saves whole or not at all: the score, stat lines and fill-ins together (`save_game_result()`). If it doesn't go through, the captain is told why and keeps what they entered. | `[db]` `[browser]` |
| Our score adds up the players' and fill-ins' goals until a captain changes it; men stop at two goals. | `[unit]` `[browser]` |
| Deleting a game takes its RSVPs, stat lines, votes and fill-ins with it, and nothing else. | `[db]` |
| The record counts wins, losses, draws and goals from games with a result only, overall, per season and session, and per opponent. | `[unit]` |
| The leaderboard and career stats add up games played, goals, assists, cards and Player of the Match awards. | `[unit]` |

## 3. Player of the Match

| Rule | Checked by |
|---|---|
| Players who played vote for a teammate who played (roster names included), never themselves, and only as themselves. | `[db]` |
| A vote can be changed until voting closes. | `[browser]` `[db]` |
| Voting opens when the result is posted and closes after the team's window (12 hours unless changed). After that, votes can't be cast, changed or taken back, and the buttons go away. | `[db]` `[browser]` |
| The most votes wins each award; ties share it. | `[unit]` `[db]` |
| Notifications and the winners post: see section 7 of `docs/chat.md`. | |

## 4. Importing a league schedule

| Rule | Checked by |
|---|---|
| Date, time, field and opponent columns are found by name, in `.xlsx` and `.csv` files, below any title rows. | `[unit]` |
| A league sheet with Home and Away columns keeps only Jive Turkeys games, with the other team as the opponent. If our name isn't in it at all, every game is kept. | `[unit]` |
| Without headers, each cell's role is guessed from what it looks like. | `[unit]` |
| A date with no time gets no time (not 12:00 AM). | `[unit]` |
| A date with no year takes it from the season being imported: November and December are its first year, January to April the next ("Sat Jan 2" in 2026–27 is January 2, 2027). A year in the sheet always wins. | `[unit]` `[browser]` |

## 5. Game reminders

A timer (`pg_cron`, every 5 minutes, `game_reminders_tick()`) sends them through `notify-chat`; the database writes
the words and picks who gets each one (`game_reminder_targets`).

| Rule | Checked by |
|---|---|
| A set time before kickoff (6 hours unless captains change it in Team Settings, or turn reminders off), Active players who haven't answered get "Are you in?" with the day, time, opponent and field. Tapping it opens the game. | `[db]` `[unit]` |
| When we're short then, Sub Pool and On Break players who haven't said OUT get "We need subs" with how many (and how many women). If only women are short, only women are asked. If someone drops out later, up to kickoff, it goes out then. | `[db]` |
| The headcount behind it is the site's: a woman in goal doesn't count toward the women, roster names count, and captains' minimums apply. | `[db]` |
| Each goes out once per game; none after kickoff or once there's a result; never to players who turned **Game alerts** off. | `[db]` |
| Kickoff times are read the way captains type them ("19:00", "7:00 PM", "7pm"), in Eastern time; a game with no time gets no reminder. | `[db]` |

## 6. "Playing session N?"

Each session keeps its own list of who's playing (`session_roster`); a new session's list starts as a copy of
everyone's status, and players confirm theirs. Captains can ask ahead (`session_asks`), before the league sends
the schedule or while this session still has games left.

| Rule | Checked by |
|---|---|
| The current session is the next game's. Between sessions (no game coming up), it's the next session captains asked about; otherwise the latest game's. The site and the database agree (`currentSession()`, `roster_current_session()`). | `[unit]` `[db]` |
| Once a session's games are all played and nothing else is on the schedule (and captains aren't asking about the next one), it's over and keeps its list, and so its dues: status changes (My Profile, Team page), new players, new roster names and anyone taken off the team don't change it. They change everyone's status right now, which the next session's list starts from when its first game is on the schedule or captains ask. The Dues page still opens on it, and captains correct it with **Change who was on session N**, like any past session. My Profile and the Team page say status changes count from the next session. The site and the database agree (`openSession()`, `roster_open_session()`). | `[unit]` `[db]` `[browser]` |
| The current session's question is asked until its first game, under the Next game card. | `[browser]` |
| Only captains ask about a later session, from the Team page, with its first game's date. They can change the date or stop asking until its first game; asking about a session that's over or has started is refused. Asking starts its list (everyone's status, nobody answered). | `[db]` `[browser]` |
| While this session has games left, players see the later session's question under the Next game card ("Asking ahead"). Their answer goes into that session's list only: this session's list and dues, and their status right now, don't change. Once answered it shrinks to one line with **Change**. | `[db]` `[browser]` |
| Players are asked one session at a time: the first they haven't answered, else the latest one asked. | `[unit]` `[browser]` |
| Until it starts, a session asked about ahead keeps up with today's statuses for anyone who hasn't answered it, adds new players and takes off anyone removed. That isn't recorded as a dues change; answers are. | `[db]` `[unit]` |
| A player taken off the team is off the session asked about even if they'd answered. Added back, they're on it again, following their status, and asked again. | `[db]` `[unit]` |
| Asked again after captains stopped, the session's list catches up with what changed in between (statuses of anyone still to answer, new players, anyone removed) and keeps the answers given. | `[db]` `[unit]` |
| An answer given for a roster name ahead (by a captain) goes with the name: the new player who picks it has that answer, not a fresh "still to answer". Undoing the pick gives the name its answer back and puts the account back on the list, still to answer. | `[db]` `[unit]` |
| Between sessions, the question is the **Next up** card at the top of Schedule, with the answers so far (in, women, subs, sitting out, still to answer). Status changes made then (My Profile, Team page) count for that session, not the one that just ended. | `[db]` `[browser]` |
| When an asked session becomes the current one, the answers given ahead become everyone's status right now, once, without being recorded again as dues changes. | `[db]` `[unit]` |
| Captains see how many have answered and who hasn't on the Team page, and can answer for anyone, roster names included. Players don't see that list. Between sessions that session is the current one, so a captain's answer is that player's status right now, as when tapping a status on the Team page. | `[browser]` |
| Answers stop once the session's first game is played. | `[db]` |

**Notifications** (under **Game alerts**, through `notify-chat`; the database writes the words and picks who gets
each one, `session_ask_targets()`). A session starts on its first game's date once the schedule is up, else on
the date captains gave.

| Rule | Checked by |
|---|---|
| When captains ask about a session, everyone on its list gets "📋 Playing session N?" with when it starts; not the captain who asked. Tapping it opens Schedule. Changing the date, or stopping and asking again, doesn't send it again. | `[db]` `[unit]` |
| At noon (Eastern) a week before a session starts, anyone asked who hasn't answered gets a reminder: whenever the question is open, whether captains asked ahead or it opened on its own once the schedule was up. A timer (`pg_cron`, every 5 minutes, `session_asks_tick()`) sends it. | `[db]` |
| If the question opens later than that, the reminder goes at the next chance between noon and 9 PM, at least a day after the "captains asked" one, and never on the first game's day. | `[db]` |
| Each goes out once per session, only to players on the team who kept **Game alerts** on, never to anyone taken off the team or not yet in with the team code. Nothing once the first game is played. | `[db]` |
