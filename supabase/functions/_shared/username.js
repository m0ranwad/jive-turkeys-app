// Shared with the account service. Usernames are separate from roster/display names.
export const normalizeUsername = (value) => String(value || '').trim().toLowerCase();
export function usernameProblem(value) {
  return /^[a-z0-9_]{3,24}$/.test(normalizeUsername(value))
    ? ''
    : 'Use 3–24 letters, numbers, or underscores for your username.';
}
// Email-free accounts get a random address here so Supabase can manage their
// password. It's never shown, and never stored in public.users.
export const INTERNAL_EMAIL_DOMAIN = 'players.jiveturkeys.invalid';
export const isInternalEmail = (email) => String(email || '').toLowerCase().endsWith(`@${INTERNAL_EMAIL_DOMAIN}`);
export const normalizeRecoveryCode = (value) => String(value || '').replace(/[\s-]/g, '').toLowerCase();
export function makeRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').match(/.{4}/g).join('-');
}
export async function recoveryHash(code) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeRecoveryCode(code)));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
