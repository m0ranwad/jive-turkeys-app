// @mentions in the chat: who can be mentioned, finding mentions in a message's
// text, and the list the message box shows while typing a name after @.
import { shortName } from '@/lib/format';

/** What @team is stored as in the list of who a message mentions (captains only). */
export const TEAM = 'team';
const TEAM_LABEL = 'team';

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const lower = (s) => s.toLocaleLowerCase();

/**
 * Everyone a message can mention, with the name it shows after @: the chat's
 * short name ("Jordan R."), or the full name when two teammates share one.
 * -> [{ id, name, label, removed }]
 */
export function mentionPeople(profiles) {
  const people = profiles
    .filter((p) => p.user_id)
    .map((p) => ({ id: p.user_id, name: p.display_name || 'Player', short: shortName(p.display_name || ''), removed: !!p.removed }));
  const shortCount = new Map();
  for (const p of people) shortCount.set(lower(p.short), (shortCount.get(lower(p.short)) || 0) + 1);
  return people.map(({ short, ...p }) => ({ ...p, label: shortCount.get(lower(short)) > 1 ? p.name : short }));
}

/**
 * Splits text into plain parts and mentions of the given people (and @team if
 * `team`), so they can be highlighted: [{ text }, { text: '@Jordan R.', mention: id | TEAM }].
 * A mention starts a word (so emails don't count), and the longest name wins
 * ("@Sam Ortiz" over "@Sam").
 */
export function mentionParts(text, people, { team = false } = {}) {
  const names = [...people.map((p) => ({ id: p.id, label: p.label })), ...(team ? [{ id: TEAM, label: TEAM_LABEL }] : [])]
    .filter((n) => n.label)
    .sort((a, b) => b.label.length - a.label.length);
  const parts = [];
  let plain = 0;
  let i = text.indexOf('@');
  while (i >= 0 && names.length) {
    const startsWord = i === 0 || !WORD_CHAR.test(text[i - 1]);
    const rest = lower(text.slice(i + 1));
    const hit =
      startsWord &&
      names.find((n) => {
        if (!rest.startsWith(lower(n.label))) return false;
        const after = text[i + 1 + n.label.length];
        return after === undefined || !WORD_CHAR.test(after) || !WORD_CHAR.test(n.label.at(-1));
      });
    if (hit) {
      if (i > plain) parts.push({ text: text.slice(plain, i) });
      const end = i + 1 + hit.label.length;
      parts.push({ text: text.slice(i, end), mention: hit.id });
      plain = end;
      i = text.indexOf('@', end);
    } else {
      i = text.indexOf('@', i + 1);
    }
  }
  if (plain < text.length || !parts.length) parts.push({ text: text.slice(plain) });
  return parts;
}

/**
 * Who a message mentions, from its text: { mentions: [user ids], team } for
 * saving with it. Nobody mentions themselves, and only captains mention @team.
 */
export function findMentions(text, people, { me, canMentionTeam = false } = {}) {
  const ids = new Set();
  let team = false;
  for (const part of mentionParts(text, people, { team: canMentionTeam })) {
    if (part.mention === TEAM) team = true;
    else if (part.mention && part.mention !== me) {
      // Teammates with the very same name are all mentioned.
      people.filter((p) => p.label === people.find((q) => q.id === part.mention).label).forEach((p) => ids.add(p.id));
    }
  }
  ids.delete(me);
  return { mentions: [...ids], team };
}

/**
 * The name being typed after an @, if the cursor is in one: { start, query }.
 * The @ must start a word, and the name can have spaces ("Jordan R") but not
 * a new line.
 */
export function mentionQuery(text, caret) {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf('@');
  if (start < 0 || (start > 0 && WORD_CHAR.test(before[start - 1]))) return null;
  const query = before.slice(start + 1);
  if (query.length > 30 || /\n|^\s|\s\s/.test(query)) return null;
  return { start, query };
}

/**
 * The teammates to offer for what's typed after @: names or labels with a word
 * starting with it, people whose first name starts with it first. @team (for
 * captains) when it fits. Nothing when nobody fits, so the list closes.
 */
export function mentionChoices(people, query, { me, canMentionTeam = false } = {}) {
  const q = lower(query);
  const words = (s) => lower(s).split(/\s+/);
  const fits = (p) => !q || lower(p.label).startsWith(q) || lower(p.name).startsWith(q) || words(p.name).some((w) => w.startsWith(q));
  const choices = people
    .filter((p) => p.id !== me && !p.removed && fits(p))
    .sort((a, b) => {
      const rank = (p) => (lower(p.label).startsWith(q) || lower(p.name).startsWith(q) ? 0 : 1);
      return rank(a) - rank(b) || a.label.localeCompare(b.label);
    });
  const team = canMentionTeam && (!q || ['team', 'everyone', 'all'].some((w) => w.startsWith(q)));
  return team ? [{ id: TEAM, label: TEAM_LABEL, name: 'Everyone on the team' }, ...choices] : choices;
}

/** Whether a message mentions this player: by name, or @team. */
export const mentionsMe = (message, me) => !!message.mentions_team || (!!me && !!message.mentions?.includes(me));
