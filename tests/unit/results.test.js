// The logic behind the Enter result screen: who's listed, the two-goal limit
// for men, and our score following the players' goals.
import { describe, expect, it } from 'vitest';
import { guestAsPlayer } from '@/lib/dues';
import { atGoalLimit, fillInLabel, gameFillIns, goalLimit, goalsTotal, listedRows, resultRows, scoreFollowsGoals } from '@/lib/results';

const game = { id: 'g1', has_result: false, score_us: null, score_them: null };
const kim = { user_id: 'kim', display_name: 'Kim', gender: 'F', status: 'active' };
const pat = { user_id: 'pat', display_name: 'Pat', gender: 'M', status: 'active' };
const sid = { user_id: 'sid', display_name: 'Sid', gender: 'M', status: 'sub_pool' };
const gone = { user_id: 'gone', display_name: 'Gone', gender: 'M', status: 'inactive' };
const mike = guestAsPlayer({ id: 'mike', display_name: 'Mike', gender: 'M', status: 'active' });

const line = (user_id, values) => ({
  game_id: 'g1', user_id, played: true, goals: 0, assists: 0, blue_cards: 0, red_cards: 0, ...values,
});

describe('result rows', () => {
  it("start with whoever RSVP'd IN as played, sorted by name, roster names included", () => {
    const rows = resultRows({
      game,
      profiles: [pat, kim, sid, gone, mike],
      rsvps: [
        { game_id: 'g1', user_id: 'kim', status: 'in' },
        { game_id: 'g1', user_id: 'mike', status: 'in' },
        { game_id: 'g1', user_id: 'pat', status: 'maybe' },
        { game_id: 'other', user_id: 'sid', status: 'in' },
      ],
    });
    expect(rows.map((r) => [r.profile.display_name, r.played])).toEqual([
      ['Kim', true],
      ['Mike', true],
      ['Pat', false],
      ['Sid', false],
    ]);
    expect(rows[0]).toMatchObject({ goals: 0, assists: 0, blue_cards: 0, red_cards: 0 });
  });

  it('use the saved line once there is one, whatever the RSVP said', () => {
    const rows = resultRows({
      game: { ...game, has_result: true },
      profiles: [kim, pat],
      rsvps: [{ game_id: 'g1', user_id: 'kim', status: 'in' }],
      stats: [line('kim', { played: false, red_cards: 1 }), line('pat', { goals: 2, assists: 1 })],
    });
    expect(rows[0]).toMatchObject({ played: false, red_cards: 1 });
    expect(rows[1]).toMatchObject({ played: true, goals: 2, assists: 1 });
  });

  it("once the result is saved, someone IN without a line didn't play (taken off as a no-show)", () => {
    const rsvps = [{ game_id: 'g1', user_id: 'kim', status: 'in' }];
    expect(resultRows({ game: { ...game, has_result: true }, profiles: [kim], rsvps })[0].played).toBe(false);
  });

  it("list everyone who played, plus anyone with a saved line who didn't", () => {
    const rows = [
      { profile: kim, played: true, goals: 0, assists: 0, blue_cards: 0, red_cards: 0 },
      { profile: pat, played: false, goals: 0, assists: 0, blue_cards: 0, red_cards: 1 },
      { profile: sid, played: false, goals: 0, assists: 0, blue_cards: 0, red_cards: 0 },
    ];
    expect(listedRows(rows).map((r) => r.profile.user_id)).toEqual(['kim', 'pat']);
  });
});

describe('two-goal limit', () => {
  it('applies to men only, fill-ins included', () => {
    expect(goalLimit(pat.gender)).toBe(2);
    expect(goalLimit(mike.gender)).toBe(2);
    expect(goalLimit(kim.gender)).toBeNull();
    expect(goalLimit(null)).toBeNull();
    expect(atGoalLimit('M', 1)).toBe(false);
    expect(atGoalLimit('M', 2)).toBe(true);
    expect(atGoalLimit('M', 3)).toBe(true);
    expect(atGoalLimit('F', 5)).toBe(false);
  });
});

describe('fill-ins', () => {
  const dave = { id: 'f1', game_id: 'g1', display_name: 'Dave', gender: 'M', goals: 1, created_date: '2026-10-14T19:05:00Z' };
  const unknown = { id: 'f2', game_id: 'g1', display_name: null, gender: 'F', goals: 2, created_date: '2026-10-14T19:01:00Z' };
  const otherGame = { id: 'f3', game_id: 'g9', display_name: 'Lou', gender: 'M', goals: 1, created_date: '2026-10-14T19:00:00Z' };

  it("are only this game's, oldest first", () => {
    expect(gameFillIns(game, [dave, otherGame, unknown]).map((f) => f.id)).toEqual(['f2', 'f1']);
  });

  it('go by their name, or "Fill-in" when nobody caught it', () => {
    expect(fillInLabel(dave, 0, 1)).toBe('Dave');
    expect(fillInLabel(unknown, 0, 1)).toBe('Fill-in');
    expect(fillInLabel(unknown, 1, 2)).toBe('Fill-in 2');
    expect(fillInLabel({ display_name: '  ' }, 0, 1)).toBe('Fill-in');
  });

  it('count toward our score', () => {
    const rows = [{ profile: kim, goals: 2 }];
    expect(goalsTotal(rows, [dave, unknown])).toBe(5);
    expect(scoreFollowsGoals({ ...game, has_result: true, score_us: 5 }, rows, [dave, unknown])).toBe(true);
    expect(scoreFollowsGoals({ ...game, has_result: true, score_us: 2 }, rows, [dave, unknown])).toBe(false);
  });
});

describe('our score', () => {
  const rows = [
    { profile: kim, goals: 2 },
    { profile: pat, goals: 1 },
  ];

  it("adds up the players' goals", () => {
    expect(goalsTotal(rows)).toBe(3);
    expect(goalsTotal([])).toBe(0);
  });

  it("follows the players' goals for a new result", () => {
    expect(scoreFollowsGoals(game, rows)).toBe(true);
  });

  it('keeps following them on edit only if the saved score still matches', () => {
    expect(scoreFollowsGoals({ ...game, has_result: true, score_us: 3 }, rows)).toBe(true);
    // Say, an own goal by the other team: the captain's number stays.
    expect(scoreFollowsGoals({ ...game, has_result: true, score_us: 4 }, rows)).toBe(false);
  });
});
