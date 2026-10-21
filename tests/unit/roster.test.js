// Who's on the team each session: each session keeps its own list, so a status
// change in one session never rewrites another's dues. The database's rules are
// tested in supabase/tests/roster.test.sql; these check the shared logic and
// the demo backend (previews), which must behave the same way.
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_LOGIN, createDemoBackend } from '@/api/demo';
import { sessionSlice } from '@/hooks/useDues';
import { duesMembers, guestAsPlayer, teamDues } from '@/lib/dues';
import { sessionAsk } from '@/components/SessionPrompt';
import { seasonLabel, seasonName, seasonOf } from '@/lib/format';
import {
  askFor,
  beforeFirstGame,
  entryFor,
  isEarlier,
  membersForSession,
  sessionForNewGames,
  stillAsking,
  unanswered,
} from '@/lib/roster';

const S1 = { year: 2026, session: 1 };
const S2 = { year: 2026, session: 2 };
const entry = (period, who, status, answered = true) => ({
  season_year: period.year,
  session: period.session,
  user_id: who.user_id ?? null,
  guest_id: who.guest_id ?? null,
  status,
  answered_at: answered ? '2026-10-01T18:00:00Z' : null,
});

describe('the team in one session', () => {
  const ana = { user_id: 'ana', display_name: 'Ana', status: 'on_break' };
  const ben = { user_id: 'ben', display_name: 'Ben', status: 'active' };
  const gus = guestAsPlayer({ id: 'gus', display_name: 'Gus', status: 'active', removed: true });
  const val = guestAsPlayer({ id: 'val', display_name: 'Val', status: 'active', linked_user_id: 'ben' });
  const rows = [
    entry(S1, { user_id: 'ana' }, 'active'),
    entry(S1, { guest_id: 'gus' }, 'active'),
    entry(S1, { guest_id: 'val' }, 'active'),
    entry(S2, { user_id: 'ana' }, 'on_break', false),
    entry(S2, { user_id: 'ben' }, 'active'),
    entry(S2, { guest_id: 'gus' }, 'off'),
  ];

  it("uses each player's status for that session, and leaves out anyone who wasn't on it", () => {
    const one = membersForSession([ana, ben, gus], rows, S1);
    expect(one.map((m) => [m.display_name, m.status])).toEqual([
      ['Ana', 'active'],
      // Taken off the roster later, but on the team in session 1.
      ['Gus', 'active'],
    ]);
    expect(membersForSession([ana, ben, gus], rows, S2).map((m) => [m.display_name, m.status])).toEqual([
      ['Ana', 'on_break'],
      ['Ben', 'active'],
    ]);
  });

  it("leaves out a roster name that has joined (their account's entry counts)", () => {
    expect(membersForSession([ana, val], rows, S1).map((m) => m.display_name)).toEqual(['Ana']);
  });

  it("uses today's statuses for a session without a list yet, or before lists exist", () => {
    expect(membersForSession([ana, ben], rows, { year: 2026, session: 3 })).toEqual([ana, ben]);
    expect(membersForSession([ana, ben], null, S1)).toEqual([ana, ben]);
  });

  it('finds entries and who is still to answer', () => {
    expect(entryFor(rows, S2, 'ana')).toMatchObject({ status: 'on_break', answered_at: null });
    expect(entryFor(rows, S2, 'nobody')).toBeNull();
    expect(unanswered(rows, S2).map((r) => r.user_id)).toEqual(['ana']);
  });

  it('asks "Playing session N?" only until its first game', () => {
    const games = [
      { season_year: 2026, session: 2, date: '2026-10-15' },
      { season_year: 2026, session: 2, date: '2026-10-22' },
    ];
    expect(beforeFirstGame(games, S2, '2026-10-14')).toBe(true);
    expect(beforeFirstGame(games, S2, '2026-10-15')).toBe(true);
    expect(beforeFirstGame(games, S2, '2026-10-16')).toBe(false);
    expect(beforeFirstGame(games, S1, '2026-10-14')).toBe(false);
  });

  it('orders sessions', () => {
    expect(isEarlier(S1, S2)).toBe(true);
    expect(isEarlier(S2, S1)).toBe(false);
    expect(isEarlier({ year: 2025, session: 3 }, S1)).toBe(true);
    expect(isEarlier(S1, S1)).toBe(false);
  });
});

