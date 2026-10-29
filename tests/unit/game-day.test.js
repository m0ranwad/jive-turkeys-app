// Game day: headcounts, red-card suspensions, the team record, Player of the
// Match awards, the leaderboard and career stats, and reading a league schedule
// file. docs/games.md lists each rule and where it's checked; the database rules
// are in supabase/tests/games.test.sql and the screens in tests/e2e/game-day.spec.js.
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { normalizeDate, normalizeTime, parseScheduleFile } from '@/lib/schedule-import';
import {
  awardCounts,
  awardWinners,
  careerStats,
  filterGames,
  headcount,
  leaderboard,
  record,
  recordVsOpponents,
  resultOf,
  suspendedIds,
} from '@/lib/team-logic';

const player = (user_id, gender, status = 'active') => ({ user_id, display_name: user_id, gender, status });
const rsvp = (user_id, status, playing_gk = false, game_id = 'g') => ({ game_id, user_id, status, playing_gk });
const game = (id, date, us, them, extra = {}) => ({
  id,
  date,
  season_year: 2026,
  session: 1,
  opponent: 'Net Ninjas',
  has_result: us != null,
  score_us: us,
  score_them: them,
  ...extra,
});

describe('the headcount', () => {
  const ann = player('ann', 'F');
  const bea = player('bea', 'F');
  const cat = player('cat', 'F');
  const dan = player('dan', 'M');
  const eli = player('eli', 'M');
  const sub = player('sub', 'M', 'sub_pool');
  const rest = player('rest', 'F', 'on_break');
  const team = [ann, bea, cat, dan, eli, sub, rest];
  const settings = { min_players: 5, min_women: 3 };

  it('sorts everyone into IN, MAYBE, OUT, No reply and Subs', () => {
    const count = headcount({
      game: { id: 'g' },
      rsvps: [rsvp('ann', 'in'), rsvp('bea', 'maybe'), rsvp('dan', 'out'), rsvp('sub', 'in')],
      profiles: team,
      settings,
    });
    const names = (group) => count.groups[group].map((e) => e.profile.user_id);
    expect(names('in')).toEqual(['ann', 'sub']);
    expect(names('maybe')).toEqual(['bea']);
    expect(names('out')).toEqual(['dan']);
    // Playing teammates who haven't answered are No reply; available subs are Subs; unavailable players have their own group.
    expect(names('none')).toEqual(['cat', 'eli']);
    expect(names('subs')).toEqual([]);
    expect(names('unavailable')).toEqual(['rest']);
  });

  it("only counts this game's answers", () => {
    const count = headcount({ game: { id: 'g' }, rsvps: [rsvp('ann', 'in', false, 'other')], profiles: team, settings });
    expect(count.totalIn).toBe(0);
  });

  it("doesn't count a woman in goal toward the women on the field", () => {
    const count = headcount({
      game: { id: 'g' },
      rsvps: [rsvp('ann', 'in', true), rsvp('bea', 'in'), rsvp('cat', 'in'), rsvp('dan', 'in'), rsvp('eli', 'in')],
      profiles: team,
      settings,
    });
    expect(count).toMatchObject({ totalIn: 5, womenIn: 3, womenFieldIn: 2, needTotal: 0, needWomen: 1, isShort: true });
  });

  it('is not short once the minimums are met', () => {
    const count = headcount({
      game: { id: 'g' },
      rsvps: ['ann', 'bea', 'cat', 'dan', 'eli'].map((id) => rsvp(id, 'in')),
      profiles: team,
      settings,
    });
    expect(count).toMatchObject({ needTotal: 0, needWomen: 0, isShort: false });
  });

  it("uses the team's default minimums (8 players, 3 women) without settings", () => {
    const count = headcount({ game: { id: 'g' }, rsvps: [rsvp('dan', 'in')], profiles: team });
    expect(count).toMatchObject({ minPlayers: 8, minWomen: 3, needTotal: 7, needWomen: 3 });
  });

  it('leaves out players who are off the roster', () => {
    const gone = { ...player('gone', 'M'), status: 'inactive' };
    const count = headcount({ game: { id: 'g' }, rsvps: [rsvp('gone', 'in')], profiles: [...team, gone], settings });
    expect(count.totalIn).toBe(0);
    expect(count.groups.none.map((e) => e.profile.user_id)).not.toContain('gone');
  });
});

