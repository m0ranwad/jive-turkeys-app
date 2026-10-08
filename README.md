# Jive Turkeys Team Hub

The team's schedule, RSVPs, stats, dues, chat and field rules, live at **https://jiveturkeys.app**.
It's a rebuild of the original Base44 app (`jive-turkey-tactics.base44.app`), and we own the code, data
and hosting outright.

- **Frontend:** React + Vite + Tailwind, hosted on Cloudflare Workers.
- **Backend:** [Supabase](https://supabase.com): Postgres with row-level security, logins (email + 6-digit
  code, optional Google) and live chat.

## How changes are made

Two co-owners change the site. The original creator isn't a developer and works the way he did in
Base44. He describes a change to Claude, looks at a preview, and says "publish". Claude handles git,
GitHub and deployment itself, following [CLAUDE.md](CLAUDE.md). He never deals with branches, pull
requests or merges.

1. **Ask:** in claude.ai/code (or the Code tab in the Claude app), with this repo selected, describe the
   change in plain English.
2. **Preview:** Claude builds it on a branch, opens a pull request behind the scenes, and replies with
   the Cloudflare preview link (about a minute after the push). In the Claude desktop app's Local mode,
   the site also runs live beside the chat (see [CLAUDE.md](CLAUDE.md)). Previews run in **demo mode
   with sample players and games** (see [vite.config.js](vite.config.js)), so trying something out
   can't touch real team data. Sign in to a preview as `captain@demo.test` / `demo1234`.
3. **Publish:** on "publish", Claude merges to `main`. Cloudflare puts it live within about two minutes.
4. **Undo:** on "undo that", Claude reverts the change on `main`.

**Database changes** publish automatically. When a change adds a file under `supabase/migrations/`,
the [Database update](.github/workflows/database.yml) GitHub Action applies it to the live database
when it reaches `main`. Anything that drops, truncates, deletes or renames is refused until a co-owner
approves it, after which Claude adds `-- owner-approved` to the file. Undoing a change that added a
migration keeps the migration file (the unused column stays), because deleting an applied migration
breaks every later database update.

There are no required approvals: changes go live without review, as they did in Base44. The safety nets:
- Claude checks the build before showing anything.
- Previews use sample data.
- Every change is in GitHub's history and can be undone.
- Destructive database changes are blocked.
- Row-level security still governs who can see and edit what.

The other co-owner can work the same way, or locally with Claude Code.

## Where everything lives

| Piece | Where | Notes |
|---|---|---|
| Code | GitHub `m0ranwad/jive-turkeys-app` (public) | No secrets in the repo |
| Hosting | Cloudflare Worker `jive-turkeys-app` | Domain `jiveturkeys.app`. Settings are pinned in [wrangler.jsonc](wrangler.jsonc): workers.dev address off, preview URLs on |
| Database and logins | Supabase project `alsskultsdgcbxlukznv` (free plan) | URL `https://alsskultsdgcbxlukznv.supabase.co` |
| Email | Resend, sending as `team@jiveturkeys.app` | Plugged into Supabase as custom SMTP |
| Google sign-in | Google Auth Platform project "Jive Turkeys" | Free. Needs the [/privacy](src/pages/LegalPages.jsx) and /terms pages |
| Database updates | GitHub Actions secret `SUPABASE_DB_URL` | Supabase **Session pooler** string; GitHub's runners are IPv4-only |
| Domain | `jiveturkeys.app` on Cloudflare | The only running cost |

Local-only reference copies of keys live in `.env.local`, which git ignores. Never commit keys.

## Setup status (October 8, 2026)

