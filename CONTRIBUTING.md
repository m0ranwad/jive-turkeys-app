# Contributing

How a change gets from a branch to the live Jive Turkeys site. [CLAUDE.md](CLAUDE.md) is the
complete playbook: it's written for coding assistants but applies to people too, and it wins if the
two ever disagree. [README.md](README.md) lists the services and accounts.

## TL;DR

1. Branch from the latest `main`. `npm install && npm run dev` runs the site locally on sample data.
2. Push and open a pull request. Cloudflare builds a preview of the branch in about a minute, also
   on sample data. There's no staging site and no dev database.
3. Wait for the three **Tests** checks to go green. No approval is required, so the checks are the gate.
4. Squash-merge. `main` is live at jiveturkeys.app about two minutes later.
5. Database changes are new, additive-only files in `supabase/migrations/`. The checks rehearse them
   on a scratch database with sample data, and merging applies them to the live database.
6. Undo with a revert commit on `main`. Never force-push.
7. Ask a co-owner before touching workflows, hosting, sign-in or security rules
   ([list](#ask-a-co-owner-first)).

## Getting started

- **Access.** A co-owner adds you as a collaborator on this GitHub repo. You don't need Cloudflare
  or Supabase access: GitHub Actions and Cloudflare do the deploying.
- **You're not the only one pushing.** One co-owner makes changes by describing them to Claude, which
  opens pull requests with plain-English titles. Expect branches you didn't create, branch from a
  freshly fetched `main`, and don't push to branches that aren't yours.
- **Run it locally** with Node 22 (what CI uses):

  ```bash
  npm install
  npm run dev        # http://localhost:5173, on sample data
  ```

  Leave `.env.local` out unless you mean to work against **live team data** (see
  [.env.example](.env.example)). Never commit it, and never put a secret key in a `VITE_` variable,
  because those end up in the browser.

## Environments

| Where | Runs on |
|---|---|
| `main` → https://jiveturkeys.app | The real Supabase project |
| Any other branch → its Cloudflare preview | Demo mode (sample data) |
| `npm run dev` without `.env.local` | Demo mode |
| `npm run dev` with `.env.local` | **The real Supabase project** |

- **Demo mode.** With no Supabase settings, `src/api/demo.js` stands in for `src/api/supabase.js`
  (same interface), with sample players, games, chat and dues kept in `localStorage`. It opens signed
  in as the sample captain. After you sign out, the sign-in screen has one-tap captain and player
  buttons, and every sample account's password is `demo1234`. `vite.config.js` removes the Supabase
  settings from every Cloudflare build except `main`, and stops a `main` build that's missing them.
- **Preview links.** Cloudflare comments the link on the pull request a few minutes after the build.
  It's ready sooner than that: the `Workers Builds: jive-turkeys-app` check's details URL contains
  `/previews/<alias>/builds/`, and the preview is `https://<alias>-jive-turkeys-app.b-t-kircher.workers.dev`.
  Previews answer "Not found" for any path but `/` (a Cloudflare limitation), so start from the home
  link and navigate in the app. Refreshing a deeper page shows "Not found".
- **What only the live site exercises.** The database tests cover security rules, database functions
  and triggers. Nothing before `main` runs real sign-in (Google, email codes, usernames), realtime
  chat, push notifications or the Supabase edge functions. Take extra care with changes there.

## Making a change

1. **Branch** from the latest `main`.
2. **Build and test locally** (see [Tests](#tests)): at least `npm run build` and `npm test`. If you
   touch the chat, game day, dues or the database, also run `npm run test:e2e` and `npm run test:db`.
3. **Open a pull request** with a plain-English title saying what players and captains will see
   (`git log --oneline` shows the style). The title becomes the commit message on `main`.
4. **Check the preview**, and wait for `Unit tests and build`, `Browser tests (demo mode)` and
   `Database rules and rehearsal` to pass.
5. **Squash-merge.** Branch protection is off, so nothing stops a merge on red. Don't. Branches are
   deleted on merge.
6. **Confirm it's live**: the `Workers Builds` check on the merge commit (about two minutes) and, if
   you added a migration, the **Database update** workflow run on `main`.
7. **Undo** with a revert commit on `main`. Never rewrite history or force-push.
   - If the change added a migration that's been applied, keep the migration file and revert the rest
     (`git revert --no-commit <sha>`, then `git checkout HEAD -- supabase/migrations`). Deleting an
     applied migration file breaks every later database update.
   - If it added an edge function, also keep `.github/workflows/functions.yml`
     (`git checkout HEAD -- .github/workflows/functions.yml`). Its deploy step takes a function down
     once its folder is gone, and the older file would leave it running.

Keep unrelated changes in separate pull requests so each can go live, or be undone, on its own.

## Database changes

Migrations in `supabase/migrations/` are applied to the **live** database when they reach `main`
([database.yml](.github/workflows/database.yml)).

- **Add a new file**: `supabase/migrations/<YYYYMMDDHHMMSS>_<short_name>.sql`. Never edit or delete
  one that's already on `main`. The rehearsal fails if you do, and edits never take effect anyway.
- **Additive only**: new tables, and new columns that are nullable or have defaults. Two checks guard
  this:
  - **On the pull request**, `Database rules and rehearsal` builds a scratch database from every
    migration, runs `supabase/tests/*.test.sql`, fills a copy with sample data
    (`supabase/tests/seed.sql`), applies your new migrations and fails if any existing row disappears
    or changes. Treat a red rehearsal as data loss and fix the migration.
  - **After merge**, the Database update workflow refuses any migration containing `drop`,
    `truncate`, `delete from` or `rename` before it touches the live database. That keyword check
    doesn't run on the pull request, so check for those words yourself before merging.
  - Either check is bypassed only by `-- owner-approved` in the file, which goes in after a co-owner
    says yes.
- **A new table** needs:
  - `enable row level security`
  - policies: members read with `using ((select public.is_team_member()))` (never `using (true)`),
    captains write team data (`public.is_captain()`), and players write only their own rows, only as
    members
  - `grant select, insert, update, delete on <table> to authenticated, service_role;`
  - an entry in `src/api/tables.js`
  - sample rows in `src/api/demo.js`, so it shows up in previews
  - sample rows in `supabase/tests/seed.sql`, so the rehearsal protects it
- A `security definer` function that players can call must check `public.is_team_member()` itself,
  because it skips the policies.
- **Timers**: `pg_cron` is already on. Wrap `cron.schedule(...)` in
  `if exists (select 1 from pg_extension where extname = 'pg_cron')`, and never run
  `create extension pg_cron`.
- Anything the scratch database lacks (the `storage` schema, an extension) gets a minimal stand-in in
  `supabase/tests/stubs.sql`.
- When you change sample data in `src/api/demo.js`, bump `DB_KEY` at the top of that file. Otherwise
  browsers that already opened a preview keep their old copy.

**Edge functions** in `supabase/functions/` are deployed by [functions.yml](.github/workflows/functions.yml)
when they change on `main`, once the live database has that commit's migrations. Never replace the
`VAPID_*` function secrets: everyone's notifications would stop until each player turned them on again.

## Tests

| Command | What | Notes |
|---|---|---|
| `npm test` | Unit tests (Vitest), including both data backends | Seconds |
| `npm run test:e2e` | Browser tests (Playwright) at phone and desktop sizes, in demo mode | A few minutes. Starts its own server on port 4173. First time: `npx playwright install chromium` |
| `npm run test:db` | Builds a scratch database from every migration and runs the SQL tests | Needs Postgres 15+ and `psql`, connected through the usual `PG*` variables as a user that can create databases |
| `npm run test:db-rehearsal` | Rehearses migrations that aren't on `origin/main` yet | Same setup as `test:db`. Fetch `main` first |

- `@playwright/test` is pinned to 1.63.0 to match the browser in Claude's cloud sessions. Don't
  upgrade it on its own.
- Never skip, delete or loosen a test to get a check green. Fix the code, or, if the behavior changed
  on purpose, update the test and its spec together.

## Conventions

- **Specs.** `docs/chat.md`, `docs/games.md`, `docs/dues.md` and `docs/accounts.md` describe the
  expected behavior and name the tests that cover it. A deliberate behavior change updates the doc
  and its tests in the same pull request.
- **Data access** goes through `src/api/` only. `supabase.js` and `demo.js` expose the same
  interface, so a new feature needs both. Where database logic is mirrored in JavaScript (the dues
  split, headcounts, who can read a chat), tests on both sides must agree.
- **Look and feel**: Tailwind, the lime/zinc palette, `font-display` uppercase headings, the `CARD`
  style from `src/lib/constants.js`, and phone-first layouts (most players use phones).
- **Accessibility**: no text under 11px. Grey text on white is `text-zinc-500` or darker. Toggles set
  `aria-pressed`. Animations get `motion-safe:` / `motion-reduce:` variants. Every new screen or dialog
  gets a line in `tests/e2e/accessibility.spec.js`.
- **Failed saves** use `saveFailedToast()` (`src/lib/errors.js`) and keep what the player entered on
  screen.
- **Outside sites.** A new script, font, image or API from another origin goes in the
  Content-Security-Policy in `public/_headers`, or it breaks once the policy is enforced.
- **Copy** is plain and friendly, with no jargon. Game-day counts say "girls" and "guys".

## Ask a co-owner first

- Changes to `.github/workflows/`, `wrangler.jsonc` (keep its empty `previews` block, because
  preview builds fail without it), the demo-mode switch in `vite.config.js`, sign-in setup, or the
  `/privacy` and `/terms` pages
- Anything that weakens row-level security
- A migration that needs `-- owner-approved`

Never commit secrets or `.env.local`, touch the backup key (`.github/workflows/backup.yml`), or
update `vendor/xlsx-*.tgz` from the network.
