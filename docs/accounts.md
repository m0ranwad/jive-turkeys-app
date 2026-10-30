# Player accounts

Google and email/password sign-in keep working. Login accepts either an email or a username, and
ignores capital letters and stray spaces in either. Email signup still verifies the email with the
existing code/link flow. Every password box has a **Show** button instead of a second "confirm"
box. A failed log in adds a hint: for a username, that it isn't your name on the team and that a
captain can help; for an email, to try Continue with Google or Forgot password.
The Show button has a touch area at least 44px high on every password form.

**Username (no email)** is the first and preselected choice on Create account: a unique username,
a password and the team code. Usernames are case-insensitive, 3–24 characters, letters and numbers
plus dots, dashes and underscores, starting with a letter or number; they are separate from display
names. A username with spaces gets a suggestion ("Josh Smith" → "How about josh_smith?"). The account
service verifies the team code before creating anything, and joins the new account with the same
database code that checks the code on the site (`join_team_as()`, which `join_team()` uses too).
New accounts are ordinary players and go straight to the usual roster-name/profile setup. No email
address, email verification or recovery code is needed.

## Forgotten passwords and usernames

A captain resets a username player's password. In the player's options on the Team page, captains
see **Signs in with the username …** (so they can also tell a player who forgot it) and **Reset
[name]'s password**. That makes a one-time code like `K7QM-4XPA` (8 letters and numbers, without
0, O, 1, I or L) that works for 24 hours; a new code replaces the last one. **Text it** opens the
phone's messages with the instructions (to the player's phone number, if their profile has one), or
**Copy message**. The player taps **Forgot password?** → **Signed up with a username? Use a code
from a captain**, and enters their username, the code (any case, dash optional) and a new password.
That signs them in. Changing the password ends every session on the account, so anyone who had
the old password is signed out (Supabase does this; the service also ends any other session as a
safeguard). The code is used up only once the new password is in, so if Supabase turns down the
password, the player picks another with the same code.

Email players reset by email as before. Only username accounts get captain codes.

## Adding a username to a Google or email account

Existing Google/email players sign in first and choose **My Profile → Add a username**. The service
verifies their current session and team membership. Email/password players enter the password they
already have; it stays their password for both. Google-only players choose a password, which needs a
sign-in within the last 10 minutes; setting it signs them out everywhere, so the service signs them
back in with it. It never creates or merges identities. Their profile, Google login, stats, RSVPs and
dues keep the same user ID. Do not guess account ownership from a display name, username, or
unverified email.

## Service and data

- `supabase/functions/username-auth` uses the shared, dependency-injected handler in `_shared/`
  (actions `signup`, `signin`, `link`, `issue-reset` for captains, `reset`). The built-in Supabase
  service credential stays server-side (`_shared/secret-key.ts`, shared with the other functions).
  Each password sign-in uses a fresh auth client so no service client inherits a player session,
  and a sign-in that only checks a password is ended right away.
- Email-free accounts have a random undeliverable internal Supabase email under
  `players.jiveturkeys.invalid`. `handle_new_user()` leaves it out of `public.users` (email is
  null there), and `me()` hides it from the profile. Google/email accounts retain their email and
  existing identities.
- `username_accounts` is a credential table, deliberately absent from the generic entity API
  (`api.users.usernames()` reads it). Players can select their own user ID and username; captains
  can select everyone's. Nobody can select reset codes (stored only as SHA-256 hashes, with
  `reset_expires_at` and `reset_by`) or write rows. The service alone can read/write them.
- `username_auth_limits` is also service-only. Atomic counters, per 15 minutes: 300 requests per
  connecting address (a whole team on the gym's Wi-Fi shares one); sign-in and reset codes 10 per
  username from one address and 50 per username overall, so guesses from elsewhere can't lock a
  player out on their own phone; signup 5 per username and 40 per address; adding a username 10 per
  account; making reset codes 30 per captain. The address is `cf-connecting-ip`, else the first
  `X-Forwarded-For` entry; with neither, all requests share one counter and the function logs a
  warning. Keys are hashed. A new key takes over a row whose window is over, so the table stays
  small without deleting rows. Limits fail closed on database errors.
- Responses never expose stored hashes, passwords, or another user's email.
- Failures are logged in the function's logs (what failed, never what the player typed). Supabase
  Auth's password rules come back to the player as they are (say, a password that's too short);
  its other refusals get a message saying to use Google or email for now and tell a captain, rather
  than "try again shortly".
- `.github/workflows/functions.yml` publishes the account service alongside the notification
  service, and takes it off Supabase once its folder is gone (so an undo keeps that file; see
  CLAUDE.md). A failed lookup or deletion fails that step; it never reports that the service
  is absent after a failed lookup. New account data is additive; no existing team records are rewritten.

In previews, Jordan Rivera has the username `jordan` (password `demo1234`), so captains can try
**Reset Jordan's password** on the Team page.
The no-signal switch (`jt_demo_offline`) makes creating a reset code fail with **That didn't save**;
retrying after signal is restored works. Preview operations refresh saved data before using or
changing it, so a code replaced in another tab is rejected, and an older tab cannot save the old
password or used code back over a completed reset.

Tests cover the account handler, real-backend session integration, preview account behavior,
database privileges and rate limits, and mobile/desktop signup, sign-in hints, linking and captain
resets. Previews use pretend accounts and cannot validate Google's live OAuth or the hosted Supabase
service.