- [x] Domain on Cloudflare
- [x] Supabase project; setup SQL run (tables, security rules, field rules)
- [x] Supabase sign-in settings; redirect URLs `https://jiveturkeys.app/**` and `http://localhost:5173/**`
- [x] Email through Resend SMTP, plus the "Confirm signup" code template
- [x] GitHub repo, and the Cloudflare Worker deploying `main` to `jiveturkeys.app`
- [x] Automatic database updates: `SUPABASE_DB_URL` secret added, test run passed
- [x] Privacy and terms pages live (required by Google)
- [x] Google sign-in: Branding filled in, app published, client ID and secret in Supabase
- [x] Claim captain: the owner signed up first at https://jiveturkeys.app
- [ ] Give the creator access (in progress):
  - [x] Preview flow tested end to end. Cloudflare's Worker Previews needed a `previews` block in
        `wrangler.jsonc`. Previews answer "Not found" for any path but `/` (Cloudflare beta limitation),
        so Claude shares only the preview's home link.
  - [x] Walkthrough for him written (a shareable page from the owner's Claude account)
  - [ ] Invite him as a collaborator (Settings → Collaborators)
  - [ ] Install the Claude GitHub app on this repo only (github.com/apps/claude)
  - [x] Turn on Settings → General → **Automatically delete head branches** (cloud sessions can't
        delete branches)
  - [ ] He connects at claude.ai/code (Claude Pro or higher) and runs the setup check from the walkthrough
  - [ ] After he signs up on the site, make him a captain from the Team page
  - [ ] Optional: add him to the Cloudflare account and the Supabase organization so he co-owns those
        too (Claude doesn't need this)
- [ ] Switch over: share the link with the team and have the Base44 app deleted (its API exposes player
      emails and phones)
- Deferred: the **Invite teammate** button ([issue #1](https://github.com/m0ranwad/jive-turkeys-app/issues/1)).
  Its function isn't deployed, so players sign up themselves for now.

## Tests

Chat behavior, the database rules, and the safety of every database update are checked automatically on each
pull request (the **Tests** workflow). [docs/chat.md](docs/chat.md) lists what the chat should do and which test
covers each rule. Every new migration is rehearsed on a copy of the database with sample data, and if it would
remove or change existing rows, the check fails and the Database update workflow refuses to touch the live
database. Commands are in [CLAUDE.md](CLAUDE.md#tests).

## Run it locally

```bash
npm install
npm run dev
```

With no Supabase settings, the app runs in **demo mode** with sample data stored in your browser.
Sign in as `captain@demo.test` / `demo1234`. To use the real database, put `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local` (see [.env.example](.env.example)).

## Setting it up from scratch

For reference, in case this ever needs rebuilding:

1. **Supabase:** create a project (free plan). In **Security options**, keep the Data API on and leave
   **Automatically expose new tables** unchecked. Run
   [supabase/migrations/20261008000000_init.sql](supabase/migrations/20261008000000_init.sql) in the SQL
   Editor. The first account to sign up becomes a captain.
2. **Auth URLs:** set the Site URL to `https://jiveturkeys.app`. Set the redirect URLs to
   `https://jiveturkeys.app/**` and `http://localhost:5173/**`. Never add a wildcard like
   `https://*.workers.dev/**`: it would let anyone's site receive login links.
3. **Email:**
   - Verify the domain in Resend.
   - In Supabase → Authentication → Emails → SMTP Settings, set host `smtp.resend.com`, port `465`,
     user `resend` and password = the Resend API key.
   - Paste [supabase/templates/confirm-signup.html](supabase/templates/confirm-signup.html) into the
     "Confirm signup" template.
4. **Cloudflare:**
   - Go to Workers & Pages → Create → Import a repository. The project name must match `name` in
     `wrangler.jsonc`.
   - Leave the build and deploy commands at their defaults.
   - Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as **build** variables, under
     Settings → Build → Variables and secrets.
   - The domain and URL settings come from `wrangler.jsonc`. Each deploy re-applies them and overrides
     the dashboard toggles.
5. **Database updates:** add the GitHub secret `SUPABASE_DB_URL` (Supabase → Connect → Session pooler,
   with the password filled in). Then run the Database update workflow once by hand. It records the
   hand-run setup SQL as applied.
6. **Google sign-in (optional):**
   - Create a Google Auth Platform client: Web application, origin `https://jiveturkeys.app`, redirect URI
     `https://<project-ref>.supabase.co/auth/v1/callback`.
   - Under Branding, set the authorized domains to `jiveturkeys.app` and `<project-ref>.supabase.co`, and
     add the home, privacy and terms links. Don't upload a logo: that triggers Google's brand review.
   - Publish the app, then enable Google in Supabase with the client ID and secret.
7. **Invite button (optional, deferred):** see [issue #1](https://github.com/m0ranwad/jive-turkeys-app/issues/1).

Free Supabase projects pause after a week with no activity. Data is kept; restore the project from the
dashboard if that happens.

## Captains

Captains (`users.role = 'admin'`) manage games, results, dues, settings, announcements and other players'
statuses. Promote someone from the Team page, or in the SQL editor:

```sql
update public.users set role = 'admin' where email = 'someone@example.com';
```

## Differences from the Base44 version

- Every page requires a login, except `/privacy` and `/terms`. The Base44 app returned player emails and
  phone numbers to anyone who asked its API, without signing in.
- Schedule import reads `.xlsx`/`.csv` directly in the browser instead of through Base44's AI. It finds
  date, time, field and opponent columns by name. For league-wide sheets with Home/Away columns, it keeps
  only Jive Turkeys games.
- The "Email RSVP reminders" switch is gone. It was a placeholder that needed a paid Base44 plan.
  *Copy reminder* on each game still works.
- The field rules from the Base44 site are loaded by the setup SQL. No player data was carried over:
  nobody but the creator had used the Base44 app.

`scripts/import-from-base44.mjs` (`npm run import:base44`) can copy data out of Base44 if that's ever
needed. It wasn't used at launch.

## Project layout

```
src/api/               Data layer: supabase.js (real) and demo.js (sample data), same interface
src/lib/               Team logic (headcount, records, leaderboards), formatting, schedule import
src/pages/             One file per screen, incl. LegalPages.jsx (/privacy, /terms)
src/components/        Shared pieces and shadcn-style UI primitives
supabase/migrations/   Database schema + security rules; new changes go in new files
supabase/functions/    invite-user function (not deployed yet, issue #1)
supabase/templates/    Sign-up code email
.github/workflows/     Database update: applies new migrations when they reach main
vendor/                SheetJS tarball (cloud sessions can't reach cdn.sheetjs.com)
wrangler.jsonc         Cloudflare Worker settings (domain, preview URLs, page routing)
CLAUDE.md              How Claude works in this repo (preview/publish workflow, rules)
scripts/               Optional Base44 data import
```