describe('red-card suspensions', () => {
  const games = [game('g1', '2026-09-03', 2, 1), game('g2', '2026-09-10', 1, 1), game('g3', '2026-09-17'), game('g4', '2026-09-24')];
  const stats = [
    { game_id: 'g1', user_id: 'old', red_cards: 1 },
    { game_id: 'g2', user_id: 'red', red_cards: 1 },
    { game_id: 'g2', user_id: 'blue', blue_cards: 2 },
  ];

  it('sit out the next game after a red card', () => {
    expect(suspendedIds(games[2], games, stats)).toEqual(['red']);
  });

  it('only the next game: an older red card has been served, and blue cards never count', () => {
    expect(suspendedIds(games[2], games, stats)).not.toContain('old');
    expect(suspendedIds(games[2], games, stats)).not.toContain('blue');
  });

  it("are worked out from the last game with a result, so a game that wasn't played yet doesn't serve it", () => {
    expect(suspendedIds(games[3], games, stats)).toEqual(['red']);
  });

  it('nobody is suspended for the first game', () => {
    expect(suspendedIds(games[0], games, stats)).toEqual([]);
  });
});

describe('the team record', () => {
  const games = [
    game('w', '2026-09-03', 3, 1),
    game('l', '2026-09-10', 0, 2, { opponent: 'Goal Diggers' }),
    game('d', '2026-09-17', 2, 2),
    game('next', '2026-09-24'),
  ];

  it('counts wins, losses, draws and goals, from games with a result only', () => {
    expect(record(games)).toEqual({ w: 1, l: 1, d: 1, gf: 5, ga: 5, played: 3 });
    expect(games.slice(0, 3).map(resultOf)).toEqual(['W', 'L', 'D']);
  });

  it('can be narrowed to a season and session', () => {
    const older = game('o', '2025-11-01', 1, 0, { season_year: 2025, session: 3 });
    expect(filterGames([...games, older], 2025, 'all').map((g) => g.id)).toEqual(['o']);
    expect(filterGames([...games, older], 'all', 3).map((g) => g.id)).toEqual(['o']);
    expect(filterGames([...games, older], 'all', 'all')).toHaveLength(5);
  });

  it('is broken down by opponent, most played first, latest game first', () => {
    const rows = recordVsOpponents(games);
    expect(rows.map((r) => [r.opponent, r.w, r.l, r.d, r.gf, r.ga])).toEqual([
      ['Net Ninjas', 1, 0, 1, 5, 3],
      ['Goal Diggers', 0, 1, 0, 0, 2],
    ]);
    expect(rows[0].played.map((g) => [g.id, g.result])).toEqual([
      ['d', 'D'],
      ['w', 'W'],
    ]);
  });
});

describe('Player of the Match awards', () => {
  const vote = (game_id, award, voted_for_id) => ({ game_id, award, voted_for_id });

  it('go to the most votes for each award, and ties share it', () => {
    const votes = [
      vote('g', 'man', 'dan'),
      vote('g', 'man', 'dan'),
      vote('g', 'man', 'eli'),
      vote('g', 'woman', 'ann'),
      vote('g', 'woman', 'bea'),
      vote('other', 'woman', 'cat'),
    ];
    expect(awardWinners('g', votes)).toEqual({ man: ['dan'], woman: ['ann', 'bea'] });
  });

  it('are counted per player across games with a result', () => {
    const games = [game('g1', '2026-09-03', 1, 0), game('g2', '2026-09-10', 2, 0), game('g3', '2026-09-17')];
    const votes = [vote('g1', 'man', 'dan'), vote('g2', 'overall', 'dan'), vote('g2', 'woman', 'ann'), vote('g3', 'man', 'dan')];
    expect(awardCounts(games, votes)).toEqual({
      dan: { overall: 1, man: 1, woman: 0, total: 2 },
      ann: { overall: 0, man: 0, woman: 1, total: 1 },
    });
  });
});

