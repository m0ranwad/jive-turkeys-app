// Player of the Match voting: it opens when a captain posts a result and closes
// a set number of hours later (Team Settings). The database enforces the
// deadline (potm_voting_open()); this is what the screens show.
import dayjs from 'dayjs';

/** The awards voted on: one overall, or Man and Woman of the Match. */
export const potmAwards = (settings) => (settings?.potm_mode === 'overall' ? ['overall'] : ['man', 'woman']);

/** Votes are taken until the deadline. Games from before deadlines have none and stay open. */
export const votingOpen = (game, now = new Date()) =>
  !!game?.has_result && (!game.potm_closes_at || dayjs(game.potm_closes_at).isAfter(now));

/** "Fri 9:30 AM" */
export const closesLabel = (at) => dayjs(at).format('ddd h:mm A');

/** "1 hour", "3 hours" */
export const hoursLabel = (hours) => `${hours} hour${Number(hours) === 1 ? '' : 's'}`;

/**
 * Games with a deadline still to come that you played and haven't cast every
 * vote for, soonest deadline first. `stats` and `votes` are keyed like
 * useSeasonData()'s.
 */
export function gamesToVoteOn({ games = [], stats = [], votes = [], userId, settings, now = new Date() }) {
  const awards = potmAwards(settings).length;
  return games
    .filter((g) => g.potm_closes_at && votingOpen(g, now))
    .filter((g) => stats.some((s) => s.game_id === g.id && s.user_id === userId && s.played))
    .filter((g) => votes.filter((v) => v.game_id === g.id && v.voter_id === userId).length < awards)
    .sort((a, b) => (a.potm_closes_at < b.potm_closes_at ? -1 : 1));
}
