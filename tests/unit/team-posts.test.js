// Messages captains post in Team Chat (or copy) from a game: a reminder and a
// call for subs, naming teammates on the site with their @mention.
import { describe, expect, it } from 'vitest';
import { findMentions, mentionPeople } from '@/lib/mentions';
import { chatNamer, gameReminder, plainName, subsCall, subsToAsk } from '@/lib/team-posts';
import { headcount as computeHeadcount } from '@/lib/team-logic';

const profiles = [
  { user_id: 'cc', display_name: 'Casey Captain', status: 'active', gender: 'M' },
  { user_id: 'jr', display_name: 'Jordan Rivera', status: 'active', gender: 'F' },
  { user_id: 'dp', display_name: 'Drew Patel', status: 'sub_pool', gender: 'M' },
  { user_id: 'kn', display_name: 'Kim Nguyen', status: 'sub_pool', gender: 'F' },
  { user_id: 'jf', display_name: 'Jamie Fox', status: 'on_break', gender: 'F' },
  { user_id: 'mr', display_name: 'Mike Russo', status: 'sub_pool', gender: 'M', guest: true },
];
const game = { id: 'g1', date: '2026-10-29', time: '19:00', opponent: 'Goal Diggers', field_number: '2', jersey: 'primary' };
const settings = { min_players: 8, min_women: 3, primary_jersey: 'Bright green/yellow' };
const link = 'https://jiveturkeys.app/games/g1';

describe('naming teammates', () => {
  it("uses the chat's @mention on the site, and the plain name for roster names who haven't joined", () => {
    const nameOf = chatNamer(profiles.filter((p) => !p.guest));
    expect(nameOf(profiles[1])).toBe('@Jordan R.');
    expect(nameOf(profiles[5])).toBe('Mike Russo');
    expect(plainName(profiles[1])).toBe('Jordan Rivera');
  });
});

describe('the game reminder', () => {
  it("names whoever hasn't answered, so the chat finds them as mentions", () => {
    const headcount = {
      groups: { none: [{ profile: profiles[0] }, { profile: profiles[1] }, { profile: profiles[5] }] },
      needTotal: 2,
      needWomen: 1,
    };
    const text = gameReminder({ game, headcount, settings, link, nameOf: chatNamer(profiles) });
    expect(text).toBe(
      [
        'Thu, Oct 29, 7:00 PM vs Goal Diggers',
        'Jersey: Bright green/yellow',
        'Still to RSVP: @Casey C., @Jordan R., Mike Russo',
        'We need 2 more, including a girl. Subs, can you play?',
        link,
      ].join('\n'),
    );
    const people = mentionPeople(profiles.filter((p) => !p.guest));
    expect(findMentions(text, people, { me: 'cc' }).mentions).toEqual(['jr']);
  });

  it("says when everyone has answered (some may have said OUT), and leaves out the shortage when we aren't short", () => {
    const headcount = { groups: { none: [] }, needTotal: 0, needWomen: 0 };
    const text = gameReminder({ game, headcount, settings, link });
    expect(text).toContain('Everyone has answered.');
    expect(text).not.toContain('Still to RSVP');
    expect(text).not.toContain('We need');
  });

  it("leaves out the field (there are only two) and a missing time", () => {
    const headcount = { groups: { none: [] }, needTotal: 0, needWomen: 0 };
    expect(gameReminder({ game, headcount, settings, link })).not.toContain('Field');
    expect(gameReminder({ game: { ...game, time: '' }, headcount, settings, link })).toMatch(/^Thu, Oct 29 vs Goal Diggers\n/);
  });
});

describe('the call for subs', () => {
  const rsvps = [
    { game_id: 'g1', user_id: 'cc', status: 'in' },
    { game_id: 'g1', user_id: 'kn', status: 'out' },
    { game_id: 'g1', user_id: 'dp', status: 'maybe' },
  ];

  it("asks teammates available to sub who haven't said IN or OUT, never unavailable ones", () => {
    expect(subsToAsk({ game, profiles, rsvps }).map((p) => p.user_id)).toEqual(['dp', 'mr']);
  });

  it('names them with their @mention, and says how many more we need', () => {
    const headcount = computeHeadcount({ game, rsvps, profiles, settings });
    const text = subsCall({ game, headcount, settings, profiles, rsvps, link, nameOf: chatNamer(profiles) });
    expect(text).toBe(
      [
        'Subs needed: Thu, Oct 29, 7:00 PM vs Goal Diggers',
        'Jersey: Bright green/yellow',
        'We need 7 more, including 3 girls.',
        '@Drew P., Mike Russo, can you play?',
        link,
      ].join('\n'),
    );
  });

  it('asks only girls when only girls are needed, because a guy would sit on the bench', () => {
    // One girl and seven guys are IN: the open spots are full.
    const team = [
      ...Array.from({ length: 8 }, (_, i) => ({ user_id: `p${i}`, display_name: `Player ${i}`, status: 'active', gender: i < 1 ? 'F' : 'M' })),
      ...profiles,
    ];
    const ins = team.slice(0, 8).map((p) => ({ game_id: 'g1', user_id: p.user_id, status: 'in' }));
    const headcount = computeHeadcount({ game, rsvps: ins, profiles: team, settings });
    expect(subsToAsk({ game, profiles: team, rsvps: ins, headcount }).map((p) => p.user_id)).toEqual(['kn']);
    const text = subsCall({ game, headcount, settings, profiles: team, rsvps: ins, link });
    expect(text).toContain('We need 2 more girls.\nKim Nguyen, can you play?');
  });

  it("counts the shortage the way the game screen does, so an IN from someone off the roster doesn't hide it", () => {
    // Seven on the session's roster are IN, and so is someone who's no longer on it.
    const team = Array.from({ length: 7 }, (_, i) => ({ user_id: `p${i}`, display_name: `Player ${i}`, status: 'active', gender: i < 3 ? 'F' : 'M' }));
    const ins = [...team.map((p) => ({ game_id: 'g1', user_id: p.user_id, status: 'in' })), { game_id: 'g1', user_id: 'gone', status: 'in' }];
    const headcount = computeHeadcount({ game, rsvps: ins, profiles: team, settings });
    expect(headcount.isShort).toBe(true);
    expect(subsCall({ game, headcount, settings, profiles: team, rsvps: ins, link })).toContain(
      // Nobody is left to ask by name.
      'We need 1 more.\nAnyone free?',
    );
  });
});
