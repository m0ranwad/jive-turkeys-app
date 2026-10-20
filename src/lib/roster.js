// Who's on the team each session (session_roster). Each session keeps its own
// list, so a status change in one session never rewrites another session's dues
// or headcounts. A session's list starts as a copy of everyone's status when it
// becomes the current one (the next game's session), and follows status changes
// while it's current. A session that hasn't started yet uses today's statuses.

const sameSession = (row, period) => row.season_year === Number(period.year) && row.session === Number(period.session);

/** One session's entries. `rows` is every session_roster row, or null before the lists exist. */
export function sessionRows(rows, period) {
  return (rows || []).filter((r) => sameSession(r, period));
}

/** Whether a session has its own list yet. */
export const hasSessionList = (rows, period) => sessionRows(rows, period).length > 0;

/**
 * The team in one session: `members` (player profiles, and roster names shaped
 * by guestAsPlayer(), all keyed by `user_id`) with each one's status for that
 * session. Anyone not on that session's list, or off it, is left out. A session
 * without a list uses today's statuses, as `members` already have them.
 */
export function membersForSession(members, rows, period) {
  const list = sessionRows(rows, period);
  if (!list.length) return members;
  const byMember = new Map(list.map((r) => [r.user_id ?? r.guest_id, r]));
  return members.flatMap((m) => {
    // A roster name that has joined: their account's entry is the one that counts.
    if (m.guest && m.linked_user_id) return [];
    const entry = byMember.get(m.user_id);
    if (!entry || entry.status === 'off') return [];
    return [{ ...m, status: entry.status }];
  });
}

/** One player's (or roster name's) entry in a session's list, or null. */
export const entryFor = (rows, period, memberId) =>
  sessionRows(rows, period).find((r) => (r.user_id ?? r.guest_id) === memberId) || null;

/** Entries still waiting for "Playing session N?" (carried over and not confirmed). */
export const unanswered = (rows, period) => sessionRows(rows, period).filter((r) => !r.answered_at && r.status !== 'off');

/** A session's games, earliest first. */
export const sessionGames = (games, period) =>
  (games || []).filter((g) => sameSession(g, period)).sort((a, b) => a.date.localeCompare(b.date));

/** None of the session's games has been played yet: the time to ask "Playing session N?". */
export function beforeFirstGame(games, period, today) {
  const list = sessionGames(games, period);
  return list.length > 0 && list[0].date >= today;
}

/** Whether `a` comes before `b`. */
export const isEarlier = (a, b) => Number(a.year) < Number(b.year) || (Number(a.year) === Number(b.year) && Number(a.session) < Number(b.session));
