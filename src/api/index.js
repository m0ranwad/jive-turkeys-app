import { createSupabaseBackend } from './supabase';
import { createDemoBackend, DEMO_LOGIN, DEMO_PLAYER_LOGIN } from './demo';

const url = import.meta.env.VITE_SUPABASE_URL;
// Publishable key (sb_publishable_...); the legacy anon key also works until Supabase retires it.
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isDemo = !url || !key;
export { DEMO_LOGIN, DEMO_PLAYER_LOGIN };

// Demo mode (previews and local development) opens already signed in as the sample captain.
export const api = isDemo ? createDemoBackend({ autoSignIn: true }) : createSupabaseBackend(url, key);
