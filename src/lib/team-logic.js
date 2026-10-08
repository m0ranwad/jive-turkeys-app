import { DEFAULT_SETTINGS } from './constants';

export const resultOf = (game) => {
  const us = game?.score_us ?? 0;
  const them = game?.score_them ?? 0;
  return us > them ? 'W' : us < them ? 'L' : 'D';
};

/** Players who count toward RSVPs: active, sub pool, or on break. */
export const isRosterStatus = (profile) =>
  !!profile && ['active', 'sub_pool', 'on_break'].includes(profile.status || 'active');

export const rosterProfiles = (profiles = []) => profiles.filter(isRosterStatus);

export const sumField = (rows, key) => rows.reduce((total, row) => total + (row[key] || 0), 0);

/**
 * RSVP headcount for one game. Women playing GK don't count toward the
 * women-on-the-field minimum.
 */
export function headcount({ game, rsvps, profiles, settings }) {
  const roster = rosterProfiles(profiles);
  const byUser = {};
  (rsvps || []).filter((r) => r.game_id === game?.id).forEach((r) => (byUser[r.user_id] = r));

  const groups = { in: [], out: [], maybe: [], none: [] };
  roster.forEach((profile) => {
    const rsvp = byUser[profile.user_id];
    const entry = { profile, playing_gk: !!rsvp?.playing_gk };
    (groups[rsvp ? rsvp.status : 'none'] || groups.none).push(entry);
  });

  const womenIn = groups.in.filter((e) => e.profile.gender === 'F');
  const womenFieldIn = womenIn.filter((e) => !e.playing_gk).length;
  const totalIn = groups.in.length;
  const minPlayers = settings?.min_players ?? DEFAULT_SETTINGS.min_players;
  const minWomen = settings?.min_women ?? DEFAULT_SETTINGS.min_women;
  const needTotal = Math.max(0, minPlayers - totalIn);
  const needWomen = Math.max(0, minWomen - womenFieldIn);

  return {
    groups,
    totalIn,
    womenIn: womenIn.length,
    womenFieldIn,
    minPlayers,
    minWomen,
    needTotal,
    needWomen,
    isShort: needTotal > 0 || needWomen > 0,
  };
}

/** Anyone who got a red card in the previous played game sits this one out. */
export function suspendedIds(game, games, stats) {
  const previous = (games || [])
    .filter((g) => g.has_result && g.id !== game?.id && g.date < (game?.date || ''))
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!previous) return [];
  return (stats || [])
    .filter((s) => s.game_id === previous.id && (s.red_cards || 0) > 0)
    .map((s) => s.user_id);
}

export function filterGames(games = [], year, session) {
  return games.filter(
    (g) => (year === 'all' || g.season_year === year) && (session === 'all' || g.session === session),
  );
}

export function record(games = []) {
  let w = 0;
  let l = 0;
  let d = 0;
  let gf = 0;
  let ga = 0;
  games
    .filter((g) => g.has_result)
    .forEach((g) => {
      const us = g.score_us || 0;
      const them = g.score_them || 0;
      gf += us;
      ga += them;
      if (us > them) w += 1;
      else if (us < them) l += 1;
      else d += 1;
    });
  return { w, l, d, gf, ga, played: w + l + d };
}

/** For one game: { award: [winning user ids] } (ties share the award). */
export function awardWinners(gameId, votes = []) {
  const tally = {};
  votes
    .filter((v) => v.game_id === gameId)
    .forEach((v) => {
      tally[v.award] = tally[v.award] || {};
      tally[v.award][v.voted_for_id] = (tally[v.award][v.voted_for_id] || 0) + 1;
    });
  const winners = {};
  Object.keys(tally).forEach((award) => {
    const top = Math.max(...Object.values(tally[award]));
    winners[award] = Object.keys(tally[award]).filter((id) => tally[award][id] === top);
  });
  return winners;
}

/** { userId: { overall, man, woman, total } } across games with results. */
export function awardCounts(games = [], votes = []) {
  const counts = {};
  games
    .filter((g) => g.has_result)
    .forEach((g) => {
      const winners = awardWinners(g.id, votes);
      Object.keys(winners).forEach((award) => {
        winners[award].forEach((userId) => {
          counts[userId] = counts[userId] || { overall: 0, man: 0, woman: 0, total: 0 };
          counts[userId][award] += 1;
          counts[userId].total += 1;
        });
      });
    });
  return counts;
}

export function leaderboard({ games = [], stats = [], profiles = [], votes = [], year = 'all', session = 'all' }) {
  const filtered = filterGames(games, year, session);
  const gameIds = new Set(filtered.map((g) => g.id));
  const statsInRange = stats.filter((s) => gameIds.has(s.game_id));
  const awards = awardCounts(
    filtered,
    votes.filter((v) => gameIds.has(v.game_id)),
  );
  return profiles.map((profile) => {
    const mine = statsInRange.filter((s) => s.user_id === profile.user_id);
    return {
      profile,
      games: mine.filter((s) => s.played).length,
      goals: sumField(mine, 'goals'),
      assists: sumField(mine, 'assists'),
      blue: sumField(mine, 'blue_cards'),
      red: sumField(mine, 'red_cards'),
      awards: awards[profile.user_id]?.total || 0,
    };
  });
}

export function careerStats({ games = [], stats = [], profiles = [], votes = [] }) {
  const awards = awardCounts(games, votes);
  const gamesById = {};
  games.forEach((g) => (gamesById[g.id] = g));

  return profiles
    .map((profile) => {
      const mine = stats.filter((s) => s.user_id === profile.user_id);
      const sessions = {};
      mine
        .filter((s) => s.played)
        .forEach((s) => {
          const game = gamesById[s.game_id];
          if (!game) return;
          const key = `${game.season_year}-${game.session}`;
          sessions[key] = sessions[key] || {
            year: game.season_year,
            session: game.session,
            games: 0,
            goals: 0,
            assists: 0,
            blue: 0,
            red: 0,
          };
          const row = sessions[key];
          row.games += 1;
          row.goals += s.goals || 0;
          row.assists += s.assists || 0;
          row.blue += s.blue_cards || 0;
          row.red += s.red_cards || 0;
        });
      return {
        profile,
        totals: {
          games: mine.filter((s) => s.played).length,
          goals: sumField(mine, 'goals'),
          assists: sumField(mine, 'assists'),
          blue: sumField(mine, 'blue_cards'),
          red: sumField(mine, 'red_cards'),
          awards: awards[profile.user_id]?.total || 0,
        },
        sessions: Object.values(sessions).sort((a, b) => b.year - a.year || b.session - a.session),
      };
    })
    .sort((a, b) => b.totals.games - a.totals.games || b.totals.goals - a.totals.goals);
}

export function recordVsOpponents(games = []) {
  const byOpponent = {};
  games
    .filter((g) => g.has_result)
    .forEach((g) => {
      const name = g.opponent || 'Unknown';
      byOpponent[name] = byOpponent[name] || { opponent: name, w: 0, l: 0, d: 0, gf: 0, ga: 0, played: [] };
      const row = byOpponent[name];
      const us = g.score_us || 0;
      const them = g.score_them || 0;
      row.gf += us;
      row.ga += them;
      if (us > them) row.w += 1;
      else if (us < them) row.l += 1;
      else row.d += 1;
      row.played.push({ ...g, result: resultOf(g) });
    });
  return Object.values(byOpponent)
    .map((row) => ({ ...row, played: row.played.sort((a, b) => (a.date < b.date ? 1 : -1)) }))
    .sort((a, b) => b.played.length - a.played.length || a.opponent.localeCompare(b.opponent));
}
