// Dues math and pay links (src/lib/dues.js). The database's my_dues() splits
// the same way; supabase/tests/dues.test.sql checks it with the same numbers.
import { describe, expect, it } from 'vitest';
import {
  DUES_DEFAULTS,
  currentSession,
  dollars,
  feeParts,
  feeSentence,
  feeTotal,
  payOptions,
  reminderText,
  splitDues,
} from '@/lib/dues';

describe('the session fee', () => {
  it('is the league fee plus the ref fee for every game: $595 + 7 × $18 = $721', () => {
    expect(DUES_DEFAULTS).toEqual({ league_fee: 595, ref_fee: 18, game_count: 7 });
    expect(feeTotal(DUES_DEFAULTS)).toBe(721);
    expect(feeTotal({ league_fee: '600.10', ref_fee: '17.5', game_count: '7' })).toBe(722.6);
  });

  it('reads older saved fees that only have a total', () => {
    expect(feeParts({ total_fee: 1200, league_fee: null })).toEqual({ league_fee: 1200, ref_fee: 0, game_count: 7 });
    expect(feeTotal(feeParts({ total_fee: 1200, league_fee: null }))).toBe(1200);
    expect(feeParts({ total_fee: 721, league_fee: 595, ref_fee: 18, game_count: 7 })).toEqual(DUES_DEFAULTS);
  });

  it('describes itself in plain words', () => {
    expect(feeSentence(DUES_DEFAULTS)).toBe('the $595 league fee plus $18 refs × 7 games = $721');
    expect(feeSentence({ league_fee: 1200, ref_fee: 0, game_count: 7 })).toBe('the $1200 session fee');
  });

  it('shows whole dollars without cents', () => {
    expect(dollars(73)).toBe('$73');
    expect(dollars(40.5)).toBe('$40.50');
    expect(dollars(null)).toBe('$0');
  });
});

describe('splitting the fee', () => {
  it('splits evenly across active players, rounded up', () => {
    const split = splitDues(721, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], []);
    expect(split.perPlayer).toBe(73);
    expect(split.owed).toBe(730);
    expect(split.extra).toBe(9);
    expect(split.paidCount).toBe(0);
  });

  it('takes custom amounts out first (same numbers as the database test)', () => {
    const payments = [
      { user_id: 'dex', override_amount: '40.00', paid: false },
      { user_id: 'dot', override_amount: null, paid: true, paid_date: '2026-10-03' },
    ];
    const split = splitDues(721, ['kim', 'dana', 'dex', 'dot'], payments);
    expect(split.perPlayer).toBe(227);
    expect(split.players).toEqual([
      { user_id: 'kim', amount: 227, custom: false, paid: false, paid_date: null },
      { user_id: 'dana', amount: 227, custom: false, paid: false, paid_date: null },
      { user_id: 'dex', amount: 40, custom: true, paid: false, paid_date: null },
      { user_id: 'dot', amount: 227, custom: false, paid: true, paid_date: '2026-10-03' },
    ]);
    expect(split).toMatchObject({ owed: 721, collected: 227, stillOwed: 494, paidCount: 1, extra: 0 });
  });

  it("doesn't round up a share that comes out even", () => {
    // 100.30 - 0.30 in floating point is 100.00000000000001.
    expect(splitDues(100.3, ['a', 'b'], [{ user_id: 'a', override_amount: 0.3 }]).perPlayer).toBe(100);
  });

  it('ignores payments from players who are no longer active', () => {
    const split = splitDues(100, ['a'], [{ user_id: 'gone', override_amount: 90, paid: true }]);
    expect(split).toMatchObject({ perPlayer: 100, owed: 100, collected: 0 });
  });

  it('shows a shortfall when custom amounts leave part of the fee uncovered', () => {
    const split = splitDues(721, ['a'], [{ user_id: 'a', override_amount: 700 }]);
    expect(split).toMatchObject({ perPlayer: 0, owed: 700, extra: -21 });
  });

  it('copes with no active players', () => {
    expect(splitDues(721, [], [])).toMatchObject({ perPlayer: 0, owed: 0, extra: -721 });
  });
});

describe('pay buttons', () => {
  const note = 'Jive Turkeys dues · Session 2 2026';

  it('fill in the amount for Venmo and Cash App, and show Zelle details to copy', () => {
    const options = payOptions({ pay_venmo: '@Brian-K', pay_cashapp: '$BrianK', pay_zelle: 'brian@example.com' }, 73, note);
    expect(options).toEqual([
      {
        key: 'venmo',
        label: 'Venmo',
        handle: '@Brian-K',
        href: 'https://venmo.com/Brian-K?txn=pay&audience=private&amount=73&note=Jive%20Turkeys%20dues%20%C2%B7%20Session%202%202026',
      },
      { key: 'cashapp', label: 'Cash App', handle: '$BrianK', href: 'https://cash.app/$BrianK/73' },
      { key: 'zelle', label: 'Zelle', handle: 'brian@example.com', href: null },
    ]);
  });

  it('keep cents when the amount has them', () => {
    expect(payOptions({ pay_cashapp: 'BrianK' }, 40.5, note)[0].href).toBe('https://cash.app/$BrianK/40.50');
  });

  it('leave out the ways to pay nobody has set up', () => {
    expect(payOptions({ pay_venmo: '  ', pay_cashapp: null }, 73, note)).toEqual([]);
    expect(payOptions(undefined, 73, note)).toEqual([]);
  });
});

describe('the reminder', () => {
  it('names who still owes, with amounts for anyone not on the even split', () => {
    const text = reminderText({
      session: 2,
      parts: DUES_DEFAULTS,
      perPlayer: 73,
      activeCount: 10,
      unpaid: [
        { name: 'Alex Chen', amount: 73 },
        { name: 'Kelly Moss', amount: 40 },
      ],
      link: 'https://jiveturkeys.app/dues',
    });
    expect(text).toBe(
      [
        '🦃 Jive Turkeys — Session 2 dues: $73 each',
        "That's the $595 league fee plus $18 refs × 7 games = $721, split across 10 players.",
        'Still to pay: Alex Chen, Kelly Moss ($40)',
        'See your amount and pay: https://jiveturkeys.app/dues',
      ].join('\n'),
    );
  });
});

describe('which session the captains see first', () => {
  const games = [
    { date: '2026-09-01', season_year: 2026, session: 1 },
    { date: '2026-10-15', season_year: 2026, session: 2 },
    { date: '2026-10-22', season_year: 2026, session: 2 },
  ];

  it("is the next game's", () => {
    expect(currentSession(games, '2026-10-10')).toEqual({ year: 2026, session: 2 });
    expect(currentSession(games, '2026-08-01')).toEqual({ year: 2026, session: 1 });
  });

  it("is the latest game's once the schedule is over, or this year's first without games", () => {
    expect(currentSession(games, '2026-12-01')).toEqual({ year: 2026, session: 2 });
    expect(currentSession([], '2027-01-05')).toEqual({ year: 2027, session: 1 });
  });
});