// The demo backend (previews): session 1 is over, session 2 starts with the next game.
async function signedIn() {
  const api = createDemoBackend();
  await api.auth.signIn(DEMO_LOGIN.email, DEMO_LOGIN.password);
  return api;
}

/** What the Dues page loads. */
async function duesData(api) {
  const [dues, payments, history, profiles, guests, games, roster] = await Promise.all([
    api.entities.SessionDues.list(),
    api.entities.DuesPayment.list(),
    api.entities.DuesHistory.list('-created_date'),
    api.entities.PlayerProfile.list(),
    api.entities.TeamGuest.list('display_name'),
    api.entities.Game.list('-date'),
    api.entities.SessionRoster.list(),
  ]);
  const members = duesMembers({ profiles, guests, payments, history });
  return { dues, payments: members.payments, history: members.history, profiles: members.members, guests, games, roster };
}

const split = (data, period) => {
  const slice = sessionSlice(data, period);
  return teamDues(Number(slice.row.total_fee), slice.members, slice.payments);
};

const profileOf = async (api, name) => (await api.entities.PlayerProfile.filter({ display_name: name }))[0];
const rosterOf = async (api, session, who) =>
  (await api.entities.SessionRoster.list()).find((r) => r.session === session && (r.user_id ?? r.guest_id) === who);

beforeEach(() => localStorage.clear());

describe('session dues', () => {
  it("keep session 1's split when someone's status changes in session 2", async () => {
    const api = await signedIn();
    const year = (await api.entities.SessionDues.list())[0].season_year;
    const one = { year, session: 1 };
    const before = split(await duesData(api), one);
    const names = (team) => team.active.map((p) => p.display_name);
    // Jamie played session 1 and is sitting out session 2; Chris joined in session 2.
    expect(names(before)).toContain('Jamie Fox');
    expect(names(before)).not.toContain('Chris Dunn');
    expect(before).toMatchObject({ perPlayer: 61, paidCount: 12, collected: 732 });

    // Kelly sits out session 2, and Drew joins the active roster.
    await api.entities.PlayerProfile.update((await profileOf(api, 'Kelly Moss')).id, { status: 'on_break' });
    await api.entities.PlayerProfile.update((await profileOf(api, 'Drew Patel')).id, { status: 'active' });

    const after = split(await duesData(api), one);
    expect(names(after)).toEqual(names(before));
    expect(after).toMatchObject({ perPlayer: 61, paidCount: 12, collected: 732 });
    const two = names(split(await duesData(api), { year, session: 2 }));
    expect(two).not.toContain('Kelly Moss');
    expect(two).toContain('Drew Patel');
  });
});

