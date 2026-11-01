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
 * A sign-up or stat line keyed like everyone else: a roster name's row (someone
 * who hasn't joined the site) has its guest id as `user_id`, the way roster
 * names themselves are keyed (guestAsPlayer() in dues.js).
 */
export const keyedRow = (row) => (row.user_id ? row : { ...row, user_id: row.guest_id });

/** A Player of the Match vote keyed the same way. */
export const keyedVote = (vote) => (vote.voted_for_id ? vote : { ...vote, voted_for_id: vote.voted_for_guest_id });

/** Who a new row is for: an app player's user_id, or a roster name's guest_id. */
export const playerKey = (player) =>
  player.guest ? { user_id: null, guest_id: player.user_id } : { user_id: player.user_id, guest_id: null };

/**
 * RSVP headcount for one game. Girls playing GK don't count toward the
 * girls-on-the-field minimum. Active players who haven't answered are "No
 * reply"; available subs who haven't are "Subs". Unavailable players without
 * an answer have their own group. `profiles` can include roster names, and `rsvps` must be
 * keyed with keyedRow().
 */
export function headcount({ game, rsvps, profiles, settings }) {
  const roster = rosterProfiles(profiles);
  const byUser = {};
  (rsvps || []).filter((r) => r.game_id === game?.id).forEach((r) => (byUser[r.user_id] = r));

  const groups = { in: [], out: [], maybe: [], none: [], subs: [], unavailable: [] };
  roster.forEach((profile) => {
    const rsvp = byUser[profile.user_id];
    const entry = { profile, playing_gk: !!rsvp?.playing_gk };
    if (rsvp) (groups[rsvp.status] || groups.none).push(entry);
    else if (profile.status === 'on_break') groups.unavailable.push(entry);
    else ((profile.status || 'active') === 'active' ? groups.none : groups.subs).push(entry);
  });

  const womenIn = groups.in.filter((e) => e.profile.gender === 'F');
  const womenFieldIn = womenIn.filter((e) => !e.playing_gk).length;
  const totalIn = groups.in.length;
  const minPlayers = settings?.min_players ?? DEFAULT_SETTINGS.min_players;
  const minWomen = settings?.min_women ?? DEFAULT_SETTINGS.min_women;
  const needTotal = Math.max(0, minPlayers - totalIn);
  const needWomen = Math.max(0, minWomen - womenFieldIn);

  // The field as spots: one goal, `minWomen` outfield spots only girls fill, and the rest open to
  // anyone (so at most 4 guys plus a guy in goal). Any number can say they'll play GK (two often
  // share goal): the first takes the goal, a guy first, and the rest count like anyone else, so
  // volunteering never puts someone on the bench. With no volunteer, someone left over plays goal.
  const keepers = groups.in.filter((e) => e.playing_gk);
  const keeper = keepers.find((e) => e.profile.gender !== 'F') || keepers[0];
  const goal = minPlayers > 0 ? 1 : 0;
  const girls = Math.max(0, Math.min(minWomen, minPlayers - goal));
  const open = Math.max(0, minPlayers - goal - girls);
  const girlsFilled = Math.min(girls, womenFieldIn);
  const others = totalIn - girlsFilled - (keeper ? 1 : 0);
  const openFilled = Math.min(open, others);
  const goalFilled = keeper ? goal : Math.min(goal, others - openFilled);

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
    keepers,
    spots: { goal, girls, open, goalFilled, girlsFilled, openFilled, volunteer: !!keeper, bench: totalIn - goalFilled - girlsFilled - openFilled },
  };
}

const girlsWord = (n) => (n === 1 ? 'girl' : 'girls');

/**
 * A shortage in one line, the same on the game page, Schedule and chat posts: "Need 2 more,
 * including a girl", "Need 2 more girls", "Need 8, including 3 girls" when nobody's in. Null
 * when the team is full. The number still needed is the larger of `needTotal` and `needWomen`,
 * which is what the spots in headcount() leave empty.
 */
