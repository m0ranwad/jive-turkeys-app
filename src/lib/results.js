import { rosterProfiles, sumField } from './team-logic';

/** Coed rule: two-goal limit per man. */
export const MAX_GOALS_MAN = 2;

/** The most goals this player can be given in one game, or null for no limit. */
export const goalLimit = (profile) => (profile?.gender === 'M' ? MAX_GOALS_MAN : null);

export const atGoalLimit = (row) => {
  const limit = goalLimit(row.profile);
  return limit !== null && row.goals >= limit;
};

/** The players' goals added up. */
export const goalsTotal = (rows = []) => sumField(rows, 'goals');

export const hasNumbers = (row) => row.goals + row.assists + row.blue_cards + row.red_cards > 0;

/**
 * Who the result screen lists: everyone who played, plus anyone with a saved
 * line who didn't (say, a red card from the bench), so nothing is hidden.
 */
export const listedRows = (rows = []) => rows.filter((row) => row.played || hasNumbers(row));

/**
 * One row per player for a game's result: their saved line, or, before the
 * result is first saved, played if they RSVP'd IN. Once it's saved, no line
 * means they didn't play. `rsvps` and `stats` keyed with keyedRow().
 */
export function resultRows({ game, profiles = [], rsvps = [], stats = [] }) {
  const rsvpByUser = {};
  rsvps.filter((r) => r.game_id === game.id).forEach((r) => (rsvpByUser[r.user_id] = r));
  const statByUser = {};
  stats.filter((s) => s.game_id === game.id).forEach((s) => (statByUser[s.user_id] = s));
  return rosterProfiles(profiles)
    .sort((a, b) => a.display_name.localeCompare(b.display_name))
    .map((profile) => {
      const s = statByUser[profile.user_id];
      return {
        profile,
        played: s ? !!s.played : !game.has_result && rsvpByUser[profile.user_id]?.status === 'in',
        goals: s?.goals || 0,
        assists: s?.assists || 0,
        blue_cards: s?.blue_cards || 0,
        red_cards: s?.red_cards || 0,
      };
    });
}

/**
 * Our score follows the players' goals until a captain changes it. An edited
 * result keeps following them only if the saved score still matches.
 */
export const scoreFollowsGoals = (game, rows) => !game.has_result || (game.score_us ?? 0) === goalsTotal(rows);
