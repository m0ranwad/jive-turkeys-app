# Jive Turkeys Team Hub

Team website for an indoor coed soccer team: schedule, RSVPs, stats, dues, chat and field rules.
Live at https://jiveturkeys.app. React + Vite + Tailwind frontend, Supabase backend (Postgres with
row-level security, auth, realtime), hosted on Cloudflare Workers. GitHub repo: m0ranwad/jive-turkeys-app.
README.md has the service inventory and the current setup status.

## Current state

- Sign-in is **Continue with Google**, or email + password with a 6-digit email code. `/privacy` and
  `/terms` (`src/pages/LegalPages.jsx`) exist because Google requires them. Keep them public and linked
  from the sign-in screens.
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
   Use your GitHub tools or `gh api` (REST). `gh pr` doesn't work in cloud sessions.
   - Cloudflare builds the preview and comments on the pull request. The comment's `Preview URL:` line
     shows up about five minutes after the push. Poll
     `gh api repos/m0ranwad/jive-turkeys-app/issues/<number>/comments` until it does.
   - The build result is the `Workers Builds: jive-turkeys-app` check on your commit
     (`gh api repos/m0ranwad/jive-turkeys-app/commits/<sha>/check-runs`). If it fails, fix it before
     telling him anything. You can't read Cloudflare's build log, so reproduce the preview build with
     `WORKERS_CI_BRANCH=preview npm run build`.
   - Cloud sessions can't open `workers.dev` or `jiveturkeys.app`, so don't try to load the preview.
   - Give him the preview link with a short "try this" list, and tell him: the preview opens on a
     sign-in screen, and he signs in with email `captain@demo.test` and password `demo1234`
     (**Continue with Google** doesn't work on previews). It has pretend players and games, nothing he
     does there touches the real site, and nothing is live yet.
   - Share only the preview link itself, never a link to a specific page. Previews show "Not found" for
     any address other than the home page (a Cloudflare preview limitation). If he sees "Not found"
     after refreshing, he opens the link again. He stays signed in.
3. **Changes.** If he wants tweaks, push to the same branch. The same preview link updates within about
   five minutes. If a tweak changes sample data in `src/api/demo.js`, bump `DB_KEY` there, because the
   preview keeps the sample data his browser saved on his first visit.
4. **Publish** when he says so ("publish", "looks good", "go live"): bring the branch up to date with
   `main`, then squash-merge the pull request yourself
   (`gh api -X PUT repos/m0ranwad/jive-turkeys-app/pulls/<number>/merge -f merge_method=squash`).
   Cloudflare updates the live site in about two minutes. Confirm it with the `Workers Builds:
   jive-turkeys-app` check on the merge commit (and the database update, if any; see below), then tell
   him it's live.
5. **Undo** ("undo that", "put it back"): revert that change on `main` with a new revert commit and push
   it. Never rewrite history or force-push. If the change added a migration and its database update
   succeeded, keep the migration file and revert everything else (`git revert --no-commit <sha>`, then
   `git checkout HEAD -- supabase/migrations`). The unused column or table is harmless, and deleting an
   applied migration file makes every later database update fail. Tell him the screens are back to how
   they were, and anything players typed is kept out of sight.

If he asks to "just publish it" without a preview, you may skip step 3, but still pass step 1 and
still go through a pull request so there's a record.

## Setup check

His first message will likely ask whether you're able to make changes to the site. When he asks that,
check without changing anything:

1. `gh api repos/m0ranwad/jive-turkeys-app --jq .permissions` shows `"push": true`.
2. `git push --dry-run origin HEAD:refs/heads/setup-check` succeeds. It sends nothing.
3. `npm install` and `npm run build` succeed. If either changes a tracked file, restore it.

Reply in plain words. Give one line per check. Then use three or four sentences on how you'll work
together: he describes a change, you send a preview link, "publish" puts it live, and "undo that" puts
it back. If everything passed, end with exactly "You're all set." If anything failed, say what the
site's owner needs to fix, written as a message he can send them.

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
- A new detail on existing data (say, a new player profile field) needs a migration that adds a
  nullable column, the screens that show and edit it, and sample values in `src/api/demo.js`. The
  table's existing policies and grants already cover new columns.
- Never edit existing migration files. Add `supabase/migrations/<YYYYMMDDHHMMSS>_<short_name>.sql`.
- Additive only: new tables, or new columns that are nullable or have defaults. The Action refuses
  anything that drops, truncates, deletes or renames. If a change truly needs that, stop and tell him the site's owner has
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
  Keep the empty `previews` block in `wrangler.jsonc`: Cloudflare's preview builds fail without it.
- Edit `supabase/migrations/20261008000000_init.sql`. It's already applied to the live database, so
  changes to it never take effect.
- Update `vendor/xlsx-*.tgz` from the network. It's vendored because cloud sessions can't reach
  cdn.sheetjs.com.
