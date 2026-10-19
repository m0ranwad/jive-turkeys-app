import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cloudflare preview builds (any branch other than main) leave out the
// Supabase settings, so previews run in demo mode with sample data and trying
// out a proposed change can never touch the real team database.
const branch = process.env.WORKERS_CI_BRANCH;
if (branch && branch !== 'main') {
  for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY']) {
    delete process.env[key];
  }
}

// The live site (main) never falls back to demo mode. Without the Supabase
// settings it would publish the sample-data site, demo captain login and all,
// to jiveturkeys.app, so the build stops and the site stays as it was.
if (branch === 'main') {
  const url = process.env.VITE_SUPABASE_URL;
  if (!url || !(process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY)) {
    throw new Error(
      'The live site build has no Supabase settings. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY ' +
        'as build variables in Cloudflare (Settings -> Build -> Variables and secrets), then retry the build.',
    );
  }
  // The security policy in public/_headers names the Supabase project the site may talk to.
  const host = new URL(url).host;
  if (!fs.readFileSync(path.resolve(import.meta.dirname, 'public/_headers'), 'utf8').includes(host)) {
    throw new Error(`public/_headers doesn't allow ${host}. Update its Content-Security-Policy to the new Supabase project.`);
  }
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  build: {
    // Screens load as they're opened (App.jsx). What every visit downloads
    // (React, the router, Supabase and Schedule) is about 670 kB, so a warning
    // here means it grew. Raise it only on purpose.
    chunkSizeWarningLimit: 700,
  },
});
