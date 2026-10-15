# Game day: how it should work

The expected behavior of the schedule, RSVPs, headcounts, results, stats and Player of the Match. Each rule
says which automated test checks it, so a change that breaks one shows up as a red check before anyone can
publish it. If you change how game day works on purpose, update this page and the tests in the same change.

**Tests:** `[browser]` = `tests/e2e/game-day.spec.js` and the other `tests/e2e/*.spec.js` (Playwright, demo
mode, phone and desktop) · `[db]` = `supabase/tests/games.test.sql` and `potm.test.sql` · `[unit]` =
`tests/unit/game-day.test.js`, `games.test.js`, `results.test.js`. How to run them: see the Tests section of
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
| A red card sits the player out the next game with a result after it, and only that one. Blue cards never do. | `[unit]` |

## 2. Games and results

| Rule | Checked by |
|---|---|
| Only captains add, change or delete games, and enter results and stat lines. | `[db]` |
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

