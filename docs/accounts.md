# Player accounts

Google and email/password sign-in keep working. Login accepts either an email or a username.
Email signup still verifies the email with the existing code/link flow.

**Username (no email)** on Create account asks for a unique username, password, confirmation,
and the team code. Usernames are case-insensitive, 3–24 ASCII letters, digits or underscores;
they are separate from display names. The account service verifies the team code before creating
anything, and joins the new account with the same database code that checks the code on the site
(`join_team_as()`, which `join_team()` uses too). New accounts are ordinary players and proceed to
the usual roster-name/profile setup. No personal email address or email verification is needed.

After signup, the player must save their recovery code before continuing. It has 128 random bits
and is shown once. Until they tick "I've saved my recovery code", it stays on that device and comes
up before every other screen for that signed-in player (`RecoveryCodeGate`), so a reload or a tap
on another tab can't lose it. The same goes for a code from adding a username, replacing a code,
or a reset.

Forgot password offers email recovery or **Use a recovery code instead**. Username, saved code and
a new password reset that same account. A successful reset replaces the code, signs the player in
with the new password, ends every other session on the account (anyone who had the old password is
signed out), and shows the new code; old codes cannot be reused. Without the password, recovery
code, or another existing sign-in method, the player cannot recover the account automatically.
Signed-in players can replace a lost recovery code from My Profile by confirming their password.

Existing Google/email players should sign in first and choose **My Profile → Add a username**.
The service verifies their current session and team membership. Adding a username sets the
password on that same Supabase identity (also the email sign-in password), so the owner proves it's
them first: email/password accounts enter their current password, and Google-only accounts must
have signed in within the last 10 minutes. It never creates or merges identities. Their profile,
Google login, stats, RSVPs and dues keep the same user ID. Do not guess account ownership from a
display name, username, or unverified email.

## Service and data

- `supabase/functions/username-auth` uses the shared, dependency-injected handler in `_shared/`.
  The built-in Supabase service credential stays server-side (`_shared/secret-key.ts`, shared with
  the other functions). Each password sign-in uses a fresh auth client so no service client
  inherits a player session, and a sign-in that only checks a password is ended right away.
- Email-free accounts have a random undeliverable internal Supabase email under
  `players.jiveturkeys.invalid`. `handle_new_user()` leaves it out of `public.users` (email is
  null there), and `me()` hides it from the profile. Google/email accounts retain their email and
  existing identities.
- `username_accounts` is a credential table, deliberately absent from the generic entity API.
  Players can select only their own user ID and username. No player, including captains, can
  select recovery hashes or write aliases. The service alone can read/write them.
- `username_auth_limits` is also service-only. Atomic counters, per 15 minutes: 60 requests per
  connecting address; sign-in 10 per username from one address and 50 per username overall, so
  guesses from elsewhere can't lock a player out on their own phone; signup 5 per username and 10
  per address; adding a username and replacing a code 10 per account. Recovery has only the
  address limit, since nobody can guess a 128-bit code. The address is `cf-connecting-ip`, else the
  first `X-Forwarded-For` entry; with neither, all requests share one counter and the function logs
  a warning. Keys are hashed. A new key takes over a row whose window is over, so the table stays
  small without deleting rows. Limits fail closed on database errors.
- Recovery claims atomically replace the matching hash. A password-update failure restores only
  that request's claim. Responses never expose stored hashes, passwords, or another user's email.
- Failures are logged in the function's logs (what failed, never what the player typed). Supabase
  Auth's password rules come back to the player as they are (say, a password that's too short);
  its other refusals get a message saying to use Google or email for now and tell a captain, rather
  than "try again shortly".
- `.github/workflows/functions.yml` publishes the account service alongside the notification
  service, and takes it off Supabase once its folder is gone (so an undo keeps that file; see
  CLAUDE.md). New account data is additive; no existing team records are rewritten.

In previews, Jordan Rivera has the username `jordan` (password `demo1234`, recovery code
`aaaa-bbbb-cccc-dddd-eeee-ffff-0000-1111`).

Tests cover the account handler, real-backend session integration, preview account behavior,
database privileges/rate limits/recovery claims, and mobile/desktop signup, linking and recovery.
Previews use pretend accounts and cannot validate Google's live OAuth or the hosted Supabase service.
