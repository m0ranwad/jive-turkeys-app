# Player accounts

Google and email/password sign-in keep working. Login accepts either an email or a username.
Email signup still verifies the email with the existing code/link flow.

**Username (no email)** on Create account asks for a unique username, password, confirmation,
and the team code. Usernames are case-insensitive, 3–24 ASCII letters, digits or underscores;
they are separate from display names. The account service verifies the team code before creating
anything. New accounts are ordinary players and proceed to the usual roster-name/profile setup.
No personal email address or email verification is needed.

After signup, the player must save their recovery code before continuing. It has 128 random bits
and is shown once. Forgot password offers email recovery or **Use a recovery code instead**.
Username, saved code and a new password reset that same account. A successful reset replaces the
code and shows its replacement; old codes cannot be reused. Without the password, recovery code,
or another existing sign-in method, the player cannot recover the account automatically.
Signed-in players can replace a lost recovery code from My Profile by confirming their password.

Existing Google/email players should sign in first and choose **My Profile → Add a username**.
The service verifies their current session and team membership. Adding a username updates the
password on that same Supabase identity (also the email sign-in password); it never creates or
merges identities. Their profile, Google login, stats, RSVPs and dues keep the same user ID.
Do not guess account ownership from a display name, username, or unverified email.

## Service and data

- `supabase/functions/username-auth` uses the shared, dependency-injected handler in `_shared/`.
  The built-in Supabase service credential stays server-side. Each password sign-in uses a fresh
  auth client so no service client inherits a player session.
- Email-free accounts have a random undeliverable internal Supabase email under
  `players.jiveturkeys.invalid`. It is hidden from the profile and never copied to player contact
  details. Google/email accounts retain their email and existing identities.
- `username_accounts` is a credential table, deliberately absent from the generic entity API.
  Players can select only their own user ID and username. No player, including captains, can
  select recovery hashes or write aliases. The service alone can read/write them.
- `username_auth_limits` is also service-only. Atomic counters limit all requests to 60 per
  connecting IP per 15 minutes, each username/action to 10 (signup 5), and account creation to
  10 per IP. IP/username counter keys are hashed. Limits fail closed on database errors.
- Recovery claims atomically replace the matching hash. A password-update failure restores only
  that request's claim. Responses never expose stored hashes, passwords, or another user's email.
- `.github/workflows/functions.yml` publishes the account service alongside the notification
  service. New account data is additive; no existing team records are rewritten.

Tests cover the account handler, real-backend session integration, preview account behavior,
database privileges/rate limits/recovery claims, and mobile/desktop signup, linking and recovery.
Previews use pretend accounts and cannot validate Google's live OAuth or the hosted Supabase service.
