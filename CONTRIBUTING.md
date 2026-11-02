# Contributing

How to make a change to the Jive Turkeys site, from a branch to the live site. This is the short
version for developers. [CLAUDE.md](CLAUDE.md) is the complete playbook. It's written for coding
assistants, but it's accurate for people too, and it wins if the two ever disagree.
[README.md](README.md) lists the services and accounts.

## Before you start

- **Access.** A co-owner adds you as a collaborator on this GitHub repo. You don't need Cloudflare
  or Supabase access to make changes: GitHub Actions and Cloudflare handle deployment.
- **You're not the only one pushing.** One co-owner makes changes by describing them to Claude, which
  opens pull requests with plain-English titles. Expect branches and pull requests you didn't open.
  Branch from a freshly fetched `main` and don't push to branches that aren't yours.

## Environments

There is **no staging site and no dev database**.

| Where | What it runs on | Who sees it |
|---|---|---|
| `main` → https://jiveturkeys.app | The real Supabase project | The team |
| Any other branch → a Cloudflare preview URL | **Demo mode**: sample data in the browser | Anyone with the link |
| `npm run dev` with no `.env.local` | Demo mode | You |
| `npm run dev` with `.env.local` filled in | **The real Supabase project** | You, using live team data |

- **Demo mode.** With no Supabase settings, `src/api/demo.js` stands in for `src/api/supabase.js`:
  same interface, sample players, games, chat and dues, kept in `localStorage`. It opens signed in as
  the sample captain. After you sign out, the sign-in screen has one-tap captain and player buttons.
  Every sample account's password is `demo1234`. `vite.config.js` forces demo mode for every branch
  except `main`, and stops a `main` build that's missing the Supabase settings.
- **Previews.** Cloudflare builds every pushed branch in about a minute. Find the link on the
  `Workers Builds: jive-turkeys-app` check (its `details_url` contains `/previews/<alias>/builds/`;
  the site is `https://<alias>-jive-turkeys-app.b-t-kircher.workers.dev`). Cloudflare also comments
  it on the pull request a few minutes later. Previews answer "Not found" for any path but `/`
  (a Cloudflare preview limitation), so open the home link and navigate from there.
- **What demo mode doesn't cover.** Row-level security, database functions, triggers, realtime and
  the Supabase edge functions don't run in demo mode. The database tests below are where those get
  checked before anything reaches the live database.

## Local setup

```bash
npm install
npm run dev        # http://localhost:5173, demo mode
```

Node 22 (CI uses 22). Leave `.env.local` out unless you mean to work against live data; see
[.env.example](.env.example). Never commit it, and never put a secret key in a `VITE_` variable:
those end up in the browser.

## The flow

