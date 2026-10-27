// Messages captains post in Team Chat (or copy) from a game: a reminder and a
// call for subs, naming teammates on the site with their @mention.
import { describe, expect, it } from 'vitest';
import { findMentions, mentionPeople } from '@/lib/mentions';
import { chatNamer, gameReminder, plainName, subsCall, subsToAsk } from '@/lib/team-posts';

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
    expect(text).toContain('Still to RSVP: @Casey C., @Jordan R., Mike Russo');
    expect(text).toContain('Need 2 more / 1 more woman. Subs, tap IN if you can play.');
    const people = mentionPeople(profiles.filter((p) => !p.guest));
    expect(findMentions(text, people, { me: 'cc' }).mentions).toEqual(['jr']);
  });

  it("copies with plain names", () => {
    const headcount = { groups: { none: [] }, needTotal: 0, needWomen: 0 };
    expect(gameReminder({ game, headcount, settings, link })).toContain("Still to RSVP: everyone's in");
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
    const text = subsCall({ game, settings, profiles, rsvps, link, nameOf: chatNamer(profiles) });
    expect(text).toContain('Available to sub: @Drew P., Mike Russo');
    expect(text).toContain('Need 7 more / 3 more women. Tap IN if you can play.');
    expect(text).toContain(`RSVP: ${link}`);
  });
});
