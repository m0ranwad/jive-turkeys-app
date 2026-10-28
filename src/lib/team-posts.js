// Messages captains post in Team Chat (or copy) from other screens: a game
// reminder and a call for subs. `nameOf` names a player: their chat @mention
// for teammates on the site, so their phones buzz (chatNamer()), or plain
// names for a copy (plainName).
import { fmtDateShort, fmtTime, jerseyText } from '@/lib/format';
import { mentionPeople } from '@/lib/mentions';

const women = (n) => (n === 1 ? 'woman' : 'women');

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
  if (headcount.needTotal || headcount.needWomen) {
    const needs = [];
    if (headcount.needTotal) needs.push(`Need ${headcount.needTotal} more`);
    if (headcount.needWomen) needs.push(`${headcount.needWomen} more ${women(headcount.needWomen)}`);
    lines.push(`${needs.join(' / ')}. Subs, tap IN if you can play.`);
  }
  lines.push(`RSVP: ${link}`);
  return lines.join('\n');
}

/** Teammates available to sub who haven't said IN or OUT for the game. */
export function subsToAsk({ game, profiles, rsvps }) {
  const answered = new Set(
    (rsvps || []).filter((r) => r.game_id === game.id && ['in', 'out'].includes(r.status)).map((r) => r.user_id),
  );
  return (profiles || []).filter((p) => p.status === 'sub_pool' && !answered.has(p.user_id));
}

/**
 * "Subs needed": the available subs by name, and how many more we need.
 * `headcount` is the game's headcount() (src/lib/team-logic.js), the same
 * shortage the game screen and Schedule show.
 */
export function subsCall({ game, headcount, settings, profiles, rsvps, link, nameOf = plainName }) {
  const subs = subsToAsk({ game, profiles, rsvps }).map(nameOf);
  const lines = [
    `🦃 Jive Turkeys — subs needed for ${fmtDateShort(game.date)} · ${fmtTime(game.time)}`,
    `vs ${game.opponent} · Field ${game.field_number || 'TBD'} · Jersey: ${jerseyText(game.jersey, settings)}`,
  ];
  if (subs.length) lines.push(`Available to sub: ${subs.join(', ')}`);
  else lines.push('No available subs left to ask.');

  const needs = [];
  if (headcount.needTotal) needs.push(`${headcount.needTotal} more`);
  if (headcount.needWomen) needs.push(`${headcount.needWomen} more ${women(headcount.needWomen)}`);
  if (needs.length) lines.push(`Need ${needs.join(' / ')}. Tap IN if you can play.`);
  lines.push(`RSVP: ${link}`);
  return lines.join('\n');
}