1. **Branch** from the latest `main`.
2. **Build and test** locally (see [Tests](#tests)). At minimum `npm run build` and `npm test`. If you
   touch the chat, game day, dues or the database, also run `npm run test:e2e` and `npm run test:db`.
3. **Push and open a pull request.** Use a plain-English title that says what players and captains
   will see (look at `git log --oneline` for the style). It becomes the commit message on `main`.
4. **Check the preview** and the **Tests** workflow's three checks: `Unit tests and build`,
   `Browser tests (demo mode)`, `Database rules and rehearsal`.
5. **Merge** with **squash** once the checks are green. Branch protection is off and no review is
   required, so green checks are the gate. Keep that discipline. Branches are deleted on merge.
6. **Confirm it's live.** Cloudflare deploys `main` in about two minutes (the `Workers Builds` check
   on the merge commit). If you added a migration, check the **Database update** workflow run on `main`
   too.
7. **Undo** with a revert commit on `main`. Never rewrite history or force-push `main`.
   - If the change added a migration that has been applied, keep the migration file and revert the
     rest (`git revert --no-commit <sha>`, then `git checkout HEAD -- supabase/migrations`). Deleting
     an applied migration file breaks every later database update.
   - If it added an edge function, also keep `.github/workflows/functions.yml` as it is
     (`git checkout HEAD -- .github/workflows/functions.yml`), so the deploy step takes the function
     down instead of leaving it running.

Keep unrelated changes in separate pull requests so each can go live, or be undone, on its own.

## Database changes

Migrations in `supabase/migrations/` are applied to the **live** database automatically when they
reach `main` ([database.yml](.github/workflows/database.yml)).

- **Add a new file**, `supabase/migrations/<YYYYMMDDHHMMSS>_<short_name>.sql`. Never edit one that's
  already on `main`, and never edit `20261008000000_init.sql`.
- **Additive only**: new tables, and new columns that are nullable or have defaults. The workflow
  refuses `drop`, `truncate`, `delete from` and `rename` unless the file contains `-- owner-approved`,
  which only goes in after a co-owner says yes.
- **Every pull request rehearses new migrations.** `Database rules and rehearsal` builds a scratch
  Postgres from every migration, runs `supabase/tests/*.test.sql`, then applies your new migrations
  to a copy filled with sample data (`supabase/tests/seed.sql`). If any existing row disappears or
  changes, the check fails, and the Database update workflow would stop before touching the live
  database. Treat a red rehearsal as data loss: fix the migration.
- **New tables** need all of these:
  - `enable row level security`
  - policies: members read with `using ((select public.is_team_member()))` (never `using (true)`),
    captains write team data (`public.is_captain()`), and players write only their own rows, only as
    members
  - `grant select, insert, update, delete on <table> to authenticated, service_role;`
  - an entry in `src/api/tables.js`
  - sample rows in `src/api/demo.js` so the table shows up in previews
  - sample rows in `supabase/tests/seed.sql` so the rehearsal protects the table
- A `security definer` function that players can call must check `public.is_team_member()` itself,
  because it skips the policies.
- **Timers**: `pg_cron` is already on. Wrap `cron.schedule(...)` in
  `if exists (select 1 from pg_extension where extname = 'pg_cron')`, and never run
  `create extension pg_cron`.
- Anything the scratch database lacks (the `storage` schema, an extension) gets a minimal stand-in in
  `supabase/tests/stubs.sql`.
- If you change sample data in `src/api/demo.js`, bump `DB_KEY` at the top of that file, or browsers
  that already opened a preview keep their old copy.

**Edge functions** in `supabase/functions/` are deployed by [functions.yml](.github/workflows/functions.yml)
when they change on `main`, after the live database has that commit's migrations. Never replace the
`VAPID_*` function secrets: everyone's notifications would stop until each player turned them on again.

## Tests

| Command | What | Notes |
|---|---|---|
| `npm test` | Unit tests (Vitest), including both data backends | Seconds |
| `npm run test:e2e` | Browser tests (Playwright), phone and desktop sizes, demo mode | A few minutes. Starts its own server on port 4173. First time: `npx playwright install chromium` |
| `npm run test:db` | Builds a scratch database from every migration and runs the SQL tests | Needs Postgres 15+ and `psql`, connected with the usual `PG*` variables, as a user that can create databases |
| `npm run test:db-rehearsal` | Rehearses migrations that aren't on `origin/main` yet | Same setup as `test:db` |

- `@playwright/test` is pinned to 1.63.0 on purpose (it matches the browser in Claude's cloud
  sessions). Don't upgrade it on its own.
- Never skip, delete or loosen a test to get a check green. Fix the code, or, if the behavior changed
  on purpose, update the test and its spec together.

## Conventions

- **Specs.** `docs/chat.md`, `docs/games.md`, `docs/dues.md` and `docs/accounts.md` describe the
  expected behavior and name the tests that cover it. A deliberate behavior change updates the doc
  and its tests in the same pull request.
- **Data access** goes through `src/api/` only. `supabase.js` and `demo.js` expose the same
  interface, so a new feature needs both. When database logic is mirrored in JavaScript (the dues
  split, headcounts, who can read a chat), both sides have tests that must agree.
- **Look and feel**: Tailwind, the lime/zinc palette, `font-display` uppercase headings, the `CARD`
  style from `src/lib/constants.js`, phone-first layouts.
- **Accessibility**: no text under 11px. Grey text on white is `text-zinc-500` or darker. Toggles set
  `aria-pressed`. Animations get `motion-safe:` / `motion-reduce:` variants. Give every new screen or
  dialog a line in `tests/e2e/accessibility.spec.js`.
- **Failed saves** use `saveFailedToast()` (`src/lib/errors.js`) and keep what the player entered on
  screen.
- **Outside sites.** Any new script, font, image or API from another origin goes in the
  Content-Security-Policy in `public/_headers`, or it breaks once the policy is enforced.
- **Copy** on the site is plain and friendly: "girls" and "guys" for game-day counts, no jargon.

## Ask a co-owner first

- Anything in `.github/workflows/`, `wrangler.jsonc` (keep its empty `previews` block, because
  preview builds fail without it), the demo-mode switch in `vite.config.js`, sign-in setup, or the
  `/privacy` and `/terms` pages.
- Anything that weakens row-level security.
- A migration that needs `-- owner-approved`.

And never: commit secrets or `.env.local`, touch the backup key (`.github/workflows/backup.yml`), or
update `vendor/xlsx-*.tgz` from the network.
