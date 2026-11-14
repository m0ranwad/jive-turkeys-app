// Goalkeepers (docs/games.md section 2): who was in goal each half, goals
// against by half, clean sheets (a half at 0) and the team's record with each
// keeper. A stat line or fill-in has gk_first_half / gk_second_half; a game has
// score_them_first_half, the other team's goals in the 1st half (the 2nd half
// is the rest of score_them; null when nobody was sure how they split).
// Goals against are always worked out. The show_goals_against team setting
// only decides whether the screens show them.

export const HALVES = ['1st half', '2nd half'];
const FLAGS = ['gk_first_half', 'gk_second_half'];

/** The halves (0, 1) this line or fill-in was in goal. */
export const keptHalves = (line) => FLAGS.map((flag, half) => (line?.[flag] ? half : null)).filter((h) => h !== null);

export const isKeeper = (line) => keptHalves(line).length > 0;

/**
 * Goals against in each half, [1st, 2nd], or null when nobody was sure how
 * they split. When the other team didn't score, both halves are 0.
 */
export function halvesAgainst(game) {
  if (!game?.has_result) return null;
  const total = Math.max(0, game.score_them ?? 0);
  if (total === 0) return [0, 0];
  if (game.score_them_first_half === null || game.score_them_first_half === undefined) return null;
  const first = Math.min(total, Math.max(0, game.score_them_first_half));
  return [first, total - first];
}

/**
 * One keeper in one game: halves in goal, clean halves, and goals against
 * (null when it can't be known: they split the game and nobody was sure how
 * the goals split; someone in goal both halves let in the whole score).
 */
export function keeperGame(line, game) {
  const halves = keptHalves(line);
  const split = halvesAgainst(game);
  const clean = split ? halves.filter((h) => split[h] === 0) : [];
  let against = null;
  if (split) against = halves.reduce((sum, h) => sum + split[h], 0);
  else if (halves.length === 2 && game?.has_result) against = game.score_them ?? 0;
  return { halves, clean, against };
}

/** "GK · 1st half", "GK · 2nd half" or "GK · both halves". */
export const keeperLabel = (halves) =>
  halves.length === 2 ? 'GK · both halves' : halves.length === 1 ? `GK · ${HALVES[halves[0]]}` : null;

/** "Clean sheet" when every half they kept was clean, "Clean 2nd half" when only one of two was. */
export function cleanLabel({ halves, clean }) {
  if (!clean.length) return null;
  if (clean.length === halves.length) return 'Clean sheet';
  return `Clean ${HALVES[clean[0]]}`;
}

/**
 * Keeper totals over a player's stat lines: halves in goal, clean halves, goals
 * against, and the team's record in games they kept goal for at least one half.
 * Only games with a result count.
 */
export function keeperTotals(lines = [], gamesById = {}) {
  const totals = { halves: 0, clean: 0, against: 0, w: 0, l: 0, d: 0, games: 0 };
  lines.forEach((line) => {
    const game = gamesById[line.game_id];
    if (!game?.has_result || !isKeeper(line)) return;
    const one = keeperGame(line, game);
    totals.halves += one.halves.length;
    totals.clean += one.clean.length;
    totals.against += one.against ?? 0;
    totals.games += 1;
    const us = game.score_us ?? 0;
    const them = game.score_them ?? 0;
    totals[us > them ? 'w' : us < them ? 'l' : 'd'] += 1;
  });
  return totals;
}

/** "5-2-1". */
export const recordText = (t) => `${t.w}-${t.l}-${t.d}`;

/**
 * Who to suggest in goal on the result screen, from who said "I'll play GK" and
 * is marked as played: [1st half, 2nd half] keys. The keeper Who's coming shows
 * in goal (a guy first) takes the 1st half; the next volunteer takes the 2nd,
 * or the same one plays both.
 */
export function suggestedKeepers(rows = [], rsvps = [], game) {
  const volunteering = new Set(
    rsvps.filter((r) => r.game_id === game?.id && r.status === 'in' && r.playing_gk).map((r) => r.user_id),
  );
  const volunteers = rows.filter((row) => row.played && volunteering.has(row.profile.user_id));
  const first = volunteers.find((row) => row.profile.gender !== 'F') || volunteers[0];
  if (!first) return [null, null];
  const second = volunteers.find((row) => row !== first) || first;
  return [first.profile.user_id, second.profile.user_id];
}
