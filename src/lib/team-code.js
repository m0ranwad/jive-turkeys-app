// The team code a new account enters before it can see the team (join_team()
// in the database). Captains change it in Team Settings, for example each new
// session so old invites stop working.
import { sessionRows } from './roster';

// No O/0, I/1 or L, which look alike when read off a phone.
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Six random letters and numbers. */
export function randomCode(length = 6) {
  const values = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(values, (v) => LETTERS[v % LETTERS.length]).join('');
}

/** When a session's list was started (its earliest entry), or null. */
export function sessionStartedAt(rows, period) {
  const times = sessionRows(rows, period)
    .map((r) => r.created_date)
    .filter(Boolean)
    .map((t) => new Date(t).getTime());
  return times.length ? Math.min(...times) : null;
}

/** The code hasn't changed since the current session started, so invites from before still work. */
export function codeIsStale(codeRow, roster) {
  if (!codeRow || !roster?.current) return false;
  const started = sessionStartedAt(roster.rows, roster.current);
  const changed = new Date(codeRow.updated_date || codeRow.created_date).getTime();
  return started !== null && changed < started;
}

/** What join_team() answered, for the player. */
export const JOIN_ERRORS = {
  wrong: "That code isn't right. Check the invite from your captain.",
  blocked: 'Too many tries. Try again in an hour.',
  removed: 'A captain took this account off the team. Ask a captain if you should be added back.',
};
