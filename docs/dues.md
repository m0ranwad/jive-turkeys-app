# How dues work

This is the expected behavior of dues: what each session costs, who splits it, what a payment records,
and who can change it. If dues change on purpose, update this page and its tests in the same change.
The app records what teammates say was paid; payment services do not report back to it.

**Tests:** `[unit]` = `tests/unit/dues.test.js` (the named test group in each row) · `[browser]` =
`tests/e2e/dues.spec.js` (Playwright, demo mode, phone and desktop) · `[db]` =
`supabase/tests/dues.test.sql`. Other files are named where they check a rule. How to run them: the
Tests section of `CLAUDE.md`.

## 1. The session fee

| Rule | Checked by |
|---|---|
| Each season/session has its own fee: league fee + referee fee per game × number of games. The starting suggestion is $595 + $18 × 7 = $721. A new session suggests the previous session's fee when there is one; it is not saved until a captain saves it. Older saved fees that only have a total still work. | `[unit]` “the session fee”; `[browser]` “stepping between sessions, and setting a new session fee from the last one” |
| Only captains set or edit the fee. All three boxes need numbers of $0 or more; games must be whole, while league and referee fees can include cents. $0 is a valid free session. The fee box asks before saving $0 or more than double the existing fee (or the previous session's when setting a new one). | `[unit]` “the session fee”; `[browser]` “captains save league and referee fees with cents while games stay whole”, “the fee box won't save a blank or negative fee, and asks before $0 or a fee more than double”; `[db]` negative amounts and captain permissions |
| Without a saved fee, dues do not invent an amount to pay. Captains can set the fee; players can still choose who they pay together with. | `supabase/tests/dues_shares.test.sql` no-fee session; `tests/e2e/dues-couples.spec.js` “Pay together is available before the session fee is set” |

## 2. The split and rounding

| Rule | Checked by |
|---|---|
| Only teammates **Playing** on that session's roster split its fee, including roster names who have not joined. Available subs, unavailable teammates and anyone off that session's roster do not split it. A roster name linked to an account never counts twice. | `[unit]` “teammates who are not on the app”, “the database splits the same way”; `supabase/tests/dues_shares.test.sql`; `[browser]` “roster players who have not joined count in the split, and anyone can mark them paid” |
| Take the active players' custom amounts out of the fee first. Divide what is left by the number of active players without a custom amount, and round each even share **up to a whole dollar**. Work in cents before rounding: $721 across 10 players is $73 each, $730 total, $9 extra. A share that divides exactly does not gain a dollar. | `[unit]` “splitting the fee”; `supabase/tests/dues_shares.test.sql` and `[unit]` “the database splits the same way” use the same people and numbers |
| Even shares cannot fall below $0 when custom amounts exceed the fee. Custom amounts stay as set. If everyone has a custom amount, nobody covers the rest automatically. With no active players there are no shares. Team dues shows the session fee in its summary; **Fee details** opens the league/referee breakdown, total player shares and the amount above or below the fee. These are expected shares, not money already collected. | `[unit]` “splitting the fee”, “the database splits the same way”; `supabase/tests/dues_shares.test.sql`; `[browser]` custom amount and team summary checks |
| Paying does not change anyone's share. Collected means the amounts recorded as paid; still to collect means unpaid shares plus outstanding differences, including partial payments. | `[unit]` “splitting the fee”, “what paid players paid”, “part payments”; `[browser]` fee-change and part-payment tests; `supabase/tests/dues_changes.test.sql` marking paid adds no share change |

## 3. Custom amounts

| Rule | Checked by |
|---|---|
| Only captains set a custom amount, for one player in one session, including a roster name. It can be $0 or include cents, but cannot be negative. Clearing it returns that player to the even split. Changing it recalculates the other even shares without changing what anyone already paid. | `[db]` custom amounts and negative amounts; `[unit]` “splitting the fee”, “changes that move the split”; `[browser]` “a captain gives one player a custom amount, and the rest split what is left”; `supabase/tests/dues_changes.test.sql` custom amounts |
| A couple still has two individual shares. Giving one partner a custom amount changes that partner's share, not a single shared household fee. If anyone has a custom amount, Team dues labels the even amount as the **standard share**, rather than saying everyone pays it. | `[unit]` “couples who pay together”, “part payments”; `[browser]` couple and custom amount tests |

## 4. Couples who pay together

| Rule | Checked by |
|---|---|
| Any team member can link or unlink a couple, including two roster names or a roster name and an account. They pay together only while both are active in the session and each points to the other. Pairing does not change the split: each still owes their individual share. | `[unit]` “couples who pay together”, “teammates who are not on the app”; `[db]` couples and guests; `supabase/tests/couples.test.sql`; `[browser]` “a couple are marked paid together, and anyone can link a couple” |
| My dues shows both partners' outstanding amounts together. Marking both paid records each one's own share; an already paid partner is left alone. Reminders combine two partners who both owe into one line. If only one owes, only that person's balance is requested. | `[unit]` “what paid players paid”, “couples who pay together”, “the reminder”; `[browser]` “linking an unpaid partner shows the remaining payment to both players and keeps the earlier payment”, “partners include both outstanding differences after the session fee increases” |
| Couples are saved per session. A new link follows the session being played and later sessions, and future lists start with today's couples. A finished session keeps its old pairing. Between sessions, My dues can set up the next couple without changing the finished session's payments. Only captains correct an old session's pairing, under **More options → Edit who paid together**. | `[unit]` “couples who pay together”; `supabase/tests/couples.test.sql`; `tests/e2e/dues-couples.spec.js` finished-session, past-session correction and between-session tests |
| My dues asks a player who pays alone **Paying for two?** with a **Pay together** button at the top of the Pay card, until they link someone or pay. Otherwise Pay together (or **With [partner] · Change**) is a small link below the payment card. | `tests/e2e/dues-couples.spec.js` “a player who pays alone is asked about paying together in the Pay card, and it goes once they link someone” |
| Linking someone already paired asks first and names every partner who would be left paying alone. Cancel leaves both couples alone. A failed save leaves the choice available to try again. | `tests/e2e/dues-couples.spec.js` “relinking two couples names both displaced partners, supports cancellation, and keeps errors recoverable”; `[db]` relinking clears the previous partner |

## 5. Roster names and moving payments

| Rule | Checked by |
|---|---|
| A teammate who has not joined is a `team_guests` roster name. They split, pay and pair like an account, with `guest_id` instead of `user_id`. Captains add these names on Team; Dues sends them there rather than offering a separate roster. | `[unit]` “teammates who are not on the app”; `[db]` guests; `[browser]` roster names and “the Dues page sends captains to the Team page to add players” |
| Picking a roster name at sign-up, or a captain linking it to an existing account, moves its payments, amounts, history and partners to the account. The roster name remains saved but no longer counts separately. Only captains link someone else's account; a player can claim one unclaimed, unremoved name for themselves. | `[db]` guest link and claim tests; `supabase/tests/couples.test.sql`; `tests/unit/demo-backend.test.js` guest payment/link/claim tests |
| If both the account and roster name already have payment rows, the account's existing paid record wins; otherwise the roster name's paid record carries over. The account's custom amount wins when present; otherwise the roster name's custom amount carries over. Records of what moved and what was overwritten allow captains to undo a supported pick: both sides get back what they had. Some older links cannot be undone and say so. | `[db]` “linking” checks; `supabase/tests/unlink.test.sql`; `tests/unit/demo-backend.test.js` merged payments and undo tests; `tests/e2e/team-guests.spec.js` |

## 6. Each session's roster

The full rules for session questions, asking ahead and when statuses follow are in section 6 of
`docs/games.md`. Dues reads that same list, never a second roster.

| Rule | Checked by |
|---|---|
| Dues opens on the current session: the next game's, a later session captains asked about between sessions, otherwise the latest game's. With no games, it uses today's season/session. Seasons run November–April and use the year they start: January 2027 is **2026–27 · Session 2**. Stepping goes session 1, 2, 3, then the next season's session 1, and back. | `[unit]` “which session the captains see first”, “stepping between sessions”; `[browser]` stepping between sessions; `tests/unit/games.test.js`; `supabase/tests/roster.test.sql` |
| A saved session list determines who splits its fee, even if today's statuses have changed. A session without a list uses today's statuses. A session's list starts from everyone's statuses; while open it follows changes, but a finished session keeps its roster and dues. Team dues labels future shares as estimates while players confirm. Only captains correct **who was on** a past or finished session. | `[unit]` “the database splits the same way”, “which session status changes count for”; `supabase/tests/dues_shares.test.sql`, `roster.test.sql`; `tests/e2e/session-roster.spec.js` finished-session and correction tests |
| A future session asked about keeps explicit answers and follows today's statuses for anyone still to answer, even after captains stop asking. Dues waits for that refresh and for all required lists to load; on failure it offers **Try again**, with nothing to pay or mark from an incomplete split. | `tests/unit/roster.test.js`, `demo-backend.test.js`; `supabase/tests/session_asks.test.sql`; `tests/e2e/session-ask.spec.js` stopped-list refresh tests; `tests/e2e/session-roster.spec.js` “if who was on each session doesn't load, Dues says so and offers nothing to pay until it does” |

## 7. Marking paid, not paid and the history

| Rule | Checked by |
|---|---|
| Any joined team member can mark themselves or any teammate paid, including roster names, for the selected session. The record keeps the paid date, who marked it and each player's amount at that time (`paid_amount`); `mark_dues_paid()` writes an event in `dues_history`. A couple's action records each person separately. | `[db]` player, guest and amount/history checks; `[browser]` “marking yourself paid is one tap; marking not paid asks first and stays in your history”, “anyone can mark teammates paid in one tap, but undoing one takes two taps and is kept in the history”; `tests/unit/demo-backend.test.js` paid amounts/history |
| Marking an already paid player paid again changes nothing unless a larger amount is being recorded. It preserves the original date and adds no history for a repeated or smaller amount. Paying a difference saves the new cumulative amount, date and actor, leaving earlier amounts in history. | `[db]` repeat-payment and difference checks; `[unit]` “what paid players paid”; `tests/unit/demo-backend.test.js` repeat-payment and difference tests; `[browser]` fee-change tests |
| Marking not paid always asks first. Cancel keeps the payment; confirm clears its paid flag, date, actor and amount, without clearing its custom amount. A not-paid event records who changed it; earlier paid events retain their dates and amounts. | `[db]` unmark/history checks; `[browser]` marking-yourself and marking-teammates tests; `tests/unit/demo-backend.test.js` history tests |
| Team members can read payment history. Neither players nor captains can insert, edit or delete its events directly. Share changes are a separate, protected `dues_changes` record written by triggers for fees, custom amounts and active-roster changes; simply starting a list or marking paid is not a share change. | `[db]` history permissions; `supabase/tests/dues_changes.test.sql`; `[unit]` “changes that move the split” |
| My dues opens for players, Team dues for captains. A player's payment sheet leads with amount, status and payment action. **More options** reveals one form at a time for partial payments, pairing and captain-only custom amounts. History and Payment details open on request. | `[browser]` “a player sees what they owe for themselves and their partner, with Venmo and PayPal buttons”, “marking paid has a compact sheet, and rare actions reveal only the chosen form”; `tests/e2e/dues-couples.spec.js` past-session correction |

## 8. Partial payments, changed shares and differences

| Rule | Checked by |
|---|---|
| **Paid part of it?** records a positive amount up to what is still owed, in cents, added to what was paid before. A couple's payment is split in proportion to what each still owes, never above either balance; rounding cents leaves the final remainder with the last person. The saved amounts are cumulative, not just the latest instalment. | `[unit]` “part payments”; `[browser]` “a player pays part of their share, and the rest stays on the list to pay”, “anyone can record part of a couple's payment, split between them by their shares”; `[db]` cumulative amount/history checks |
| A fee, roster or custom-amount change never rewrites what was paid. If the share rises, only the positive difference remains due. If it falls, the recorded payment stays as it was: there is no automatic refund or redistribution to other players. | `[unit]` “what paid players paid”; `[db]` smaller-amount check; `[browser]` “players keep what they paid when the fee changes, and the difference can be marked paid” |
| Someone who paid less than their share was when last marked is **Part paid**, under Still to pay, and does not count as fully paid. Someone who paid the whole share and then owes a difference is **Paid · owes $X**, under Paid, counted in the paid total. Team dues says **N paid players owe more**; My dues' team progress says **N owe a top-up**. Reconstruct the earlier share by undoing later share changes; if it cannot be known, treat an outstanding paid balance as a top-up. | `[unit]` “paid part, or paid it all and the share went up”; `[browser]` part-payment and fee-change tests |
| **Why your share changed** shows the latest relevant change, with all relevant changes and payment history under Payment details. An even share can be affected by the fee, roster and anyone's custom amount; a custom share only by its own custom-amount changes. | `[unit]` “changes that move the split”; `[browser]` “a player whose share went up after they paid sees the difference and pays it”; `supabase/tests/dues_changes.test.sql` |
| Payments made before amounts were recorded are filled with the share shown at the time that update runs, along with the latest paid history entry. Existing recorded amounts stay untouched. If an active player's older paid amount is still null, use the current share. Older clients without amounts use the database's matching split; an off-roster person may have no amount to record. | `supabase/tests/dues_shares.test.sql` backfill and older-client checks; `[unit]` “what paid players paid”; `[db]` no-fee/without-amounts checks |

## 9. Paid, not playing

| Rule | Checked by |
|---|---|
| Someone who paid but is unavailable, available to sub, off this session's roster or removed from the team shows under **Paid, not playing**, with what they paid. They owe nothing for that session, do not count in its active paid count and their recorded amount still counts in Collected, with a short note directly below that total. A linked roster name's leftover rows do not duplicate its account's payments. | `[unit]` “players who paid and are not playing”; `[browser]` “players keep what they paid when the fee changes, and the difference can be marked paid”, “a player who paid and is unavailable the session sees that they owe nothing” |
| An older off-roster payment without a recorded amount shows that the amount was not recorded; it does not invent a share or add an unknown amount to Collected. | `[unit]` “players who paid and are not playing”; `supabase/tests/dues_shares.test.sql` off-roster backfill check |

## 10. Permissions and payment links

| Rule | Checked by |
|---|---|
| Signed-out visitors and accounts that have not joined the team cannot read dues or change payments or couples. Joined players see the whole team's dues and can record payments and current couples. Only captains change fees, custom amounts, payment links and past-session rosters or couples. History remains protected even from captains. | `[db]` captain and signed-out checks; `supabase/tests/membership.test.sql`, `roster.test.sql`, `couples.test.sql`; `[browser]` captain-only controls; `tests/e2e/session-roster.spec.js`, `dues-couples.spec.js` |
| Captains set Venmo, PayPal, Cash App, Zelle details and an optional payment note. Names, @handles and profile links are tidied on save. Unconfigured services are left out; with no service or note, players see **Ask your captain how to pay**. | `[unit]` “pay buttons”, “pasted payment links”; `[browser]` “a captain pastes payment links, and players get the buttons”; `[db]` payment-setting permissions |
| Venmo, PayPal.Me and Cash App buttons fill in the outstanding amount, including cents. Venmo also carries a note naming the season/session and the people the payment covers. A couple pays its outstanding combined amount; a partial payment or top-up button requests only what remains. Zelle details can be copied. Other PayPal links, including QR links, open unchanged and say to enter the amount. | `[unit]` “pay buttons”, “pasted payment links”; `[browser]` player payment buttons, couple balances and part-payment tests |
| Brian's requested PayPal.Me destination is **https://paypal.me/kircherbrian**. The payment button adds the amount, for example `https://paypal.me/kircherbrian/122` for a couple owing $122. Captains can still change the saved destination later. | `[browser]` “a player sees what they owe for themselves and their partner, with Venmo and PayPal buttons”; `tests/unit/demo-backend.test.js` sample payment settings |
| Opening a payment link does not mark anyone paid: teammates record it separately after paying. The site does not process, verify or automatically reconcile transfers. | `[browser]` “opening PayPal leaves the dues unpaid until a teammate records the payment” |
| Captains can copy a reminder or post it in Team Chat: the fee breakdown, active count, who still owes, special amounts and differences, and a link to Dues. Chat reminders mention each person, including both partners. | `[unit]` “the reminder”; `[browser]` “a captain edits the fee and copies a reminder”; `tests/e2e/team-chat-posts.spec.js` |

All rules above have checks in the named suites. Keep the JavaScript split and `dues_shares()` examples
in step when the split changes; a passing screen test alone does not check the database's calculation.
