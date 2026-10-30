// Dues math and pay links (src/lib/dues.js). supabase/tests/dues.test.sql uses
// the same numbers for what the database records. Expected behavior: docs/dues.md.
import { describe, expect, it } from 'vitest';
import {
  DUES_DEFAULTS,
  changeLine,
  cleanPayHandle,
  duesMembers,
  currentSession,
  dollars,
  duesEvents,
  feeParts,
  feeProblem,
  feeSentence,
  feeTotal,
  feeWarning,
  notPlayingLabel,
  openSession,
  partPayment,
  payNote,
  payOptions,
  profileAsPlayer,
  reminderText,
  shareChanges,
  shareWhenPaid,
  splitDues,
  splitPayment,
  stepSession,
  teamDues,
} from '@/lib/dues';
import { membersForSession, sessionForNewGames } from '@/lib/roster';

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

  it('needs every box filled in, nothing below $0, and whole games before it saves', () => {
    const fee = (league_fee, ref_fee, game_count) => feeProblem({ league_fee, ref_fee, game_count });
    expect(fee('595', '18', '7')).toBeNull();
    expect(fee('0', '0', '0')).toBeNull();
    expect(fee('', '18', '7')).toBe('Enter the league fee.');
    expect(fee('595', ' ', '7')).toBe('Enter the ref fee per game (0 if there is none).');
    expect(fee('595', '18', '')).toBe('Enter the number of games.');
    expect(fee('-5', '18', '7')).toBe("A fee can't be below $0.");
    expect(fee('595', '-1', '7')).toBe("A fee can't be below $0.");
    expect(fee('595', '18', '6.5')).toBe('Games is a whole number.');
    expect(fee('abc', '18', '7')).toBe('Use numbers only.');
  });

  it('asks first about a $0 fee, or one more than double the fee before it', () => {
    expect(feeWarning(0, 721)).toBe('zero');
    expect(feeWarning(0, null)).toBe('zero');
    expect(feeWarning(7210, 721)).toBe('big');
    expect(feeWarning(1442, 721)).toBeNull();
    expect(feeWarning(1442.01, 721)).toBe('big');
    expect(feeWarning(735, 721)).toBeNull();
    expect(feeWarning(721, null)).toBeNull();
    expect(feeWarning(721, 0)).toBeNull();
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

describe('paid part, or paid it all and the share went up', () => {
  // $721 across twelve is $61 each. Payments are marked at 7pm on Oct 3; changes come after.
  const twelve = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];
  const profiles = twelve.map((id) => ({ user_id: id, display_name: id, status: 'active' }));
  const paidAt = (user_id, paid_amount, extra = {}) => ({ user_id, paid: true, paid_date: '2026-10-03', paid_amount, override_amount: null, ...extra });
  const marked = (...ids) => ids.map((user_id) => ({ user_id, paid: true, created_date: '2026-10-03T19:00:00Z' }));
  const fee = (total_fee) => ({ league_fee: total_fee, ref_fee: 0, game_count: 7, total_fee });
  const later = (kind, old_value, new_value, user_id = null) => ({ kind, user_id, old_value, new_value, created_date: '2026-10-05T18:00:00Z' });

  it('a share that went up after they paid it all is a top-up; less than the share then is a part payment', () => {
    const team = teamDues(735, profiles, [paidAt('a', 61), paidAt('b', 30), paidAt('c', 62)], profiles, {
      history: marked('a', 'b', 'c'),
      changes: [later('fee', fee(721), fee(735))],
    });
    expect(['a', 'b', 'c', 'd'].map(team.stateOf)).toEqual(['topUp', 'part', 'paid', 'unpaid']);
    // Two paid, one of them owing a top-up; the part payment doesn't count as paid.
    expect(team).toMatchObject({ paidCount: 2, topUpCount: 1, stillOwed: 62 * 9 + 1 + 32 });
  });

  it('a part payment with nothing changed since is a part payment', () => {
    const team = teamDues(721, profiles, [paidAt('a', 30)], profiles, { history: marked('a') });
    expect(team.stateOf('a')).toBe('part');
    expect(team).toMatchObject({ paidCount: 0, topUpCount: 0 });
  });

  it('someone coming off the roster after they paid makes it a top-up', () => {
    const roster = profiles.map((p) => (p.user_id === 'l' ? { ...p, status: 'on_break' } : p));
    const team = teamDues(721, roster, [paidAt('a', 61)], roster, {
      history: marked('a'),
      changes: [later('roster', { status: 'active' }, { status: 'on_break' }, 'l')],
    });
    expect(team.shareOf('a')).toMatchObject({ amount: 66, shortBy: 5 });
    expect(team.stateOf('a')).toBe('topUp');
  });

  it('a custom amount raised after they paid makes it a top-up', () => {
    const team = teamDues(721, profiles, [paidAt('a', 61, { override_amount: 80 })], profiles, {
      history: marked('a'),
      changes: [later('custom_amount', null, { amount: 80 }, 'a')],
    });
    expect(team.shareOf('a')).toMatchObject({ amount: 80, shortBy: 19 });
    expect(team.stateOf('a')).toBe('topUp');
  });

  it("counts as a top-up when the share then can't be told", () => {
    // No record of when they paid.
    expect(teamDues(735, profiles, [paidAt('a', 30)], profiles).stateOf('a')).toBe('topUp');
    // The fee was first set after they paid.
    const team = teamDues(721, profiles, [paidAt('a', 30)], profiles, { history: marked('a'), changes: [later('fee', null, fee(721))] });
    expect(team.stateOf('a')).toBe('topUp');
  });

  it('works out the share then by undoing the changes since, newest first', () => {
    const base = { total: 735, activeIds: twelve.slice(0, 11), payments: [], paidAt: '2026-10-03T19:00:00Z', userId: 'a' };
    // Since they paid: l came off ($721 / 11 = $66), then the fee went up to $735 ($67).
    const changes = [
      { ...later('roster', { status: 'active' }, { status: 'on_break' }, 'l'), created_date: '2026-10-04T18:00:00Z' },
      later('fee', fee(721), fee(735)),
    ];
    expect(shareWhenPaid({ ...base, changes })).toBe(61);
    // Changes before they paid don't count.
    expect(shareWhenPaid({ ...base, changes, paidAt: '2026-10-06T00:00:00Z' })).toBe(67);
    // Someone who wasn't playing when they paid.
    const joined = [later('roster', null, { status: 'active' }, 'a')];
    expect(shareWhenPaid({ ...base, changes: joined })).toBeNull();
  });
});

describe('changes that move the split', () => {
  const names = { kim: 'Kim Captain', dana: 'Dana Wells', sam: 'Sam Okafor' };
  const nameOf = (id) => names[id] || '';
  const fee = (league_fee, ref_fee, game_count = 7) => ({ league_fee, ref_fee, game_count, total_fee: league_fee + ref_fee * game_count });
  const line = (change, me = 'sam') => changeLine({ changed_by: 'kim', user_id: null, ...change }, nameOf, me);

  it('say what the session fee was and is, and which part changed', () => {
    expect(line({ kind: 'fee', old_value: null, new_value: fee(595, 18) })).toBe('Kim C. set the session fee: $721');
    expect(line({ kind: 'fee', old_value: fee(595, 18), new_value: fee(595, 20) })).toBe('Kim C. changed the session fee: $721 → $735 (refs $18 → $20)');
    expect(line({ kind: 'fee', old_value: fee(595, 18), new_value: fee(650, 18, 8) }, 'kim')).toBe(
      'You changed the session fee: $721 → $794 (league $595 → $650, 7 → 8 games)',
    );
    // Fees saved before the breakdown existed only have a total.
    expect(line({ kind: 'fee', old_value: { total_fee: 1150, league_fee: null }, new_value: { total_fee: 1200, league_fee: null } })).toBe(
      'Kim C. changed the session fee: $1150 → $1200 (league $1150 → $1200)',
    );
  });

  it('say whose custom amount changed and how', () => {
    expect(line({ kind: 'custom_amount', user_id: 'dana', old_value: null, new_value: { amount: 40 } })).toBe('Kim C. gave Dana W. a custom amount of $40');
    expect(line({ kind: 'custom_amount', user_id: 'dana', old_value: { amount: 40 }, new_value: { amount: 45 } })).toBe(
      "Kim C. changed Dana W.'s custom amount: $40 → $45",
    );
    expect(line({ kind: 'custom_amount', user_id: 'sam', old_value: { amount: 40 }, new_value: { amount: 45 } })).toBe(
      'Kim C. changed your custom amount: $40 → $45',
    );
    expect(line({ kind: 'custom_amount', user_id: 'dana', old_value: { amount: 40 }, new_value: null })).toBe('Kim C. put Dana W. back on the even split');
    expect(line({ kind: 'custom_amount', user_id: 'kim', old_value: null, new_value: { amount: 0 } }, 'kim')).toBe('You gave yourself a custom amount of $0');
  });

  it('say who came onto or off the roster, and who did it when it was someone else', () => {
    const roster = (user_id, status, changed_by = user_id) => ({ kind: 'roster', user_id, changed_by, old_value: null, new_value: { status } });
    expect(line(roster('dana', 'on_break'))).toBe('Dana W. is unavailable');
    expect(line(roster('sam', 'active'))).toBe("You're playing");
    expect(line(roster('dana', 'sub_pool', 'kim'))).toBe('Kim C. marked Dana W. as available to sub');
    expect(line(roster('sam', 'on_break', 'kim'))).toBe('Kim C. marked you as unavailable');
    expect(line(roster('dana', 'active', 'kim'), 'kim')).toBe('You marked Dana W. as playing');
    expect(line(roster('dana', 'off', 'kim'))).toBe('Kim C. took Dana W. off the roster');
    expect(line(roster('dana', 'active', null))).toBe('Dana W. is playing');
  });

  it('go in one list with the paid history, newest first', () => {
    const events = duesEvents(
      [{ id: 'h1', created_date: '2026-10-01T12:00:00Z' }, { id: 'h2', created_date: '2026-10-05T12:00:00Z' }],
      [{ id: 'c1', kind: 'fee', created_date: '2026-10-03T12:00:00Z' }],
    );
    expect(events.map((e) => e.id)).toEqual(['h2', 'c1', 'h1']);
  });

  it('explain a share that changed: what moved it since that player last marked paid', () => {
    const history = [
      { user_id: 'sam', paid: true, created_date: '2026-09-30T19:00:00Z' },
      { user_id: 'dana', paid: true, created_date: '2026-10-06T19:00:00Z' },
    ];
    const changes = [
      { id: 'set', kind: 'fee', user_id: null, created_date: '2026-09-29T18:00:00Z' },
      { id: 'refs', kind: 'fee', user_id: null, created_date: '2026-10-01T18:00:00Z' },
      { id: 'jamie', kind: 'roster', user_id: 'jamie', created_date: '2026-10-05T12:00:00Z' },
      { id: 'kelly', kind: 'custom_amount', user_id: 'kelly', created_date: '2026-10-07T12:00:00Z' },
      { id: 'mine', kind: 'custom_amount', user_id: 'dana', created_date: '2026-10-07T13:00:00Z' },
    ];
    expect(shareChanges(changes, history, 'sam', false).map((c) => c.id)).toEqual(['mine', 'kelly', 'jamie', 'refs']);
    // A custom amount only moves with its own changes.
    expect(shareChanges(changes, history, 'dana', true).map((c) => c.id)).toEqual(['mine']);
    expect(shareChanges(changes, history, 'nobody', false)).toEqual([]);
  });
});

describe('part payments', () => {
  it('split money between people by what each still owes, in cents, never more than they owe', () => {
    const both = [{ user_id: 'a', due: 61 }, { user_id: 'b', due: 61 }];
    expect(splitPayment(80, both)).toEqual([{ user_id: 'a', amount: 40 }, { user_id: 'b', amount: 40 }]);
    expect(splitPayment(81, both)).toEqual([{ user_id: 'a', amount: 40.5 }, { user_id: 'b', amount: 40.5 }]);
    // $61 and $31 owed: $50 splits $33.15 / $16.85, and the cents add up.
    expect(splitPayment(50, [{ user_id: 'a', due: 61 }, { user_id: 'b', due: 31 }])).toEqual([
      { user_id: 'a', amount: 33.15 },
      { user_id: 'b', amount: 16.85 },
    ]);
    expect(splitPayment(200, both)).toEqual([{ user_id: 'a', amount: 61 }, { user_id: 'b', amount: 61 }]);
    expect(splitPayment(25, [{ user_id: 'a', due: 0 }, { user_id: 'b', due: 61 }])).toEqual([{ user_id: 'b', amount: 25 }]);
    expect(splitPayment(25, [])).toEqual([]);
  });

  const paid = (user_id, paid_amount) => ({ user_id, paid: true, paid_amount });
  const profile = (name, extra = {}) => ({ user_id: name, display_name: name, status: 'active', ...extra });

  it("add to what someone already paid, and leave the rest owed like a share that went up", () => {
    const team = teamDues(122, [profile('sam'), profile('kim')], [paid('sam', 30)]);
    expect(team.owingTogether('sam')).toEqual([{ user_id: 'sam', due: 31 }]);
    expect(partPayment(team, 'sam', 20)).toEqual({ userIds: ['sam'], amounts: [50] });
    expect(partPayment(team, 'kim', 40)).toEqual({ userIds: ['kim'], amounts: [40] });

    const after = teamDues(122, [profile('sam'), profile('kim')], [paid('sam', 50), paid('kim', 40)]);
    expect(after.players.map((p) => [p.user_id, p.paid, p.paid_amount, p.shortBy])).toEqual([
      ['kim', true, 40, 21],
      ['sam', true, 50, 11],
    ]);
    // Without the history it can't be told whether they paid part or their share went up: both count as paid.
    expect(after).toMatchObject({ paidCount: 2, collected: 90, stillOwed: 32 });
    expect(after.stillToPay).toEqual([
      { name: 'kim', amount: 21, more: true },
      { name: 'sam', amount: 11, more: true },
    ]);
  });

  it('cover a couple together, split by what each owes', () => {
    const couple = [profile('alex', { pays_with: 'riley' }), profile('riley', { pays_with: 'alex' })];
    const team = teamDues(122, couple, []);
    expect(team.owingTogether('alex')).toEqual([
      { user_id: 'alex', due: 61 },
      { user_id: 'riley', due: 61 },
    ]);
    expect(partPayment(team, 'riley', 80)).toEqual({ userIds: ['riley', 'alex'], amounts: [40, 40] });

    // Alex has paid in full already: it all goes to Riley.
    const one = teamDues(122, couple, [paid('alex', 61)]);
    expect(partPayment(one, 'alex', 30)).toEqual({ userIds: ['riley'], amounts: [30] });
    expect(one.owingTogether('alex').map((p) => p.due)).toEqual([0, 61]);
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
    expect(team.notPlaying.map(notPlayingLabel)).toEqual(['unavailable', 'off the team', 'available to sub']);
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

  it("keep each partner's own share when one has a custom amount", () => {
    const team = teamDues(400, profiles, [{ user_id: 'alex', override_amount: 40 }]);
    expect(team.shareOf('alex').amount).toBe(40);
    expect(team.shareOf('riley').amount).toBe(120);
    expect(team.owingTogether('alex')).toEqual([
      { user_id: 'alex', due: 40 },
      { user_id: 'riley', due: 120 },
    ]);
    expect(partPayment(team, 'alex', 80)).toEqual({ userIds: ['alex', 'riley'], amounts: [20, 60] });
  });

  it('count only when each pays with the other', () => {
    const oneSided = [profile('Alex', { pays_with: 'riley' }), profile('Riley', { pays_with: 'sam' }), profile('Sam')];
    const team = teamDues(300, oneSided, []);
    expect(['alex', 'riley', 'sam'].map((id) => team.partnerOf(id))).toEqual([null, null, null]);
  });

  it('are kept per session: linking in session 2 leaves session 1 as it was', () => {
    // Alex and Riley paid session 1 on their own and pay together from session 2.
    const today = [profile('Alex', { pays_with: 'riley' }), profile('Riley', { pays_with: 'alex' }), profile('Morgan')];
    const entry = (session, user_id, pays_with_user = null) => ({ season_year: 2026, session, user_id, status: 'active', pays_with_user });
    const rows = [
      entry(1, 'alex'),
      entry(1, 'riley'),
      entry(1, 'morgan'),
      entry(2, 'alex', 'riley'),
      entry(2, 'riley', 'alex'),
      entry(2, 'morgan'),
    ];
    const paid = [{ user_id: 'alex', paid: true }, { user_id: 'riley', paid: true }];
    const session1 = teamDues(300, membersForSession(today, rows, { year: 2026, session: 1 }), paid);
    expect(session1.partnerOf('alex')).toBeNull();
    expect(session1.owingTogether('alex')).toEqual([{ user_id: 'alex', due: 0 }]);
    const session2 = teamDues(300, membersForSession(today, rows, { year: 2026, session: 2 }), []);
    expect(session2.partnerOf('alex').display_name).toBe('Riley');
    expect(session2.stillToPay[0]).toEqual({ name: 'Alex & Riley', amount: 200, more: false });
    // A session that hasn't started uses today's couples.
    expect(teamDues(300, membersForSession(today, rows, { year: 2026, session: 3 }), []).partnerOf('riley').display_name).toBe('Alex');
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
    expect(payNote(2026, 2)).toBe('Jive Turkeys dues · Session 2 2026–27');
    expect(payNote(2026, 2, ['Alex Chen', 'Riley Novak'])).toBe('Jive Turkeys dues · Session 2 2026–27 · Alex Chen & Riley Novak');
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
  it('names each person in a couple with nameOf, for @mentions in Team Chat', () => {
    const jordan = { user_id: 'jr', display_name: 'Jordan Rivera' };
    const sam = { user_id: 'so', display_name: 'Sam Okafor' };
    const dana = { user_id: 'dw', display_name: 'Dana Wells', guest: true };
    const text = reminderText({
      session: 2,
      parts: DUES_DEFAULTS,
      perPlayer: 61,
      activeCount: 12,
      unpaid: [
        { name: 'Jordan Rivera & Sam Okafor', people: [jordan, sam], amount: 122 },
        { name: 'Dana Wells', people: [dana], amount: 61 },
      ],
      link: 'https://jiveturkeys.app/dues',
      nameOf: (p) => (p.guest ? p.display_name : `@${p.display_name.split(' ')[0]}`),
    });
    expect(text).toContain('Still to pay: @Jordan & @Sam ($122), Dana Wells');
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

  it("is the latest game's once the schedule is over", () => {
    expect(currentSession(games, '2026-12-01')).toEqual({ year: 2026, session: 2 });
  });

  it('is the session today is in without games, the one Add game suggests (same as roster_current_session())', () => {
    // January to April belong to the season that started the November before, not next season's first.
    expect(currentSession([], '2026-11-10')).toEqual({ year: 2026, session: 1 });
    expect(currentSession([], '2027-01-05')).toEqual({ year: 2026, session: 2 });
    expect(currentSession([], '2027-03-15')).toEqual({ year: 2026, session: 3 });
    expect(currentSession([], '2027-06-01')).toEqual({ year: 2027, session: 1 });
    for (const day of ['2026-11-10', '2027-01-05', '2027-03-15', '2027-06-01']) {
      expect(currentSession([], day)).toEqual(sessionForNewGames([], day, []));
    }
  });

  it('is a later session captains asked about, between sessions (same as roster_current_session())', () => {
    const asks = [{ season_year: 2026, session: 3, starts_on: '2027-01-03' }];
    expect(currentSession(games, '2026-12-01', asks)).toEqual({ year: 2026, session: 3 });
    // A game coming up still decides it.
    expect(currentSession(games, '2026-10-10', asks)).toEqual({ year: 2026, session: 2 });
    // Not once captains stop asking, nor a session that's already been played.
    expect(currentSession(games, '2026-12-01', [{ ...asks[0], starts_on: null }])).toEqual({ year: 2026, session: 2 });
    expect(currentSession(games, '2026-12-01', [{ season_year: 2026, session: 1, starts_on: '2026-09-01' }])).toEqual({
      year: 2026,
      session: 2,
    });
    // The one starting first, if captains asked about two.
    expect(currentSession(games, '2026-12-01', [{ season_year: 2027, session: 1, starts_on: '2027-03-01' }, ...asks])).toEqual({
      year: 2026,
      session: 3,
    });
    // With no games yet at all.
    expect(currentSession([], '2026-12-01', asks)).toEqual({ year: 2026, session: 3 });
  });
});

describe('which session status changes count for', () => {
  const games = [
    { date: '2026-09-01', season_year: 2026, session: 1 },
    { date: '2026-10-15', season_year: 2026, session: 2 },
    { date: '2026-10-22', season_year: 2026, session: 2 },
  ];

  it("is the current session while it has a game to come, the game's day included", () => {
    expect(openSession(games, '2026-10-10')).toEqual({ year: 2026, session: 2 });
    expect(openSession(games, '2026-10-22')).toEqual({ year: 2026, session: 2 });
    expect(openSession(games, '2026-08-01')).toEqual({ year: 2026, session: 1 });
  });

  it("is none once the current session's games are all played and nothing else is on the schedule (same as roster_open_session())", () => {
    // The Dues page still opens on it; it just keeps its list.
    expect(currentSession(games, '2026-10-23')).toEqual({ year: 2026, session: 2 });
    expect(openSession(games, '2026-10-23')).toBeNull();
    expect(openSession(games, '2027-06-01')).toBeNull();
    // Captains asking about the next session: that one, before its schedule is out.
    const asks = [{ season_year: 2026, session: 3, starts_on: '2027-01-03' }];
    expect(openSession(games, '2026-12-01', asks)).toEqual({ year: 2026, session: 3 });
    expect(openSession(games, '2026-12-01', [{ ...asks[0], starts_on: null }])).toBeNull();
    // The next session's first game on the schedule.
    expect(openSession([...games, { date: '2027-01-03', season_year: 2026, session: 3 }], '2026-12-01')).toEqual({ year: 2026, session: 3 });
  });

  it("is this year's first with no games yet: there's nothing to keep", () => {
    expect(openSession([], '2026-10-01')).toEqual({ year: 2026, session: 1 });
  });
});