describe('the demo backend', () => {
  it('says which session is current and keeps its list', async () => {
    const api = await signedIn();
    const year = (await api.entities.SessionDues.list())[0].season_year;
    expect(await api.roster.start()).toEqual({ season_year: year, session: 2 });
    const before = (await api.entities.SessionRoster.list()).length;
    await api.roster.start();
    expect(await api.entities.SessionRoster.list()).toHaveLength(before);
  });

  it("counts a status change for the current session only, as the player's answer", async () => {
    const api = await signedIn();
    const casey = await profileOf(api, 'Casey Captain');
    expect(await rosterOf(api, 2, casey.user_id)).toMatchObject({ status: 'active', answered_at: null });
    await api.entities.PlayerProfile.update(casey.id, { status: 'on_break' });
    expect(await rosterOf(api, 2, casey.user_id)).toMatchObject({ status: 'on_break', changed_by: casey.user_id });
    expect((await rosterOf(api, 2, casey.user_id)).answered_at).not.toBeNull();
    expect(await rosterOf(api, 1, casey.user_id)).toMatchObject({ status: 'active' });
  });

  it('puts a new player and new roster names on the current session, and one asked about ahead, not past ones', async () => {
    const api = await signedIn();
    const me = await api.auth.me();
    await api.auth.signUp('newbie@demo.test', 'demo1234');
    const newbie = await api.auth.me();
    await api.entities.PlayerProfile.create({ user_id: newbie.id, display_name: 'Nia New', gender: 'F', status: 'active' });
    expect(await rosterOf(api, 2, newbie.id)).toMatchObject({ status: 'active' });
    expect(await rosterOf(api, 3, newbie.id)).toMatchObject({ status: 'active', answered_at: null });
    expect(await rosterOf(api, 1, newbie.id)).toBeUndefined();

    await api.auth.signIn(DEMO_LOGIN.email, DEMO_LOGIN.password);
    const [ola] = await api.entities.TeamGuest.bulkCreate([{ display_name: 'Ola Late', status: 'active', removed: false, created_by: me.id }]);
    expect(await rosterOf(api, 2, ola.id)).toMatchObject({ status: 'active' });
    expect(await rosterOf(api, 1, ola.id)).toBeUndefined();
  });

  it('marks a roster name taken off the team as off the current session, and keeps the one before', async () => {
    const api = await signedIn();
    const [mike] = await api.entities.TeamGuest.filter({ display_name: 'Mike Russo' });
    await api.entities.TeamGuest.update(mike.id, { removed: true });
    expect(await rosterOf(api, 2, mike.id)).toMatchObject({ status: 'off' });
    expect(await rosterOf(api, 1, mike.id)).toMatchObject({ status: 'active' });
  });

  it("moves a roster name's past sessions to the account that picks it", async () => {
    const api = await signedIn();
    const [mike] = await api.entities.TeamGuest.filter({ display_name: 'Mike Russo' });
    await api.auth.signUp('mike@demo.test', 'demo1234');
    const mikeAccount = await api.auth.me();
    await api.entities.PlayerProfile.create({ user_id: mikeAccount.id, display_name: 'Mike Russo', gender: 'M', status: 'active' });
    await api.users.claimGuest(mike.id);
    expect(await rosterOf(api, 1, mikeAccount.id)).toMatchObject({ status: 'active' });
    expect(await rosterOf(api, 1, mike.id)).toBeUndefined();
    expect(await rosterOf(api, 2, mikeAccount.id)).toMatchObject({ status: 'active' });
  });

  it('starts a new session from everyone\'s status, leaving out roster names that were removed or joined', async () => {
    const api = await signedIn();
    const year = (await api.entities.SessionDues.list())[0].season_year;
    const [mike] = await api.entities.TeamGuest.filter({ display_name: 'Mike Russo' });
    await api.entities.TeamGuest.update(mike.id, { removed: true });
    // Session 2 is played out and next year's session 1 is next. (Session 3 was asked
    // about ahead in the sample data, so its list started then.)
    for (const g of await api.entities.Game.filter({ session: 2 })) await api.entities.Game.update(g.id, { date: '2000-01-01' });
    await api.entities.Game.create({ season_year: year + 1, session: 1, date: '2999-01-01', opponent: 'Net Ninjas' });
    expect(await api.roster.start()).toEqual({ season_year: year + 1, session: 1 });
    const three = (await api.entities.SessionRoster.list()).filter((r) => r.season_year === year + 1 && r.session === 1);
    expect(three.every((r) => r.answered_at === null)).toBe(true);
    expect(three.some((r) => r.guest_id === mike.id)).toBe(false);
    const jamie = await profileOf(api, 'Jamie Fox');
    expect(three.find((r) => r.user_id === jamie.user_id)).toMatchObject({ status: 'on_break' });
  });
});