describe('the leaderboard and career stats', () => {
  const games = [
    game('a', '2025-11-01', 4, 2, { season_year: 2025, session: 3 }),
    game('b', '2026-09-03', 3, 1),
    game('c', '2026-09-10', 1, 1, { session: 2 }),
  ];
  const stats = [
    { game_id: 'a', user_id: 'dan', played: true, goals: 2, assists: 1, blue_cards: 0, red_cards: 0 },
    { game_id: 'b', user_id: 'dan', played: true, goals: 1, assists: 0, blue_cards: 1, red_cards: 0 },
    { game_id: 'c', user_id: 'dan', played: true, goals: 0, assists: 2, blue_cards: 0, red_cards: 1 },
    { game_id: 'b', user_id: 'ann', played: true, goals: 2, assists: 1, blue_cards: 0, red_cards: 0 },
    // A stat line for someone who didn't play (a captain cleared "played") counts goals but not a game.
    { game_id: 'c', user_id: 'ann', played: false, goals: 0, assists: 1, blue_cards: 0, red_cards: 0 },
  ];
  const votes = [{ game_id: 'b', award: 'man', voted_for_id: 'dan' }];
  const profiles = [player('dan', 'M'), player('ann', 'F'), player('new', 'F')];

  it('adds up games, goals, assists, cards and awards per player', () => {
    const rows = leaderboard({ games, stats, profiles, votes });
    expect(rows.map((r) => [r.profile.user_id, r.games, r.goals, r.assists, r.blue, r.red, r.awards])).toEqual([
      ['dan', 3, 3, 3, 1, 1, 1],
      ['ann', 1, 2, 2, 0, 0, 0],
      ['new', 0, 0, 0, 0, 0, 0],
    ]);
  });

  it('can be narrowed to a season or a session', () => {
    const season = leaderboard({ games, stats, profiles, votes, year: 2026 });
    expect(season.find((r) => r.profile.user_id === 'dan')).toMatchObject({ games: 2, goals: 1, assists: 2 });
    const session1 = leaderboard({ games, stats, profiles, votes, year: 2026, session: 1 });
    expect(session1.find((r) => r.profile.user_id === 'dan')).toMatchObject({ games: 1, goals: 1, awards: 1 });
  });

  it('gives each player a career line per session, newest first, most games first', () => {
    const careers = careerStats({ games, stats, profiles, votes });
    expect(careers.map((c) => c.profile.user_id)).toEqual(['dan', 'ann', 'new']);
    expect(careers[0].sessions.map((s) => [s.year, s.session, s.games, s.goals])).toEqual([
      [2026, 2, 1, 0],
      [2026, 1, 1, 1],
      [2025, 3, 1, 2],
    ]);
    expect(careers[0].totals).toMatchObject({ games: 3, goals: 3, awards: 1 });
  });
});

// A spreadsheet or CSV as the import dialog receives it.
function xlsxFile(rows) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Schedule');
  const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
  return { arrayBuffer: async () => bytes };
}
const csvFile = (text) => ({ arrayBuffer: async () => new TextEncoder().encode(text).buffer });

