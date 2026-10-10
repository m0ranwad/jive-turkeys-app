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
- The logo and app icons are the original turkey with an Afro, round shades, an Afro pick and a soccer ball
  (`docs/design/jive-turkey/c6-just-the-ball.svg`; the other concepts are saved beside it). To change them,
  edit `docs/design/jive-turkey/classic.py`, run it, then `node scripts/make-icons.mjs`. Keep the icon file
  names and sizes (`tests/e2e/install.spec.js` checks them). iPhones keep the icon a Home Screen app was
  added with; to see a new one, players remove it and add it again.
- Players can add the site to their phone's Home Screen and it opens like an app (`public/manifest.json`,
  the icons in `public/`, `public/sw.js`, and the guide in `src/components/InstallApp.jsx`). The service
  worker caches nothing on purpose, so every visit gets the latest site. Don't add caching to it without
  a plan for updates. It also shows chat notifications.
- **Chat notifications** (Web Push, no email) are turned on with the bell in the chat header. On an iPhone
  they need the Home Screen app. The database decides who gets each one and calls the `notify-chat`
  Supabase function, which `.github/workflows/functions.yml` deploys when `supabase/functions/` changes
  on `main`, using the `SUPABASE_ACCESS_TOKEN` secret. The workflow made the sending keys (`VAPID_*`
  function secrets) once. Never replace them: everyone's notifications would stop until they turn them on
  again. Previews only show a sample notification. Rules: section 7 of `docs/chat.md`.

## Who you're working with

Most requests come from the site's original creator. He co-owns the site and has the same say over it
as the other owner, so never tell him he needs anyone's permission. He built the first version with
Base44, an AI site builder, and is not a developer. He doesn't know git, GitHub, branches, pull
requests or merges, and shouldn't need to. Run the whole process yourself and talk to him the way Base44 did:

- Plain language only. Describe changes by what players and captains will see. Never say commit,
  branch, PR, merge, deploy, migration, build or repo; say "preview", "publish" and "undo".
- Never ask him to run commands, edit files, click around GitHub or Cloudflare, or read code.
- If a request is ambiguous, ask one short question before building.
- The other co-owner (whose GitHub account holds the repo) also makes changes and may use technical
  language; match whoever you're talking to.

## The workflow: preview, then publish

