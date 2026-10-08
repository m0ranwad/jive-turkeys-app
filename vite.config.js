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

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  build: {
    // The spreadsheet reader is split into its own lazily loaded chunk.
    chunkSizeWarningLimit: 700,
  },
});
