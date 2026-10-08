import { createSupabaseBackend } from './supabase';
import { createDemoBackend, DEMO_LOGIN } from './demo';

const url = import.meta.env.VITE_SUPABASE_URL;
// Publishable key (sb_publishable_...); the legacy anon key also works until Supabase retires it.
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isDemo = !url || !key;
export { DEMO_LOGIN };

export const api = isDemo ? createDemoBackend() : createSupabaseBackend(url, key);