describe('"Playing session N?" asked ahead', () => {
  const games = [
    { id: 'g1', date: '2026-12-10', season_year: 2026, session: 1 },
    { id: 'g2', date: '2026-12-14', season_year: 2026, session: 1 },
  ];

  it('is asked until the first game, or before the schedule is out once captains ask', () => {
    expect(stillAsking(games, S1, '2026-12-01')).toBe(true);
    expect(stillAsking(games, S1, '2026-12-11')).toBe(false);
    expect(stillAsking(games, S2, '2026-12-11')).toBe(false);
    expect(stillAsking(games, S2, '2026-12-11', '2027-01-03')).toBe(true);
    const asks = [{ season_year: 2026, session: 2, starts_on: '2027-01-03' }, { season_year: 2026, session: 3, starts_on: null }];
    expect(askFor(asks, S2)).toMatchObject({ starts_on: '2027-01-03' });
    expect(askFor(asks, { year: 2026, session: 3 })).toBeNull();
  });

  it('asks one session at a time: the first you haven\'t answered, else the latest', () => {
    const profile = { user_id: 'ana', status: 'active' };
    const asks = [{ season_year: 2026, session: 2, starts_on: '2027-01-03' }];
    const roster = (rows) => ({ current: S1, rows, asks });
    // Session 1 has started, so only session 2 (asked ahead) is asked.
    const ahead = sessionAsk({ profile, roster: roster([entry(S1, { user_id: 'ana' }, 'active')]), games });
    expect(ahead).toMatchObject({ period: S2, isCurrent: false, answered: false, startsOn: '2027-01-03' });
    // Not on session 2's list yet (joined after the ask): their status carries over.
    expect(ahead.entry).toMatchObject({ status: 'active', answered_at: null });
    const answered = sessionAsk({ profile, roster: roster([entry(S2, { user_id: 'ana' }, 'on_break')]), games });
    expect(answered).toMatchObject({ period: S2, answered: true });
    // Off session 2, or taken off the team: not asked.
    expect(sessionAsk({ profile, roster: roster([entry(S2, { user_id: 'ana' }, 'off')]), games })).toBeNull();
    expect(sessionAsk({ profile: { ...profile, removed: true }, roster: roster([]), games })).toBeNull();

    // Before session 1's first game, its own question comes first.
    const early = [{ id: 'g3', date: '2026-12-20', season_year: 2026, session: 1 }];
    const both = roster([entry(S1, { user_id: 'ana' }, 'active', false), entry(S2, { user_id: 'ana' }, 'active', false)]);
    expect(sessionAsk({ profile, roster: both, games: early })).toMatchObject({ period: S1, isCurrent: true });
    const first = roster([entry(S1, { user_id: 'ana' }, 'active'), entry(S2, { user_id: 'ana' }, 'active', false)]);
    expect(sessionAsk({ profile, roster: first, games: early })).toMatchObject({ period: S2, isCurrent: false });
  });

  describe('in the demo backend', () => {
    const asPlayer = async (api, email) => {
      await api.auth.signIn(email, 'demo1234');
      return api;
    };

    it("counts a player's answer for the session asked about only", async () => {
      const api = await signedIn();
      const year = (await api.entities.SessionDues.list())[0].season_year;
      const jordan = await profileOf(api, 'Jordan Rivera');
      await asPlayer(api, 'jordan@demo.test');
      await expect(api.roster.ask({ year, session: 3, startsOn: '2099-01-01' })).rejects.toThrow("Only captains can ask who's playing");
      await api.roster.answer({ year, session: 3, status: 'on_break' });
      expect(await rosterOf(api, 3, jordan.user_id)).toMatchObject({ status: 'on_break', changed_by: jordan.user_id });
      expect((await rosterOf(api, 3, jordan.user_id)).answered_at).not.toBeNull();
      expect(await rosterOf(api, 2, jordan.user_id)).toMatchObject({ status: 'active' });
      expect(await profileOf(api, 'Jordan Rivera')).toMatchObject({ status: 'active' });
      await expect(api.roster.answer({ year: year + 1, session: 1, status: 'active' })).rejects.toThrow(
        'Nobody has asked about that session yet',
      );
      await expect(api.roster.answer({ year, session: 3, status: 'off' })).rejects.toThrow();
      // Players can't change what captains asked, or the lists, directly.
      const [ask] = await api.entities.SessionAsk.list();
      await expect(api.entities.SessionAsk.update(ask.id, { starts_on: null })).rejects.toThrow();
    });

    it('keeps a session asked about ahead in step with today\'s statuses, except for answers', async () => {
      const api = await signedIn();
      const sam = await profileOf(api, 'Sam Okafor');
      const priya = await profileOf(api, 'Priya Shah');
      expect(await rosterOf(api, 3, sam.user_id)).toMatchObject({ status: 'active', answered_at: null });
      await api.entities.PlayerProfile.update(sam.id, { status: 'sub_pool' });
      expect(await rosterOf(api, 3, sam.user_id)).toMatchObject({ status: 'sub_pool', answered_at: null });
      // Priya said she's in for session 3; sitting out session 2 doesn't change that.
      await api.entities.PlayerProfile.update(priya.id, { status: 'on_break' });
      expect(await rosterOf(api, 3, priya.user_id)).toMatchObject({ status: 'active' });
      expect(await rosterOf(api, 2, priya.user_id)).toMatchObject({ status: 'on_break' });
    });

    it('between sessions, the asked session is current and the answers given ahead become everyone\'s status', async () => {
      const api = await signedIn();
      const year = (await api.entities.SessionDues.list())[0].season_year;
      for (const g of await api.entities.Game.filter({ session: 2 })) await api.entities.Game.update(g.id, { date: '2000-01-01' });
      const changes = (await api.entities.DuesChange.list()).length;
      expect(await api.roster.start()).toEqual({ season_year: year, session: 3 });
      // Jamie sat out session 2 and said she's back for session 3; Riley said sub only.
      expect(await profileOf(api, 'Jamie Fox')).toMatchObject({ status: 'active' });
      expect(await profileOf(api, 'Riley Novak')).toMatchObject({ status: 'sub_pool' });
      // Sam didn't answer: still Active, and still to answer for session 3.
      expect(await profileOf(api, 'Sam Okafor')).toMatchObject({ status: 'active' });
      expect((await api.entities.SessionAsk.list())[0].applied_at).not.toBeNull();
      expect(await api.entities.DuesChange.list()).toHaveLength(changes);
      // Status changes count for session 3 now, not the session that just ended.
      const sam = await profileOf(api, 'Sam Okafor');
      await api.entities.PlayerProfile.update(sam.id, { status: 'on_break' });
      expect(await rosterOf(api, 3, sam.user_id)).toMatchObject({ status: 'on_break' });
      expect((await rosterOf(api, 3, sam.user_id)).answered_at).not.toBeNull();
      expect(await rosterOf(api, 2, sam.user_id)).toMatchObject({ status: 'active' });
    });

    it('brings the list up to date when captains ask again after they stopped, keeping the answers', async () => {
      const api = await signedIn();
      const year = (await api.entities.SessionDues.list())[0].season_year;
      const sam = await profileOf(api, 'Sam Okafor');
      const riley = await profileOf(api, 'Riley Novak');
      await api.roster.ask({ year, session: 3, startsOn: null });
      // Sam hasn't answered session 3, and sits out session 2 while captains aren't asking.
      await api.entities.PlayerProfile.update(sam.id, { status: 'on_break' });
      expect(await rosterOf(api, 3, sam.user_id)).toMatchObject({ status: 'active', answered_at: null });
      const changes = (await api.entities.DuesChange.list()).length;
      await api.roster.ask({ year, session: 3, startsOn: '2099-01-02' });
      expect(await rosterOf(api, 3, sam.user_id)).toMatchObject({ status: 'on_break', answered_at: null });
      expect(await rosterOf(api, 3, riley.user_id)).toMatchObject({ status: 'sub_pool' });
      expect(await api.entities.DuesChange.list()).toHaveLength(changes);
    });

    it('puts a player added back on the session asked about ahead again, to be asked again', async () => {
      const api = await signedIn();
      // Riley said sub only for session 3.
      const riley = await profileOf(api, 'Riley Novak');
      expect(await rosterOf(api, 3, riley.user_id)).toMatchObject({ status: 'sub_pool' });
      await api.users.setRemoved(riley.user_id, true);
      expect(await rosterOf(api, 3, riley.user_id)).toMatchObject({ status: 'off', answered_at: null });
      await api.users.setRemoved(riley.user_id, false);
      expect(await rosterOf(api, 3, riley.user_id)).toMatchObject({ status: 'active', answered_at: null });
    });

    it('gives a player who picks their roster name the answer given for it ahead, and an undo gives it back', async () => {
      const api = await signedIn();
      const [mike] = await api.entities.TeamGuest.filter({ display_name: 'Mike Russo' });
      // A captain says Mike is sitting out session 3.
      await api.entities.SessionRoster.update((await rosterOf(api, 3, mike.id)).id, { status: 'on_break', answered_at: new Date().toISOString() });
      await api.auth.signUp('mike@demo.test', 'demo1234');
      const account = await api.auth.me();
      await api.entities.PlayerProfile.create({ user_id: account.id, display_name: 'Mike Russo', gender: 'M', status: 'active' });
      expect(await rosterOf(api, 3, account.id)).toMatchObject({ status: 'active', answered_at: null });
      await api.users.claimGuest(mike.id);
      expect(await rosterOf(api, 3, account.id)).toMatchObject({ status: 'on_break' });
      expect((await rosterOf(api, 3, account.id)).answered_at).not.toBeNull();
      expect((await api.entities.TeamGuestLink.list()).find((l) => l.guest_id === mike.id)).toMatchObject({
        merged_roster: [{ before: { status: 'active', answered_at: null } }],
      });

      await api.auth.signIn(DEMO_LOGIN.email, DEMO_LOGIN.password);
      await api.users.unlinkGuest(mike.id);
      expect(await rosterOf(api, 3, mike.id)).toMatchObject({ status: 'on_break' });
      expect(await rosterOf(api, 3, account.id)).toMatchObject({ status: 'active', answered_at: null });
    });

    it('lets captains change the date or stop asking, before the session starts', async () => {
      const api = await signedIn();
      const year = (await api.entities.SessionDues.list())[0].season_year;
      await api.roster.ask({ year, session: 3, startsOn: '2099-01-02' });
      expect(askFor(await api.entities.SessionAsk.list(), { year, session: 3 })).toMatchObject({ starts_on: '2099-01-02' });
      await api.roster.ask({ year, session: 3, startsOn: null });
      expect(askFor(await api.entities.SessionAsk.list(), { year, session: 3 })).toBeNull();
      await expect(api.roster.ask({ year, session: 1, startsOn: '2099-01-02' })).rejects.toThrow('That session is over');
      await expect(api.roster.ask({ year, session: 2, startsOn: '2099-01-02' })).resolves.toBeNull();
      await expect(api.entities.SessionAsk.create({ season_year: year, session: 3, starts_on: '2099-01-02' })).rejects.toThrow();
    });
  });
});

