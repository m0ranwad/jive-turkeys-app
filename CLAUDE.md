# Jive Turkeys Team Hub

Team website for an indoor coed soccer team: schedule, RSVPs, stats, dues, chat and field rules.
Live at https://jiveturkeys.app. React + Vite + Tailwind frontend, Supabase backend (Postgres with
row-level security, auth, realtime), hosted on Cloudflare Workers. GitHub repo: m0ranwad/jive-turkeys-app.
README.md has the service inventory and the current setup status.

## Current state

- Sign-in is email + password with a 6-digit email code. Google sign-in may or may not be finished (see
  README setup status). `/privacy` and `/terms` (`src/pages/LegalPages.jsx`) exist because Google requires
  them. Keep them public and linked from the sign-in screens.
- The **Invite teammate** button on the Team page doesn't work yet: its Supabase function isn't deployed
  ([issue #1](https://github.com/m0ranwad/jive-turkeys-app/issues/1)). Don't promise invites. New players
  sign up at https://jiveturkeys.app themselves.
- No player data came over from Base44. The field rules are seeded by the setup migration.

## Who you're working with

Most requests come from the site's original creator. He built the first version with Base44, an AI site
builder, and is not a developer. He doesn't know git, GitHub, branches, pull requests or merges, and
shouldn't need to. Run the whole process yourself and talk to him the way Base44 did:

- Plain language only. Describe changes by what players and captains will see. Never say commit,
  branch, PR, merge, deploy, migration, build or repo; say "preview", "publish" and "undo".
- Never ask him to run commands, edit files, click around GitHub or Cloudflare, or read code.
- If a request is ambiguous, ask one short question before building.
- The repo owner also makes changes and may use technical language; match whoever you're talking to.

## The workflow: preview, then publish

1. **Build it.** Start from the latest `main` on a new branch. Make the change. `npm run build` must pass.
   Check it in demo mode (`npm run dev` with no `.env.local`) when you can.
2. **Preview.** Push the branch and open a pull request yourself, with a plain-English title and summary.
   Use your GitHub tools or `gh api` (REST). `gh pr` doesn't work in cloud sessions. Cloudflare comments
   on the pull request with a Preview URL within a few minutes. Read it with
   `gh api repos/m0ranwad/jive-turkeys-app/issues/<number>/comments` and give him the link with a
   short "try this" list. Say that the preview uses pretend players and games, and that nothing is
   live yet. If the build fails, fix it before telling him anything.
3. **Changes.** If he wants tweaks, push to the same branch. The preview link updates.
4. **Publish** when he says so ("publish", "looks good", "go live"): bring the branch up to date with
   `main`, then squash-merge the pull request yourself
   (`gh api -X PUT repos/m0ranwad/jive-turkeys-app/pulls/<number>/merge -f merge_method=squash`).
   The live site updates in about two minutes. Load https://jiveturkeys.app to confirm, then tell him
   it's live.
5. **Undo** ("undo that", "put it back"): revert that change on `main` with a new revert commit and push
   it. Never rewrite history or force-push.

If he asks to "just publish it" without a preview, you may skip step 3, but still pass step 1 and
still go through a pull request so there's a record.

## Code map

- `src/pages/`: one file per screen. `src/components/`: shared pieces. `src/components/ui/`: primitives.
- `src/lib/team-logic.js`: headcounts, records, leaderboards. `src/lib/constants.js`: shared values.
- `src/api/`: the only place that talks to data. `supabase.js` (real) and `demo.js` (sample data)
  expose the same interface. `tables.js` maps entity names to tables.
- Match the existing look: Tailwind, lime/zinc palette, `font-display` uppercase headings, the `CARD`
  style from `src/lib/constants.js`, and mobile-first layouts (most players use phones).
- Previews of non-main branches run in **demo mode with sample data** (`vite.config.js`). Make new
  features show up there.

## Data and database changes

The GitHub Action `.github/workflows/database.yml` applies new files in `supabase/migrations/` to the
live database when they reach `main`. So:

- A new kind of data needs all three: a new migration file, an entry in `src/api/tables.js`, and
  sample rows in `src/api/demo.js` so it shows up in the preview.
- Never edit existing migration files. Add `supabase/migrations/<YYYYMMDDHHMMSS>_<short_name>.sql`.
- Additive only: new tables, or new columns with defaults. The Action refuses anything that drops,
  truncates, deletes or renames. If a change truly needs that, stop and tell him the site's owner has
  to approve it. Don't work around the check.
- Every new table needs: `alter table ... enable row level security`; policies (players read team data;
  captains write team data; players write only their own rows); and
  `grant select, insert, update, delete on <table> to authenticated, service_role;`. Captain checks use
  `public.is_captain()`; captains are `users.role = 'admin'`.
- When publishing a change that includes a database update, check that the "Database update" workflow
  run on `main` succeeded (`gh api repos/m0ranwad/jive-turkeys-app/actions/runs?branch=main`) before
  saying it's live. If it failed, undo the publish, and tell him in plain words that the owner needs to
  take a look.

## Don't

- Commit secrets. `.env.local` stays local. Only the Supabase URL and publishable key belong in the
  frontend, never a secret key.
- Weaken row-level security, or change `wrangler.jsonc`, `.github/workflows/`, the preview demo-mode
  logic in `vite.config.js`, sign-in setup, or the `/privacy` and `/terms` pages, unless the owner asks.
- Edit `supabase/migrations/20261008000000_init.sql`. It's already applied to the live database, so
  changes to it never take effect.
- Update `vendor/xlsx-*.tgz` from the network. It's vendored because cloud sessions can't reach
  cdn.sheetjs.com.