describe('importing a league schedule', () => {
  it('reads dot-separated kickoff times without matching the minutes as hours', async () => {
    expect(normalizeTime('7.30 PM')).toBe('19:30');
    expect(normalizeTime('8.10p')).toBe('20:10');
    expect(normalizeTime('7.00pm')).toBe('19:00');
    for (const invalid of ['30 PM', '127:30 PM', '7:60 PM', '13:30 PM', '25:10', '8:99']) {
      expect(normalizeTime(invalid)).toBe('');
    }
    const text = 'Date,Time,Opponent\n11/6,7.30 PM,Net Ninjas\n11/13,8.10p,Goal Diggers\n11/20,7.00pm,Ball Busters';
    expect((await parseScheduleFile(csvFile(text), 2026)).map((game) => game.time)).toEqual(['19:30', '20:10', '19:00']);
  });

  it('reads Excel-style month-name dates and their two-digit years', async () => {
    const games = await parseScheduleFile(csvFile('Date,Time,Opponent\n15-Oct-26,7:00 PM,Net Ninjas\n6-Nov,8:10 PM,Goal Diggers\nJan-8,9:20 PM,Ball Busters'), 2026);
    expect(games.map((game) => game.date)).toEqual(['2026-10-15', '2026-11-06', '2027-01-08']);
    expect(normalizeDate('15-Oct-2026', 2027)).toBe('2026-10-15');
    expect(normalizeDate('Oct-15', 2026)).toBe('2026-10-15');
    // Schedule imports interpret mmm-dd as a day, including the ambiguous Oct-26.
    expect(normalizeDate('Oct-26', 2026)).toBe('2026-10-26');
  });

  it('does not mistake numeric field numbers for dates in a headerless spreadsheet', async () => {
    expect(await parseScheduleFile(xlsxFile([
      [2, new Date(2027, 10, 6), '7:00 PM', 'Ball Busters'],
      [1, '11/13', '8:10 PM', 'Goal Diggers'],
    ]), 2027)).toEqual([
      { date: '2027-11-06', time: '19:00', field_number: '2', opponent: 'Ball Busters' },
      { date: '2027-11-13', time: '20:10', field_number: '1', opponent: 'Goal Diggers' },
    ]);
  });

  it('reads dates and times in the usual formats', () => {
    expect(normalizeDate('2026-10-15')).toBe('2026-10-15');
    expect(normalizeDate('10/15/26')).toBe('2026-10-15');
    expect(normalizeDate('Thu 10/15', 2026)).toBe('2026-10-15');
    expect(normalizeDate('Oct 15', 2026)).toBe('2026-10-15');
    expect(normalizeDate('15 October 2026')).toBe('2026-10-15');
    expect(normalizeDate('Bye week')).toBe('');
    expect(normalizeTime('7:00 PM')).toBe('19:00');
    expect(normalizeTime('8:10p')).toBe('20:10');
    expect(normalizeTime('21:20')).toBe('21:20');
    expect(normalizeTime('TBD')).toBe('');
  });

  it("puts dates without a year in the season's years: November and December first, January to April the next", async () => {
    expect(normalizeDate('Sat 11/7', 2026)).toBe('2026-11-07');
    expect(normalizeDate('Dec 19', 2026)).toBe('2026-12-19');
    expect(normalizeDate('Sat Jan 2', 2026)).toBe('2027-01-02');
    expect(normalizeDate('1/9', 2026)).toBe('2027-01-09');
    expect(normalizeDate('24 April', 2026)).toBe('2027-04-24');
    // A year written in the sheet always wins.
    expect(normalizeDate('Jan 2, 2027', 2026)).toBe('2027-01-02');
    expect(normalizeDate('1/2/27', 2026)).toBe('2027-01-02');
    // Session 2 of 2026–27, sent on December 29 without years.
    const games = await parseScheduleFile(
      csvFile(['Date,Time,Field,Opponent', 'Sat Jan 2,7:00 PM,2,Ball Busters', 'Sat Jan 9,8:10 PM,1,Goal Diggers'].join('\n')),
      2026,
    );
    expect(games.map((g) => g.date)).toEqual(['2027-01-02', '2027-01-09']);
  });

  it("gives month/day dates in a .csv the season's years, not 2001", async () => {
    expect(await parseScheduleFile(csvFile('Date,Time,Opponent\n10/15,7:00 PM,Net Ninjas\n'), 2027)).toEqual([
      { date: '2027-10-15', time: '19:00', field_number: '', opponent: 'Net Ninjas' },
    ]);
    // A whole 2027–28 season written as month/day, with other separators too.
    const season = ['11/6', '11/20', '12/4', '12/18', '1/8', '1/22', '2/5', '2-19', '3/4', '3.18', '4/1', '4/15'];
    const games = await parseScheduleFile(
      csvFile(['Date,Time,Opponent', ...season.map((date, i) => `${date},7:00:00 PM,Team ${i + 1}`)].join('\n')),
      2027,
    );
    expect(games.map((g) => g.date)).toEqual([
      '2027-11-06', '2027-11-20', '2027-12-04', '2027-12-18',
      '2028-01-08', '2028-01-22', '2028-02-05', '2028-02-19',
      '2028-03-04', '2028-03-18', '2028-04-01', '2028-04-15',
    ]);
    expect(new Set(games.map((g) => g.time))).toEqual(new Set(['19:00']));
    // Without headers too, and a field number in front isn't taken for a date.
    expect(await parseScheduleFile(csvFile('2,1/8,7:00 PM,Ball Busters\n'), 2027)).toEqual([
      { date: '2028-01-08', time: '19:00', field_number: '2', opponent: 'Ball Busters' },
    ]);
    // A year written in the file still wins.
    const dated = await parseScheduleFile(
      csvFile('Date,Time,Opponent\n1/8/2028,7:00 PM,Net Ninjas\n10/15/26,7:00 PM,Goal Diggers\n2026-12-04 20:10,,FC Lightning\n'),
      2027,
    );
    expect(dated.map((g) => [g.date, g.time])).toEqual([
      ['2028-01-08', '19:00'],
      ['2026-10-15', '19:00'],
      ['2026-12-04', '20:10'],
    ]);
  });

  it("keeps a spreadsheet's date cells as they are, and gives month/day text the season's years", async () => {
    const games = await parseScheduleFile(
      xlsxFile([
        ['Date', 'Time', 'Opponent'],
        [new Date(2026, 9, 15), '7:00 PM', 'Net Ninjas'],
        [new Date(2028, 0, 8, 20, 10), '', 'Goal Diggers'],
        ['11/6', '8:10 PM', 'Ball Busters'],
        ['1/22', '9:20 PM', 'FC Lightning'],
      ]),
      2027,
    );
    expect(games.map((g) => [g.date, g.time])).toEqual([
      ['2026-10-15', '19:00'],
      ['2028-01-08', '20:10'],
      ['2027-11-06', '20:10'],
      ['2028-01-22', '21:20'],
    ]);
  });

  it('finds the date, time, field and opponent columns by name in a spreadsheet', async () => {
    const games = await parseScheduleFile(
      xlsxFile([
        ['North Coast Coed Fall League'],
        [],
        ['Game Date', 'Start', 'Court', 'Opponent'],
        ['10/15/2026', '7:00 PM', '2', 'vs Ball Busters'],
        ['10/22/2026', '8:10 PM', '1', '@ Goal Diggers'],
        ['Bye week', '', '', ''],
      ]),
      2026,
    );
    expect(games).toEqual([
      { date: '2026-10-15', time: '19:00', field_number: '2', opponent: 'Ball Busters' },
      { date: '2026-10-22', time: '20:10', field_number: '1', opponent: 'Goal Diggers' },
    ]);
  });

  it('keeps only Jive Turkeys games in a league sheet with Home and Away, with the other team as the opponent', async () => {
    const games = await parseScheduleFile(
      csvFile(
        [
          'Date,Time,Field,Home,Away',
          '2026-10-15,7:00 PM,2,Jive Turkeys,Ball Busters',
          '2026-10-15,8:10 PM,1,Net Ninjas,Goal Diggers',
          '2026-10-22,9:20 PM,3,FC Lightning,JIVE TURKEYS',
        ].join('\n'),
      ),
      2026,
    );
    expect(games).toEqual([
      { date: '2026-10-15', time: '19:00', field_number: '2', opponent: 'Ball Busters' },
      { date: '2026-10-22', time: '21:20', field_number: '3', opponent: 'FC Lightning' },
    ]);
  });

  it("keeps every game when our name isn't in the sheet (it's probably just our schedule)", async () => {
    const games = await parseScheduleFile(csvFile('Date,Home,Away\n2026-10-15,Net Ninjas,Goal Diggers\n'), 2026);
    expect(games).toEqual([{ date: '2026-10-15', time: '', field_number: '', opponent: 'Net Ninjas vs Goal Diggers' }]);
  });

  it('guesses from what the cells look like when there are no headers', async () => {
    const games = await parseScheduleFile(csvFile('Thu Oct 15,7:00 PM,2,Jive Turkeys,Ball Busters\n'), 2026);
    expect(games).toEqual([{ date: '2026-10-15', time: '19:00', field_number: '2', opponent: 'Ball Busters' }]);
  });
});
