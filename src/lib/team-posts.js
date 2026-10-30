// Messages captains post in Team Chat (or copy) from other screens: a game
// reminder and a call for subs. `nameOf` names a player: their chat @mention
// for teammates on the site, so their phones buzz (chatNamer()), or plain
// names for a copy (plainName).
import { fmtDateShort, fmtTime, jerseyText } from '@/lib/format';
import { mentionPeople } from '@/lib/mentions';
import { shortageText } from '@/lib/team-logic';

export const plainName = (player) => player.display_name;

/**
 * Names teammates on the site with their chat @mention ("@Jordan R."), the
 * same one the chat shows, and roster names who haven't joined by name.
 * `profiles` is everyone on the site (as the chat lists them).
 */
export function chatNamer(profiles) {
  const labels = new Map(mentionPeople(profiles).map((p) => [p.id, p.label]));
  return (player) => (!player.guest && labels.has(player.user_id) ? `@${labels.get(player.user_id)}` : player.display_name);
}

/** "Are you in?" for a game: who hasn't answered, and how many more we need. */
export function gameReminder({ game, headcount, settings, link, nameOf = plainName }) {
  const pending = headcount.groups.none.map((e) => nameOf(e.profile));
  const lines = [
    `🦃 Jive Turkeys — ${fmtDateShort(game.date)} at ${fmtTime(game.time)}`,
    `vs ${game.opponent} · Field ${game.field_number || 'TBD'}`,
    `Jersey: ${jerseyText(game.jersey, settings)}`,
    `Still to RSVP: ${pending.length ? pending.join(', ') : "everyone's in"}`,
  ];
  const short = shortageText(headcount);
  if (short) lines.push(`${short}. Subs, tap IN if you can play.`);
  lines.push(`RSVP: ${link}`);
  return lines.join('\n');
}

/**
 * Teammates available to sub who haven't said IN or OUT for the game. With the game's
 * `headcount`, only girls when only girls are needed: the open spots are full, so a guy
 * would only sit on the bench (the database's sub call asks the same people).
 */
export function subsToAsk({ game, profiles, rsvps, headcount }) {
  const answered = new Set(
    (rsvps || []).filter((r) => r.game_id === game.id && ['in', 'out'].includes(r.status)).map((r) => r.user_id),
  );
  const girlsOnly = !!headcount && headcount.needWomen > 0 && headcount.needTotal <= headcount.needWomen;
  return (profiles || []).filter(
    (p) => p.status === 'sub_pool' && !answered.has(p.user_id) && (!girlsOnly || p.gender === 'F'),
  );
}

/**
 * "Subs needed": the available subs by name, and how many more we need.
 * `headcount` is the game's headcount() (src/lib/team-logic.js), the same
 * shortage the game screen and Schedule show.
 */
export function subsCall({ game, headcount, settings, profiles, rsvps, link, nameOf = plainName }) {
  const subs = subsToAsk({ game, profiles, rsvps, headcount }).map(nameOf);
  const lines = [
    `🦃 Jive Turkeys — subs needed for ${fmtDateShort(game.date)} · ${fmtTime(game.time)}`,
    `vs ${game.opponent} · Field ${game.field_number || 'TBD'} · Jersey: ${jerseyText(game.jersey, settings)}`,
  ];
  if (subs.length) lines.push(`Available to sub: ${subs.join(', ')}`);
  else lines.push('No available subs left to ask.');

  const short = shortageText(headcount);
  if (short) lines.push(`${short}. Tap IN if you can play.`);
  lines.push(`RSVP: ${link}`);
  return lines.join('\n');
}
