// What to tell someone when a save doesn't go through, in plain words.

const OFFLINE = /failed to fetch|networkerror|load failed|network request failed|fetch failed/i;
const SIGNED_OUT = /jwt|not signed in|invalid claim|refresh token/i;

/** The reason, in words a player understands. */
export function friendlyError(err) {
  const message = String(err?.message || err || '');
  if (OFFLINE.test(message)) return 'No connection. Check your signal and try again.';
  if (SIGNED_OUT.test(message)) return 'Your sign-in expired. Refresh the page and try again.';
  return message || 'Something went wrong. Try again.';
}

/** The toast for a failed save. Whatever was typed stays on screen. */
export const saveFailedToast = (err) => ({ title: "That didn't save", description: friendlyError(err) });