export function shortageText({ needTotal = 0, needWomen = 0, totalIn }) {
  const need = Math.max(needTotal, needWomen);
  if (!need) return null;
  const count = totalIn === 0 ? `Need ${need}` : `Need ${need} more`;
  if (!needWomen) return count;
  if (needWomen === need) return `${count} ${girlsWord(need)}`;
  return `${count}, including ${needWomen === 1 ? 'a girl' : `${needWomen} girls`}`;
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

const nameWords = (name = '') => name.toLowerCase().replace(/\./g, '').split(/\s+/).filter(Boolean);

/**
 * Probably the same person: same first name, and last names that agree as far
 * as both go ("Brian K." and "Brian Kircher", or "Brian" and anything Brian).
 */
export function sameName(a, b) {
  const [first, ...rest] = nameWords(a);
  const [otherFirst, ...otherRest] = nameWords(b);
  if (!first || first !== otherFirst) return false;
  const last = rest.join(' ');
  const otherLast = otherRest.join(' ');
  if (!last || !otherLast) return true;
  return last === otherLast || (last.length === 1 && otherLast.startsWith(last)) || (otherLast.length === 1 && last.startsWith(otherLast));
}

/**
 * The account a roster name's player probably joined with, or null: a name like
 * it, on an account that hasn't picked a roster name, and not one a captain
 * already took this name off (`links` are team_guest_links rows).
 */
export function likelyAccount(guest, players, guests = [], links = []) {
  const taken = new Set(guests.map((g) => g.linked_user_id).filter(Boolean));
  const undone = new Set(links.filter((l) => l.guest_id === guest.id && l.unlinked_at).map((l) => l.user_id));
  return players.find((p) => !taken.has(p.user_id) && !undone.has(p.user_id) && sameName(p.display_name, guest.display_name)) || null;
}

/** "Josh", "Josh and Sam", "Josh, Sam and Kim". */
export const nameList = (names) => (names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** Whether a captain said these two accounts are different people (`checks` are team_name_checks rows). */
const markedDifferent = (a, b, checks) =>
  checks.some(
    (c) => c.kind === 'different_people' && ((c.user_id === a && c.other_user_id === b) || (c.user_id === b && c.other_user_id === a)),
  );

/**
 * Other accounts that might be the same person as `player`, signed up twice: a
 * name like theirs ("Josh A" and "Josh Allen"). Two accounts that each picked a
 * roster name are two people, and so is a pair a captain marked as different.
 */
export function lookalikeAccounts(player, accounts, guests = [], checks = []) {
  const named = new Set(guests.map((g) => g.linked_user_id).filter(Boolean));
  return accounts.filter(
    (o) =>
      o.user_id !== player.user_id &&
      sameName(o.display_name, player.display_name) &&
      !(named.has(o.user_id) && named.has(player.user_id)) &&
      !markedDifferent(o.user_id, player.user_id, checks),
  );
}

/**
 * Whether `player` joined without picking a roster name while names were
 * waiting to be picked: they may be one of the grey cards under another name
 * ("Robert" for "Bob"). Not once a captain says they aren't on the roster.
 */
export function skippedRosterName(player, guests = [], checks = []) {
  if (!guests.some((g) => !g.removed && !g.linked_user_id)) return false;
  if (guests.some((g) => g.linked_user_id === player.user_id)) return false;
  if (checks.some((c) => c.kind === 'not_on_roster' && c.user_id === player.user_id)) return false;
  const rosterStarted = Math.min(...guests.map((g) => new Date(g.created_date).getTime()));
  return new Date(player.created_date).getTime() > rosterStarted;
}

/**
 * Names pasted one per line, sorted out against the roster: new ones, ones
 * already on it (same name), ones that look like someone on it, and ones too
 * long to save. Blank lines and repeats are dropped.
 */
export function sortPastedNames(text, rosterNames, maxLength = 60) {
  const lines = text.split('\n').map((n) => n.trim().replace(/\s+/g, ' ')).filter(Boolean);
  const typed = lines.filter((n, i) => lines.findIndex((m) => m.toLowerCase() === n.toLowerCase()) === i);
  const result = { fresh: [], existing: [], lookalike: [], tooLong: [] };
  for (const name of typed) {
    const like = rosterNames.find((r) => sameName(name, r));
    if (name.length > maxLength) result.tooLong.push(name);
    else if (rosterNames.some((r) => r.trim().toLowerCase() === name.toLowerCase())) result.existing.push(name);
    else if (like) result.lookalike.push({ name, like });
    else result.fresh.push(name);
  }
  return result;
}