1. **Build it.** Start from the latest `main` on a new branch. Make the change. `npm run build` and
   `npm test` must pass. Check it in demo mode (`npm run dev` with no `.env.local`) when you can. If you
   touched the chat or the database, also run `npm run test:e2e` and `npm run test:db` (see
   [Tests](#tests)). If you change how the chat works on purpose, update `docs/chat.md` and its tests in
   the same change.
2. **Preview.** Push the branch and open a pull request yourself, with a plain-English title and summary.
   Use your GitHub tools or `gh api` (REST). `gh pr` doesn't work in cloud sessions.
   - Cloudflare builds the preview in about a minute. Poll the `Workers Builds: jive-turkeys-app` check
     on your commit every 20 seconds or so
     (`gh api repos/m0ranwad/jive-turkeys-app/commits/<sha>/check-runs`). If it fails, fix it before
     telling him anything. You can't read Cloudflare's build log, so reproduce the preview build with
     `WORKERS_CI_BRANCH=preview npm run build`.
   - When it passes, the check's `details_url` contains `/previews/<alias>/builds/`, and the preview
     link is `https://<alias>-jive-turkeys-app.b-t-kircher.workers.dev`. Send it right away. Cloudflare
     also comments the link on the pull request, but the comment lags the build by several minutes,
     so don't wait for it.
   - Cloud sessions can't open `workers.dev` or `jiveturkeys.app`, so don't try to load the preview.
   - Give him the preview link with a short "try this" list, and tell him: the preview opens on a
     sign-in screen, and he signs in with email `captain@demo.test` and password `demo1234`
     (**Continue with Google** doesn't work on previews). It has pretend players and games, nothing he
     does there touches the real site, and nothing is live yet.
   - Share only the preview link itself, never a link to a specific page. Previews show "Not found" for
     any address other than the home page (a Cloudflare preview limitation). If he sees "Not found"
     after refreshing, he opens the link again. He stays signed in.
3. **Changes.** If he wants tweaks, push to the same branch. The same preview link updates when the
   check on the new commit passes, about a minute after the push. If a tweak changes sample data in
   `src/api/demo.js`, bump `DB_KEY` there, because the preview keeps the sample data his browser saved
   on his first visit.
4. **Publish** when he says so ("publish", "looks good", "go live"): bring the branch up to date with
   `main`, and wait for the three **Tests** checks on its latest commit to pass (`Unit tests and build`,
   `Browser tests (demo mode)`, `Database rules and rehearsal`; a few minutes). If one fails, fix it
   before publishing, and tell him it needs a few more minutes. Then squash-merge the pull request yourself
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

He may bring up something new in the middle of a chat. Keep unrelated changes apart: the new one gets
its own branch from `main` and its own preview, so each can go live or be undone on its own. If it's
unclear whether he wants them to go live together, ask.

## Ideas for later

When he wants to plan something without building it yet ("plan a feature to...", "not ready to build
this"), save it as a GitHub issue. To him it's "the idea list"; never call it an issue.

1. Switch to plan mode if it's available, so nothing gets built by accident. Ask a few short questions
   about how it should work for players and captains: who sees it, where it shows up, who can change
   it. Offer choices where you can. Write the plan in plain words, since he'll see it.
2. Create the issue with the `idea` label (create the label first if it's missing):
   `gh api repos/m0ranwad/jive-turkeys-app/issues -f title=... -f body=... -f "labels[]=idea"`.
   The title is plain English. The body says what players and captains will see and the choices he made,
   then has a "Notes for building" section covering data, screens, any database update, and sample data
   for previews.
3. Tell him it's on the idea list and what it's called. Don't change any files.

When he asks what's on the list, describe the open `idea` issues in plain words. When he picks one to
build, read the issue, follow the workflow above, and put `Closes #<number>` in the pull request summary
so it comes off the list when it goes live.

## Live preview on his computer

In the Claude desktop app's Code tab with **Local** picked, the site can run in the Browser pane beside
the chat and update as you edit, like the Base44 editor. Cloud sessions (claude.ai/code, the phone app)
can't do this and use preview links.

- **First time.** He picks an empty folder and asks you to set up the site with live previews. Check
  for Git, Node.js (LTS) and the GitHub CLI, and install what's missing (`winget` on Windows; on a Mac,
  Homebrew if it's there, otherwise the official installers). If newly installed tools aren't found,
  ask him to quit and reopen Claude and come back to this chat. Sign the GitHub CLI in; he approves it
  in his browser, so tell him exactly what he'll see. Clone
  `https://github.com/m0ranwad/jive-turkeys-app.git` into the folder, read this file, run `npm install`,
  then open the preview and tell him to sign in with `captain@demo.test` / `demo1234`. End with
  "You're all set."
- `.claude/launch.json` starts the preview with the Supabase settings blanked, so it always runs in
  demo mode with pretend players, even on a computer that has `.env.local`.
- **Every change.** Follow the workflow above, but start the branch from a freshly fetched
  `origin/main`, and show the change in the Browser pane as you go instead of waiting on a preview
  link. Send the preview link only if he asks (say, to try it on his phone). When he's happy, still
  push, open the pull request and wait for the `Workers Builds` check to pass before publishing.

## Setup check

His first message will likely ask whether you're able to make changes to the site. When he asks that,
check without changing anything:

1. `gh api repos/m0ranwad/jive-turkeys-app --jq .permissions` shows `"push": true`.
2. `git push --dry-run origin HEAD:refs/heads/setup-check` succeeds. It sends nothing.
3. `npm install` and `npm run build` succeed. If either changes a tracked file, restore it.

Reply in plain words. Give one line per check. Then use three or four sentences on how you'll work
together: he describes a change, you show him a preview, it goes live when he says he's happy, and you
can put it back if he changes his mind. If everything passed, end with exactly "You're all set." If
anything failed, say what needs fixing, written as a message he can send the other co-owner, who
manages the GitHub, Cloudflare and Supabase accounts.

## Code map

- `src/pages/`: one file per screen. `src/components/`: shared pieces. `src/components/ui/`: primitives.
- `src/lib/team-logic.js`: headcounts, records, leaderboards. `src/lib/constants.js`: shared values.
- `src/api/`: the only place that talks to data. `supabase.js` (real) and `demo.js` (sample data)
  expose the same interface. `tables.js` maps entity names to tables.
- Match the existing look: Tailwind, lime/zinc palette, `font-display` uppercase headings, the `CARD`
  style from `src/lib/constants.js`, and mobile-first layouts (most players use phones).
- Previews of non-main branches run in **demo mode with sample data** (`vite.config.js`). Make new
  features show up there.
- Chat: `src/pages/ChatPage.jsx`, `src/components/chat/`, `src/lib/chat.js`, and `src/hooks/useChatUnread.js`
  (the Chat tab badge). `docs/chat.md` is the expected behavior.
- Dues: `src/pages/DuesPage.jsx`, `src/components/dues/`, `src/lib/dues.js`. The whole team sees the dues and
  can mark anyone paid or link a couple (database functions `mark_dues_paid()` and `set_dues_partner()`); every
  paid / not paid change is kept in `dues_history`, which only `mark_dues_paid()` writes. Marking someone not paid
  always asks first. Only captains set fees, custom amounts and payment links.
- Roster players who haven't joined yet are `team_guests`: captains add the team by name on the Team page
  (`src/components/team/GuestDialog.jsx`), where they show as grey dashed cards with the usual statuses, counts
  and positions, plus a **Copy invite** message. A new player picks their name in the walkthrough
  (`src/components/Walkthrough.jsx`, `claim_team_guest()`), which brings over their status and moves their dues
  payments and history to their account; captains can also link one (`link_team_guest()`); both use
  `move_team_guest()`. Names that look alike ("Sam Ortiz" and "Sam O"; `sameName()` in
  `src/lib/team-logic.js`) are caught when captains paste names, when a new player types a name instead of picking
  theirs ("Is that you?"), and on grey cards for captains ("Joined as …?"). In dues they split, pay and pair like
  everyone else (payments and history rows have `guest_id` instead of `user_id`; `duesMembers()` / `guestAsPlayer()` in `src/lib/dues.js` merge both kinds).
  Game sign-ups and stats don't include them.
- Notifications: `src/lib/push.js` and `src/components/chat/Notifications.jsx` (the page side),
  `public/sw.js` (shows them), `supabase/functions/notify-chat/` and `supabase/functions/_shared/` (sending).
- Tests: `tests/unit/` (Vitest), `tests/e2e/` (Playwright), `supabase/tests/` (database), `scripts/test-db.sh`
  and `scripts/db-rehearsal.sh`.

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
  anything that drops, truncates, deletes or renames. If a change truly needs that, stop and explain in
  plain words exactly what would be removed, and that it can't be undone. Either co-owner can approve
  it. Only after the person you're talking to clearly says yes, add `-- owner-approved` to the new
  migration file. Never add it on your own judgment.
- Every new table needs: `alter table ... enable row level security`; policies (players read team data;
  captains write team data; players write only their own rows); and
  `grant select, insert, update, delete on <table> to authenticated, service_role;`. Captain checks use
  `public.is_captain()`; captains are `users.role = 'admin'`.
- **Chat history and team data must survive every change.** Every new migration is rehearsed on a copy of
  the database filled with sample data (`scripts/db-rehearsal.sh`): if any existing row disappears or
  changes, the pull request's `Database rules and rehearsal` check fails, and the Database update workflow
  stops before touching the live database. A failing rehearsal means the change would lose data: don't
  publish it. Fix the migration, or explain in plain words what would be lost and get a co-owner's yes
  (then `-- owner-approved`, as above).
- If a migration uses a piece of Supabase the test database doesn't have (the `storage` schema, an
  extension), add a minimal stand-in to `supabase/tests/stubs.sql`. If it adds a table, add sample rows
  for it to `supabase/tests/seed.sql` so the rehearsal protects that table too.
- When publishing a change that includes a database update, check that the "Database update" workflow
  run on `main` succeeded (`gh api repos/m0ranwad/jive-turkeys-app/actions/runs?branch=main`) before
  saying it's live. If it failed, undo the publish, tell him in plain words what happened, and give him
  a short message he can send the other co-owner, who looks after the database setup.

## Tests

| Command | What | Notes |
|---|---|---|
| `npm test` | Unit tests (chat logic, both data backends) | Seconds |
| `npm run test:e2e` | Browser tests, phone and desktop, demo mode | A few minutes. Starts its own dev server |
| `npm run test:db` | Database rules on a scratch database built from all migrations | Needs Postgres 15+. In cloud sessions, once: `pg_ctlcluster 16 main start && sudo -u postgres createuser -s root`; then `PGHOST=/var/run/postgresql npm run test:db` |
| `npm run test:db-rehearsal` | Rehearses migrations not yet on `origin/main` | Same setup as `test:db` |

GitHub runs all of them on every pull request and on `main` (`.github/workflows/tests.yml`).
`@playwright/test` is pinned to the version matching the Chromium in cloud sessions (`/opt/pw-browsers`);
don't upgrade it on its own. Never skip, delete or loosen a test to get a check green: fix the code, or, if
the behavior changed on purpose, update the test and `docs/chat.md` together.

## Don't

- Commit secrets. `.env.local` stays local. Only the Supabase URL and publishable key belong in the
  frontend, never a secret key.
- Weaken row-level security, or change `wrangler.jsonc`, `.github/workflows/`, the preview demo-mode
  logic in `vite.config.js`, sign-in setup, or the `/privacy` and `/terms` pages, unless a co-owner
  asks. If he asks for something that needs one of these, explain the effect in plain words first.
  Keep the empty `previews` block in `wrangler.jsonc`: Cloudflare's preview builds fail without it.
- Edit `supabase/migrations/20261008000000_init.sql`. It's already applied to the live database, so
  changes to it never take effect.
- Update `vendor/xlsx-*.tgz` from the network. It's vendored because cloud sessions can't reach
  cdn.sheetjs.com.
