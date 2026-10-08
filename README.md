# Jive Turkeys Team Hub

The team's schedule, RSVPs, stats, dues, chat and field rules. This is a rebuild of the Base44 app at
`jive-turkey-tactics.base44.app` that we own outright:

- **Frontend:** React + Vite + Tailwind. It builds to static files you can host anywhere.
- **Backend:** [Supabase](https://supabase.com) for the Postgres database, logins, live chat and one small function. It's open source, the free tier covers a team this size, and the data can be exported at any time.

## Try it locally (no setup)

```bash
npm install
npm run dev
```

With no Supabase keys configured, the app runs in **demo mode**: sample data stored in your browser.
Sign in as `captain@demo.test` / `demo1234`, or create any account.

## Set up the real backend

1. **Create a Supabase project** at supabase.com (the free plan is fine).
2. **Create the tables:** open SQL Editor, paste all of
   [supabase/migrations/20261008000000_init.sql](supabase/migrations/20261008000000_init.sql), and run it.
   The first account to sign up becomes a captain.
3. **Connect the app:** copy `.env.example` to `.env.local` and fill in the Project URL and the
   publishable key (`sb_publishable_…`) from *Project Settings → API Keys*.
4. **Allowed URLs:** in *Authentication → URL Configuration*, set the Site URL to
   `https://jiveturkeys.app`. Add the redirect URLs `https://jiveturkeys.app/**`, the project's own
   Cloudflare address (e.g. `https://jive-turkeys.pages.dev/**`) and `http://localhost:5173/**`.
   Never add a wildcard like `https://*.pages.dev/**`: it would let anyone's pages.dev site receive
   your players' login links.
5. **Email sending (required for real players):** Supabase's built-in mailer only delivers to your
   own Supabase team members and is heavily rate-limited. In *Authentication → Emails → SMTP Settings*,
   plug in an email provider. Resend, Postmark and Brevo all have free tiers.
6. **Sign-up code email:** in *Authentication → Emails → Confirm signup*, paste
   [supabase/templates/confirm-signup.html](supabase/templates/confirm-signup.html) so new players get
   the 6-digit code the sign-up screen asks for.
7. **Google sign-in (optional):** create an OAuth client in Google Cloud Console with redirect URI
   `https://<project-ref>.supabase.co/auth/v1/callback`, then enable *Authentication → Providers → Google*
   with its client ID and secret.
8. **Invite emails (optional):** deploy the function behind the Team page's *Invite teammate* button.
   Either paste `supabase/functions/invite-user/index.ts` into *Edge Functions → Deploy a new function →
   Via editor* (name it `invite-user` and turn JWT verification off), or use the CLI:
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase functions deploy invite-user
   ```

Want the team hub invite-only? Turn off *Allow new users to sign up* under
*Authentication → Sign In / Providers* and add players with the invite button.

## Bring over the data from Base44

Put `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (`sb_secret_…`, from *Project Settings → API Keys*) in
`.env.local`. That file is never committed or published. Then run:

```bash
npm run import:base44 -- --dry-run   # shows what will be copied
npm run import:base44                # copies it
```

This copies players, team settings and rules, games, RSVPs, stats, votes, dues, chat and announcements.
Every player gets a login under the same email. Passwords can't be exported from Base44, so each player
signs in once with **Continue with Google** or uses **Forgot password?**. Captains keep their captain role.
Running the import again is safe: tables that already have data are skipped.

## Deploy the site

Any static host works. We recommend **Cloudflare Pages**: its free plan has unlimited bandwidth.
Netlify's free plan is credit-capped and pauses the site when credits run out.

- Build command: `npm run build`
- Output directory: `dist`
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. Set them for
  **Production only**. Preview deployments then run in demo mode with sample data, so testing a
  proposed change can't touch real team data.

Page routing is already configured: `public/_redirects` covers Cloudflare and Netlify, and `vercel.json`
covers Vercel. Add `jiveturkeys.app` as the project's custom domain.

## Making changes with Claude

1. Repo owner: invite collaborators under the repo's *Settings → Collaborators*, and install the
   Claude GitHub app (github.com/apps/claude) on this repo.
2. Collaborator: open claude.ai/code (or the Code tab in the Claude app), connect GitHub, pick this repo
   and describe the change. This needs a Pro plan or higher.
3. Claude makes the change. Click **Create PR**, then open the preview link Cloudflare adds to the pull
   request.
4. **Merge** the pull request and the live site updates within a couple of minutes. **Revert** undoes it.

If a change adds new database tables or columns, its SQL file under `supabase/migrations/` must be run in
Supabase's SQL editor.

Free Supabase projects pause after a week with no activity. Data is kept; restore the project from the
dashboard if that happens.

## Captains

Captains (`users.role = 'admin'`) manage games, results, dues, settings, announcements and other players'
statuses. Promote someone from the Team page, or in the SQL editor:

```sql
update public.users set role = 'admin' where email = 'someone@example.com';
```

## Differences from the Base44 version

- Every page requires a login. The Base44 app returned player emails and phone numbers to anyone who
  asked its API, without signing in.
- Schedule import reads `.xlsx`/`.csv` directly in the browser instead of through Base44's AI. It finds
  date, time, field and opponent columns by name. For league-wide sheets with Home/Away columns, it keeps
  only Jive Turkeys games.
- The "Email RSVP reminders" switch is gone. It was a placeholder that needed a paid Base44 plan.
  *Copy reminder* on each game still works.

## Project layout

```
src/api/          Data layer: supabase.js (real) and demo.js (sample data), same interface
src/lib/          Team logic (headcount, records, leaderboards), formatting, schedule import
src/pages/        One file per screen
src/components/   Shared pieces and shadcn-style UI primitives
supabase/         Schema + security rules, invite function, email template
scripts/          One-time Base44 import
```
