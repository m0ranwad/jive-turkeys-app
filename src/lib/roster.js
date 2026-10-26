// Who's on the team each session (session_roster). Each session keeps its own
// list, so a status change in one session never rewrites another session's dues
// or headcounts. A session's list starts as a copy of everyone's status when it
// becomes the current one (the next game's session), and follows status changes
// while it's current. A session that hasn't started yet uses today's statuses.
import { stepSession } from './dues';
import { seasonOf } from './format';

const sameSession = (row, period) => row.season_year === Number(period.year) && row.session === Number(period.session);

/** One session's entries. `rows` is every session_roster row, or null when they didn't load (useTeam()). */
export function sessionRows(rows, period) {
  return (rows || []).filter((r) => sameSession(r, period));
}

/** Whether a session has its own list yet. */
export const hasSessionList = (rows, period) => sessionRows(rows, period).length > 0;

/**
 * The team in one session: `members` (player profiles, and roster names shaped
 * by guestAsPlayer(), all keyed by `user_id`) with each one's status and who
 * they paid with (`pays_with`) for that session. Anyone not on that session's
 * list, or off it, is left out. A session without a list uses today's, as
 * `members` already have them.
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
    return [{ ...m, status: entry.status, pays_with: entry.pays_with_user ?? entry.pays_with_guest ?? null }];
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

/**
 * Whether "Playing session N?" is still being asked of a session: none of its
 * games has been played, and either its schedule is up or captains asked about
 * it ahead with a start date (`startsOn`, from session_asks).
 */
export function stillAsking(games, period, today, startsOn) {
  const list = sessionGames(games, period);
  return list.length > 0 ? list[0].date >= today : !!startsOn;
}

/** The session_asks row captains made for a session, if they're asking about it (it has a start date). */
export const askFor = (asks, period) =>
  (asks || []).find((a) => a.starts_on && a.season_year === Number(period.year) && a.session === Number(period.session)) || null;

/** Whether `a` comes before `b`. */
export const isEarlier = (a, b) => Number(a.year) < Number(b.year) || (Number(a.year) === Number(b.year) && Number(a.session) < Number(b.session));

/**
 * The session a captain's new games most likely belong to (Add game, Import): a
 * later session captains are asking about ("Playing session 2?" while this one
 * wraps up, or before its schedule is out); else the newest session on the
 * schedule while it has games to come; else the one after it; else the first
 * of today's season.
 */
export function sessionForNewGames(games, today, asks) {
  const latest = (games || [])
    .map((g) => ({ year: g.season_year, session: g.session }))
    .reduce((a, b) => (!a || isEarlier(a, b) ? b : a), null);
  const asked = (asks || [])
    .filter((a) => a.starts_on)
    .map((a) => ({ year: a.season_year, session: a.session }))
    .filter((p) => !latest || isEarlier(latest, p))
    .sort((a, b) => (isEarlier(a, b) ? -1 : 1))[0];
  if (asked) return asked;
  if (!latest) return { year: seasonOf(today), session: 1 };
  return (games || []).some((g) => g.date >= today) ? latest : stepSession(latest, 1);
}
