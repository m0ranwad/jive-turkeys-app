// Shared with the account service. Usernames are separate from roster/display names.
export const normalizeUsername = (value) => String(value || '').trim().toLowerCase();
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,23}$/;

// A username close to what was typed: "Josh Smith" becomes "josh_smith".
export function suggestUsername(value) {
  const username = normalizeUsername(value).replace(/\s+/g, '_').replace(/[^a-z0-9._-]/g, '').replace(/^[._-]+/, '');
  return USERNAME.test(username) ? username : '';
}
export function usernameProblem(value) {
  const username = normalizeUsername(value);
  if (USERNAME.test(username)) return '';
  if (username.length < 3) return 'Use at least 3 letters or numbers for your username.';
  if (username.length > 24) return 'Keep your username to 24 characters or fewer.';
  const suggestion = suggestUsername(value);
  if (suggestion) return `Usernames can't have spaces or symbols. How about ${suggestion}?`;
  return 'Use letters and numbers for your username. Dots, dashes and underscores are fine too.';
}

// Email-free accounts get a random address here so Supabase can manage their
// password. It's never shown, and never stored in public.users.
export const INTERNAL_EMAIL_DOMAIN = 'players.jiveturkeys.invalid';
export const isInternalEmail = (email) => String(email || '').toLowerCase().endsWith(`@${INTERNAL_EMAIL_DOMAIN}`);

export const RESET_IN_PROGRESS = 'A reset is finishing—try again in a moment.';
export const RESET_CLAIM_TIMEOUT_MS = 2 * 60 * 1000;

// A captain's one-time reset code: 8 letters and numbers, easy to read out or
// text. There's no 0, O, 1, I or L, so none can be mistaken for another.
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function makeResetCode() {
  const letters = [];
  while (letters.length < 8) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      // 248 is the largest multiple of 31 below 256, so every letter is equally likely.
      if (byte < 248 && letters.length < 8) letters.push(CODE_LETTERS[byte % CODE_LETTERS.length]);
    }
  }
  return `${letters.slice(0, 4).join('')}-${letters.slice(4).join('')}`;
}
export const normalizeResetCode = (value) => String(value || '').replace(/[\s-]/g, '').toUpperCase();
export const isResetCode = (value) => new RegExp(`^[${CODE_LETTERS}]{8}$`).test(normalizeResetCode(value));

export async function sha256Hex(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
export const resetCodeHash = (code) => sha256Hex(normalizeResetCode(code));