describe('seasons that cross New Year', () => {
  it('are filed under the year they start in and shown as both years', () => {
    expect(seasonName(2026)).toBe('2026–27');
    expect(seasonName(2099)).toBe('2099–00');
    expect(seasonLabel(2026, 2)).toBe('2026–27 · Session 2');
  });

  it('run November to April, and the months in between count for the season coming up', () => {
    expect(seasonOf('2026-11-07')).toBe(2026);
    expect(seasonOf('2026-12-19')).toBe(2026);
    expect(seasonOf('2027-01-02')).toBe(2026);
    expect(seasonOf('2027-04-24')).toBe(2026);
    expect(seasonOf('2027-05-01')).toBe(2027);
    expect(seasonOf('2027-10-20')).toBe(2027);
  });
});

describe('which session new games go in', () => {
  const game = (period, date) => ({ season_year: period.year, session: period.session, date });
  // Session 1 of 2026–27: Saturdays (none on Thanksgiving weekend), the last on December 19.
  const session1 = ['2026-11-07', '2026-11-14', '2026-11-21', '2026-12-05', '2026-12-12', '2026-12-19'].map((d) => game(S1, d));
  const askedS2 = [{ season_year: 2026, session: 2, starts_on: '2027-01-02' }];

  it('is the session captains are asking about, while this one wraps up or before its schedule is out', () => {
    expect(sessionForNewGames(session1, '2026-12-15', askedS2)).toEqual(S2);
    expect(sessionForNewGames(session1, '2026-12-29', askedS2)).toEqual(S2);
    // Not once they stopped asking.
    expect(sessionForNewGames(session1, '2026-12-15', [{ ...askedS2[0], starts_on: null }])).toEqual(S1);
  });

  it("is the newest session on the schedule while it has games to come, and the next one once it's over", () => {
    expect(sessionForNewGames(session1, '2026-12-15', [])).toEqual(S1);
    expect(sessionForNewGames(session1, '2026-12-29', [])).toEqual(S2);
    // Session 2's games are up: more of them go in session 2, even with session 1 still going.
    expect(sessionForNewGames([...session1, game(S2, '2027-01-02')], '2026-12-15', askedS2)).toEqual(S2);
    // After session 3 comes the next season's first.
    expect(sessionForNewGames([game({ year: 2026, session: 3 }, '2027-04-24')], '2027-05-10', [])).toEqual({ year: 2027, session: 1 });
  });

  it("is the first session of today's season when there are no games yet", () => {
    expect(sessionForNewGames([], '2026-10-20', [])).toEqual({ year: 2026, session: 1 });
    expect(sessionForNewGames([], '2027-02-01', [])).toEqual({ year: 2026, session: 1 });
  });
});
