// Dues math and pay links (src/lib/dues.js). supabase/tests/dues.test.sql uses
// the same numbers for what the database records.
import { describe, expect, it } from 'vitest';
import {
  DUES_DEFAULTS,
  cleanPayHandle,
  duesMembers,
  currentSession,
  dollars,
  feeParts,
  feeSentence,
  feeTotal,
  notPlayingLabel,
  payNote,
  payOptions,
  profileAsPlayer,
  reminderText,
  splitDues,
  stepSession,
  teamDues,
} from '@/lib/dues';
import { membersForSession } from '@/lib/roster';

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
    const unpaid = { custom: false, paid: false, paid_date: null, paid_amount: null, shortBy: 0 };
    expect(split.players).toEqual([
      { ...unpaid, user_id: 'kim', amount: 227 },
      { ...unpaid, user_id: 'dana', amount: 227 },
      { ...unpaid, user_id: 'dex', amount: 40, custom: true },
      // Marked paid before amounts were recorded: their share counts as what they paid.
      { user_id: 'dot', amount: 227, custom: false, paid: true, paid_date: '2026-10-03', paid_amount: 227, shortBy: 0 },
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

describe('what paid players paid', () => {
  // A $721 session across 12 players is $61 each. The fee went up to $735 ($62 each) after some had paid.
  const twelve = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];
  const paidAt = (user_id, paid_amount) => ({ user_id, paid: true, paid_date: '2026-10-03', paid_amount, override_amount: null });

  it('keeps what they paid when the fee goes up, and counts the difference as still to collect', () => {
    const split = splitDues(735, twelve, [paidAt('a', 61), paidAt('b', '61.00'), paidAt('c', 62)]);
    expect(split.perPlayer).toBe(62);
    expect(split.players.slice(0, 4).map((p) => [p.user_id, p.amount, p.paid_amount, p.shortBy])).toEqual([
      ['a', 62, 61, 1],
      ['b', 62, 61, 1],
      ['c', 62, 62, 0],
      ['d', 62, null, 0],
    ]);
    // Collected is what was paid; still to collect is the 9 unpaid shares plus the two $1 differences.
    expect(split).toMatchObject({ owed: 744, collected: 184, stillOwed: 560, paidCount: 3 });
  });

  it('keeps what they paid when the fee goes down, without counting it against anyone else', () => {
    const split = splitDues(600, twelve, [paidAt('a', 61), paidAt('b', 50)]);
    expect(split.perPlayer).toBe(50);
    expect(split.players.slice(0, 2).map((p) => [p.paid_amount, p.shortBy])).toEqual([
      [61, 0],
      [50, 0],
    ]);
    expect(split).toMatchObject({ owed: 600, collected: 111, stillOwed: 500 });
  });

  it('counts the share for payments from before amounts were recorded', () => {
    const split = splitDues(735, twelve, [paidAt('a', null), { user_id: 'b', paid: true }]);
    expect(split.players.slice(0, 2).map((p) => [p.paid_amount, p.shortBy])).toEqual([
      [62, 0],
      [62, 0],
    ]);
    expect(split).toMatchObject({ collected: 124, stillOwed: 620 });
  });

  it('works in cents', () => {
    const split = splitDues(100, ['a', 'b'], [{ ...paidAt('a', 40.1), override_amount: 40.3 }, paidAt('b', 59.9)]);
    expect(split.players.map((p) => p.shortBy)).toEqual([0.2, 0.1]);
    expect(split).toMatchObject({ collected: 100, stillOwed: 0.3 });
  });

  it('puts the difference in the reminder, a couple together', () => {
    const profile = (name, extra = {}) => ({ user_id: name.toLowerCase(), display_name: name, status: 'active', ...extra });
    const profiles = [profile('Alex', { pays_with: 'riley' }), profile('Riley', { pays_with: 'alex' }), profile('Morgan'), profile('Sam')];
    const team = teamDues(400, profiles, [paidAt('alex', 90), paidAt('riley', 95), paidAt('sam', 100)]);
    expect(team.stillToPay).toEqual([
      { name: 'Alex & Riley', amount: 15, more: true },
      { name: 'Morgan', amount: 100, more: false },
    ]);
    expect(team.balanceOf('alex')).toBe(15);
    expect(team.balanceOf('sam')).toBe(0);
    expect(team.stillOwed).toBe(115);

    // One partner paid in full, the other hasn't paid: that's still one line, for the unpaid share.
    const mixed = teamDues(400, profiles, [paidAt('alex', 100), paidAt('sam', 100), paidAt('morgan', 100)]);
    expect(mixed.stillToPay).toEqual([{ name: 'Riley', amount: 100, more: false }]);
  });
});

describe('players who paid and are not playing', () => {
  const people = [
    { user_id: 'kim', display_name: 'Kim', status: 'active' },
    { user_id: 'sam', display_name: 'Sam', status: 'active' },
    { user_id: 'jo', display_name: 'Jo', status: 'on_break' },
    { user_id: 'pat', display_name: 'Pat', status: 'sub_pool' },
  ];
  // Off the session's list, so not among the session's players at all.
  const everyone = [
    ...people,
    { user_id: 'lee', display_name: 'Lee', status: 'inactive', removed: true },
    { user_id: 'g1', display_name: 'Rosa (roster name)', status: 'inactive', guest: true, linked_user_id: 'kim' },
    { user_id: 'max', display_name: 'Max', status: 'active' },
  ];
  const payments = [
    { user_id: 'kim', paid: true, paid_amount: 50, paid_date: '2026-10-01' },
    { user_id: 'jo', paid: true, paid_amount: 50, paid_date: '2026-10-02' },
    { user_id: 'pat', paid: true, paid_amount: null, paid_date: '2026-10-03' },
    { user_id: 'pat', paid: false },
    { user_id: 'lee', paid: true, paid_amount: 45.5, paid_date: '2026-10-04' },
    // A roster name's payment that moved to Kim's account when she picked it: a repeat.
    { user_id: 'g1', paid: true, paid_amount: 50, paid_date: '2026-10-01' },
    { user_id: 'max', paid: false, override_amount: 10 },
  ];

  it('are listed with what they paid, and it counts in Collected', () => {
    const team = teamDues(100, people, payments, everyone);
    expect(team.active.map((p) => p.user_id)).toEqual(['kim', 'sam']);
    expect(team.notPlaying.map((p) => [p.player.display_name, p.status, p.paid_amount, p.paid_date])).toEqual([
      ['Jo', 'on_break', 50, '2026-10-02'],
      ['Lee', 'off', 45.5, '2026-10-04'],
      ['Pat', 'sub_pool', null, '2026-10-03'],
    ]);
    expect(team.notPlaying.map(notPlayingLabel)).toEqual(['sitting out', 'off the team', 'sub pool']);
    // Kim's $50, plus Jo's $50 and Lee's $45.50. Pat's amount wasn't recorded.
    expect(team).toMatchObject({ collected: 145.5, notPlayingPaid: 95.5, stillOwed: 50, paidCount: 1 });
    expect(team.notPlayingOf('jo').paid_amount).toBe(50);
    expect(team.notPlayingOf('kim')).toBeNull();
    expect(notPlayingLabel({ status: 'off', player: { removed: false } })).toBe('not on the roster');
  });

  it('are found among the session players alone when that is all there is', () => {
    expect(teamDues(100, people, payments).notPlaying.map((p) => p.user_id)).toEqual(['jo', 'pat']);
  });
});

// The same people and numbers as supabase/tests/dues_shares.test.sql: the database works out the share it records for
// payments marked before amounts were kept (and from a site that hasn't reloaded) with dues_shares().
describe('the database splits the same way', () => {
  const profile = (user_id, status = 'active', removed = false) => ({ user_id, display_name: user_id, status, removed });
  const guest = (id, extra = {}) => ({ id, display_name: id, status: 'active', removed: false, linked_user_id: null, ...extra });
  const pay = (session, id, extra = {}) => ({ season_year: 2026, session, user_id: id, guest_id: null, ...extra });
  const { members, payments } = duesMembers({
    profiles: [profile('ann'), profile('bo'), profile('cy'), profile('di', 'sub_pool'), profile('ed', 'active', true)].map(profileAsPlayer),
    guests: [guest('gina'), guest('gus', { linked_user_id: 'bo' }), guest('gail', { removed: true })],
    payments: [pay(2, 'cy', { override_amount: 40 }), pay(5, 'ann', { override_amount: 60 }), pay(6, 'ann', { override_amount: 0.3 })],
    history: [],
  });
  const entry = (session, id, status) => ({ season_year: 2026, session, user_id: id, guest_id: null, status });
  const roster = [
    ...[['ann', 'active'], ['bo', 'on_break'], ['cy', 'active'], ['di', 'active'], ['ed', 'active']].map(([id, status]) => entry(3, id, status)),
    { ...entry(3, null, 'off'), guest_id: 'gina' },
    { ...entry(3, null, 'active'), guest_id: 'gus' },
  ];
  const shares = (session, total) => {
    const team = teamDues(total, membersForSession(members, roster, { year: 2026, session }), payments.filter((p) => p.session === session));
    return Object.fromEntries(team.active.map((p) => [p.user_id, team.shareOf(p.user_id).amount]));
  };

  it('with today\'s statuses, a list of its own, custom amounts over the fee, and cents', () => {
    expect(shares(2, 721)).toEqual({ ann: 227, bo: 227, cy: 40, gina: 227 });
    expect(shares(3, 100)).toEqual({ ann: 25, cy: 25, di: 25, ed: 25 });
    expect(shares(5, 50)).toEqual({ ann: 60, bo: 0, cy: 0, gina: 0 });
    expect(shares(6, 100.3)).toEqual({ ann: 0.3, bo: 34, cy: 34, gina: 34 });
  });
});

describe('couples who pay together', () => {
  const profile = (name, extra = {}) => ({ user_id: name.toLowerCase(), display_name: name, status: 'active', ...extra });
  const profiles = [
    profile('Casey', { pays_with: 'zed' }),
    profile('Alex', { pays_with: 'riley' }),
    profile('Riley', { pays_with: 'alex' }),
    profile('Morgan'),
    profile('Zed', { status: 'sub_pool', pays_with: 'casey' }),
  ];

  it('list side by side, and only count while both are active', () => {
    const team = teamDues(400, profiles, []);
    expect(team.active.map((p) => p.display_name)).toEqual(['Alex', 'Riley', 'Casey', 'Morgan']);
    expect(team.partnerOf('alex').display_name).toBe('Riley');
    expect(team.partnerOf('casey')).toBeNull();
    expect(team.perPlayer).toBe(100);
  });

  it('show up in the reminder as one line with one amount while both still owe', () => {
    expect(teamDues(400, profiles, []).stillToPay).toEqual([
      { name: 'Alex & Riley', amount: 200, more: false },
      { name: 'Casey', amount: 100, more: false },
      { name: 'Morgan', amount: 100, more: false },
    ]);
    const oneMarked = teamDues(400, profiles, [{ user_id: 'riley', paid: true }]);
    expect(oneMarked.stillToPay.map((p) => p.name)).toEqual(['Alex', 'Casey', 'Morgan']);
  });
});

describe('teammates who are not on the app', () => {
  it('join the app players as one list, keyed like everyone else, off the roster once removed or linked', () => {
    const { members, payments, history } = duesMembers({
      profiles: [
        { user_id: 'u1', display_name: 'Kelly', status: 'active', pays_with: null, pays_with_guest: 'g1' },
        { user_id: 'u2', display_name: 'Sam', status: 'active', pays_with: null },
      ],
      guests: [
        { id: 'g1', display_name: 'Mike', status: 'active', removed: false, pays_with_user: 'u1', pays_with_guest: null, linked_user_id: null },
        { id: 'g2', display_name: 'Gone', status: 'active', removed: true, linked_user_id: null },
        { id: 'g3', display_name: 'Joined', status: 'active', removed: false, linked_user_id: 'u2' },
        { id: 'g4', display_name: 'Resting', status: 'on_break', removed: false, linked_user_id: null },
      ],
      payments: [{ id: 'p1', user_id: null, guest_id: 'g1', paid: true }, { id: 'p2', user_id: 'u2', guest_id: null, paid: false }],
      history: [{ id: 'h1', user_id: null, guest_id: 'g1', paid: true }],
    });
    expect(members.map((m) => [m.user_id, m.status, m.pays_with, !!m.guest])).toEqual([
      ['u1', 'active', 'g1', false],
      ['u2', 'active', null, false],
      ['g1', 'active', 'u1', true],
      ['g2', 'inactive', null, true],
      ['g3', 'inactive', null, true],
      ['g4', 'on_break', null, true],
    ]);
    expect(payments.map((p) => p.user_id)).toEqual(['g1', 'u2']);
    expect(history[0].user_id).toBe('g1');
  });

  it('count in the split and pay together with an app player', () => {
    const { members, payments } = duesMembers({
      profiles: [{ user_id: 'u1', display_name: 'Kelly', status: 'active', pays_with_guest: 'g1' }],
      guests: [{ id: 'g1', display_name: 'Mike', status: 'active', pays_with_user: 'u1' }],
      payments: [],
      history: [],
    });
    const team = teamDues(100, members, payments);
    expect(team.perPlayer).toBe(50);
    expect(team.partnerOf('u1').display_name).toBe('Mike');
    expect(team.stillToPay).toEqual([{ name: 'Kelly & Mike', amount: 100, more: false }]);
  });
});

describe('pay buttons', () => {
  it("carry a note saying who it's for", () => {
    expect(payNote(2026, 2)).toBe('Jive Turkeys dues · Session 2 2026');
    expect(payNote(2026, 2, ['Alex Chen', 'Riley Novak'])).toBe('Jive Turkeys dues · Session 2 2026 · Alex Chen & Riley Novak');
  });

  const note = 'Jive Turkeys dues · Session 2 2026';

  it('fill in the amount for Venmo, PayPal.Me and Cash App, and show Zelle details to copy', () => {
    const options = payOptions(
      { pay_venmo: '@B-Kircher', pay_paypal: 'BKircher', pay_cashapp: '$BrianK', pay_zelle: 'brian@example.com' },
      73,
      note,
    );
    expect(options).toEqual([
      {
        key: 'venmo',
        label: 'Venmo',
        handle: '@B-Kircher',
        href: 'https://venmo.com/B-Kircher?txn=pay&audience=private&amount=73&note=Jive%20Turkeys%20dues%20%C2%B7%20Session%202%202026',
        prefilled: true,
      },
      { key: 'paypal', label: 'PayPal', handle: 'paypal.me/BKircher', href: 'https://paypal.me/BKircher/73', prefilled: true },
      { key: 'cashapp', label: 'Cash App', handle: '$BrianK', href: 'https://cash.app/$BrianK/73', prefilled: true },
      { key: 'zelle', label: 'Zelle', handle: 'brian@example.com', href: null, prefilled: false },
    ]);
  });

  it('open any other PayPal link (like a PayPal QR code) as it is; the player types the amount', () => {
    const qr = 'https://www.paypal.com/qrcodes/p2pqrc/WWQM2FMVLDVBQ';
    expect(payOptions({ pay_paypal: qr }, 73, note)).toEqual([
      { key: 'paypal', label: 'PayPal', handle: 'PayPal', href: qr, prefilled: false },
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

describe('pasted payment links', () => {
  it('keep just the Venmo name from a profile link or @handle', () => {
    for (const typed of ['https://venmo.com/u/B-Kircher', 'venmo.com/B-Kircher', '@B-Kircher', ' B-Kircher ', 'https://account.venmo.com/u/B-Kircher?x=1']) {
      expect(cleanPayHandle('venmo', typed)).toBe('B-Kircher');
    }
  });

  it('keep a PayPal.Me name, or any other PayPal link whole', () => {
    expect(cleanPayHandle('paypal', 'https://paypal.me/BKircher')).toBe('BKircher');
    expect(cleanPayHandle('paypal', 'https://www.paypal.com/paypalme/BKircher/10')).toBe('BKircher');
    expect(cleanPayHandle('paypal', '@BKircher')).toBe('BKircher');
    expect(cleanPayHandle('paypal', 'https://www.paypal.com/qrcodes/p2pqrc/WWQM2FMVLDVBQ')).toBe(
      'https://www.paypal.com/qrcodes/p2pqrc/WWQM2FMVLDVBQ',
    );
    expect(cleanPayHandle('paypal', 'www.paypal.com/qrcodes/p2pqrc/WWQM2FMVLDVBQ')).toBe(
      'https://www.paypal.com/qrcodes/p2pqrc/WWQM2FMVLDVBQ',
    );
  });

  it('keep just the Cash App $cashtag name', () => {
    expect(cleanPayHandle('cashapp', 'https://cash.app/$BrianK')).toBe('BrianK');
    expect(cleanPayHandle('cashapp', '$BrianK')).toBe('BrianK');
    expect(cleanPayHandle('venmo', '')).toBe('');
  });
});

describe('the reminder', () => {
  it('names who still owes, with amounts for anyone not on the even split or paying a difference', () => {
    const text = reminderText({
      session: 2,
      parts: DUES_DEFAULTS,
      perPlayer: 73,
      activeCount: 10,
      unpaid: [
        { name: 'Alex Chen', amount: 73 },
        { name: 'Kelly Moss', amount: 40 },
        { name: 'Sam Okafor', amount: 11, more: true },
      ],
      link: 'https://jiveturkeys.app/dues',
    });
    expect(text).toBe(
      [
        '🦃 Jive Turkeys — Session 2 dues: $73 each',
        "That's the $595 league fee plus $18 refs × 7 games = $721, split across 10 players.",
        'Still to pay: Alex Chen, Kelly Moss ($40), Sam Okafor ($11 more)',
        'See your amount and pay: https://jiveturkeys.app/dues',
      ].join('\n'),
    );
  });
});

describe('stepping between sessions', () => {
  it('goes 1, 2, 3 and on into the next year, and back', () => {
    expect(stepSession({ year: 2026, session: 2 }, 1)).toEqual({ year: 2026, session: 3 });
    expect(stepSession({ year: 2026, session: 3 }, 1)).toEqual({ year: 2027, session: 1 });
    expect(stepSession({ year: 2026, session: 1 }, -1)).toEqual({ year: 2025, session: 3 });
    expect(stepSession({ year: '2026', session: '2' }, -1)).toEqual({ year: 2026, session: 1 });
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
