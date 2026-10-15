// @mentions in the chat: who can be mentioned, finding mentions in a message,
// and the list the message box offers while typing a name after @.
import { describe, expect, it } from 'vitest';
import { TEAM, findMentions, mentionChoices, mentionParts, mentionPeople, mentionQuery, mentionsMe } from '@/lib/mentions';

const profiles = [
  { user_id: 'me', display_name: 'Casey Captain' },
  { user_id: 'jr', display_name: 'Jordan Rivera' },
  { user_id: 'so', display_name: 'Sam Okafor' },
  { user_id: 'so2', display_name: 'Sam Ortiz' },
  { user_id: 'ri', display_name: 'Riley' },
  { user_id: 'gone', display_name: 'Pat Gone', removed: true },
  { user_id: null, display_name: 'No Account' },
];
const people = mentionPeople(profiles);
const label = (id) => people.find((p) => p.id === id).label;

describe('who can be mentioned', () => {
  it('uses the chat short name, or the full name when two teammates share one', () => {
    expect(label('jr')).toBe('Jordan R.');
    expect(label('ri')).toBe('Riley');
    expect(label('so')).toBe('Sam Okafor');
    expect(label('so2')).toBe('Sam Ortiz');
    expect(people.some((p) => p.name === 'No Account')).toBe(false);
  });
});

describe('finding mentions in a message', () => {
  it('splits out mentions so they can be highlighted, longest name first', () => {
    expect(mentionParts('@Jordan R. bring the ball, @Sam Ortiz too', people)).toEqual([
      { text: '@Jordan R.', mention: 'jr' },
      { text: ' bring the ball, ' },
      { text: '@Sam Ortiz', mention: 'so2' },
      { text: ' too' },
    ]);
  });

  it('only at the start of a word, and not in the middle of a longer one', () => {
    expect(mentionParts('mail riley@Riley.com', people)).toEqual([{ text: 'mail riley@Riley.com' }]);
    expect(mentionParts('@Rileys', people)).toEqual([{ text: '@Rileys' }]);
    expect(mentionParts("(@riley's turn)", people)).toEqual([{ text: '(' }, { text: '@riley', mention: 'ri' }, { text: "'s turn)" }]);
  });

  it('@team only when asked for', () => {
    expect(mentionParts('@team game moved', people)).toEqual([{ text: '@team game moved' }]);
    expect(mentionParts('@team game moved', people, { team: true })[0]).toEqual({ text: '@team', mention: TEAM });
    expect(mentionParts('@teammates', people, { team: true })).toEqual([{ text: '@teammates' }]);
  });

  it('returns who to save with the message: never yourself, @team only for captains', () => {
    const text = '@team @Casey C. @Jordan R. and @Jordan R. again';
    expect(findMentions(text, people, { me: 'me' })).toEqual({ mentions: ['jr'], team: false });
    expect(findMentions(text, people, { me: 'me', canMentionTeam: true })).toEqual({ mentions: ['jr'], team: true });
    expect(findMentions('no mentions @nobody', people, { me: 'me' })).toEqual({ mentions: [], team: false });
  });

  it('mentions everyone who has the very same name', () => {
    const twins = mentionPeople([
      { user_id: 'a', display_name: 'Alex Kim' },
      { user_id: 'b', display_name: 'Alex Kim' },
    ]);
    expect(findMentions('@Alex Kim hi', twins, { me: 'me' }).mentions.sort()).toEqual(['a', 'b']);
  });

  it('knows a message mentions you by name or @team', () => {
    expect(mentionsMe({ mentions: ['me'] }, 'me')).toBe(true);
    expect(mentionsMe({ mentions_team: true }, 'me')).toBe(true);
    expect(mentionsMe({ mentions: ['jr'] }, 'me')).toBe(false);
    expect(mentionsMe({}, 'me')).toBe(false);
  });
});

describe('the list while typing a name after @', () => {
  it('finds the name being typed at the cursor', () => {
    expect(mentionQuery('hey @Jor', 8)).toEqual({ start: 4, query: 'Jor' });
    expect(mentionQuery('hey @', 5)).toEqual({ start: 4, query: '' });
    expect(mentionQuery('@Jordan R', 9)).toEqual({ start: 0, query: 'Jordan R' });
    expect(mentionQuery('hey @Jor', 3)).toBeNull();
    expect(mentionQuery('me@home', 7)).toBeNull();
    expect(mentionQuery('@Jor\nnext', 9)).toBeNull();
    expect(mentionQuery('@ nope', 6)).toBeNull();
  });

  it('offers teammates whose name fits, first names first, never yourself or removed players', () => {
    expect(mentionChoices(people, '', { me: 'me' }).map((c) => c.id)).toEqual(['jr', 'ri', 'so', 'so2']);
    expect(mentionChoices(people, 'sa', { me: 'me' }).map((c) => c.label)).toEqual(['Sam Okafor', 'Sam Ortiz']);
    expect(mentionChoices(people, 'riv', { me: 'me' }).map((c) => c.id)).toEqual(['jr']);
    expect(mentionChoices(people, 'ri', { me: 'me' }).map((c) => c.id)).toEqual(['ri', 'jr']);
    expect(mentionChoices(people, 'Jordan R', { me: 'me' }).map((c) => c.id)).toEqual(['jr']);
    expect(mentionChoices(people, 'pat', { me: 'me' })).toEqual([]);
    expect(mentionChoices(people, 'casey', { me: 'me' })).toEqual([]);
  });

  it('closes once the name is finished (picking adds a space after it)', () => {
    expect(mentionChoices(people, 'Jordan R. ', { me: 'me' })).toEqual([]);
    expect(mentionChoices(people, 'Jordan R. thanks', { me: 'me' })).toEqual([]);
  });

  it('offers @team to captains only', () => {
    expect(mentionChoices(people, 't', { me: 'me' })).toEqual([]);
    expect(mentionChoices(people, 't', { me: 'me', canMentionTeam: true })[0]).toMatchObject({ id: TEAM, label: 'team' });
    expect(mentionChoices(people, '', { me: 'me', canMentionTeam: true })[0].id).toBe(TEAM);
    expect(mentionChoices(people, 'every', { me: 'me', canMentionTeam: true }).map((c) => c.id)).toEqual([TEAM]);
  });
});
