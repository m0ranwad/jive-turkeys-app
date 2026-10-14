// Roster names (players who haven't joined the site) in game sign-ups,
// headcounts, results and Player of the Match. The database's rules are tested
// in supabase/tests/games.test.sql; these check the shared logic and the demo
// backend (previews), which must behave the same way.
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_LOGIN, createDemoBackend } from '@/api/demo';
import { guestAsPlayer } from '@/lib/dues';
import { awardCounts, headcount, keyedRow, keyedVote, leaderboard, playerKey, suspendedIds } from '@/lib/team-logic';

const game = { id: 'g2', season_year: 2026, session: 1, date: '2026-10-15', has_result: false };
const lastWeek = { id: 'g1', season_year: 2026, session: 1, date: '2026-10-08', has_result: true, score_us: 3, score_them: 2 };
const kim = { user_id: 'kim', display_name: 'Kim', gender: 'F', status: 'active' };
const pat = { user_id: 'pat', display_name: 'Pat', gender: 'M', status: 'active' };
const sub = { user_id: 'sub', display_name: 'Sid', gender: 'M', status: 'sub_pool' };
const rest = { user_id: 'rest', display_name: 'Rae', gender: 'F', status: 'on_break' };
const mike = guestAsPlayer({ id: 'mike', display_name: 'Mike', gender: 'M', status: 'active' });
const dana = guestAsPlayer({ id: 'dana', display_name: 'Dana', gender: 'F', status: 'active' });
const gone = guestAsPlayer({ id: 'gone', display_name: 'Gone', gender: 'M', status: 'active', removed: true });
const players = [kim, pat, sub, rest, mike, dana, gone];

describe('rows for roster names', () => {
  it("are keyed by the roster name's id, like the roster name itself", () => {
    expect(keyedRow({ id: 'r1', user_id: null, guest_id: 'mike' })).toMatchObject({ user_id: 'mike', guest_id: 'mike' });
    expect(keyedRow({ id: 'r2', user_id: 'pat', guest_id: null })).toMatchObject({ user_id: 'pat' });
    expect(keyedVote({ voted_for_id: null, voted_for_guest_id: 'dana' })).toMatchObject({ voted_for_id: 'dana' });
  });

  it('are written with guest_id, and app players with user_id', () => {
    expect(playerKey(mike)).toEqual({ user_id: null, guest_id: 'mike' });
    expect(playerKey(pat)).toEqual({ user_id: 'pat', guest_id: null });
  });
});

describe('the headcount', () => {
  const rsvps = [
    { game_id: 'g2', user_id: 'pat', status: 'in' },
    { game_id: 'g2', user_id: null, guest_id: 'mike', status: 'in' },
    { game_id: 'g2', user_id: null, guest_id: 'dana', status: 'in', playing_gk: true },
  ].map(keyedRow);
  const count = headcount({ game, rsvps, profiles: players, settings: { min_players: 4, min_women: 2 } });
  const names = (group) => count.groups[group].map((e) => e.profile.display_name);

  it("counts roster names' RSVPs like everyone else's", () => {
    expect(names('in')).toEqual(['Pat', 'Mike', 'Dana']);
    expect(count.totalIn).toBe(3);
    // Dana is in goal, so she doesn't count toward the women on the field.
    expect(count.womenFieldIn).toBe(0);
    expect(count).toMatchObject({ needTotal: 1, needWomen: 2 });
  });

  it('lists Active players who have not answered as No reply, and subs on their own', () => {
    expect(names('none')).toEqual(['Kim']);
    expect(names('subs')).toEqual(['Sid', 'Rae']);
  });

  it('leaves out roster names taken off the team', () => {
    expect([...names('in'), ...names('none'), ...names('subs')]).not.toContain('Gone');
  });
});

describe('stats and awards', () => {
  const stats = [
    { game_id: 'g1', user_id: null, guest_id: 'mike', played: true, goals: 2, assists: 0, red_cards: 1 },
    { game_id: 'g1', user_id: 'pat', played: true, goals: 1, assists: 1 },
  ].map(keyedRow);
  const votes = [
    { game_id: 'g1', voter_id: 'pat', voted_for_id: null, voted_for_guest_id: 'mike', award: 'man' },
    { game_id: 'g1', voter_id: 'kim', voted_for_id: null, voted_for_guest_id: 'mike', award: 'man' },
  ].map(keyedVote);

  it('include roster names in the leaderboard', () => {
    const rows = leaderboard({ games: [lastWeek], stats, profiles: players, votes });
    expect(rows.find((r) => r.profile.display_name === 'Mike')).toMatchObject({ games: 1, goals: 2, awards: 1 });
  });

  it('give roster names Player of the Match awards', () => {
    expect(awardCounts([lastWeek], votes).mike).toMatchObject({ man: 1, total: 1 });
  });

  it('suspend a roster name after a red card, like anyone', () => {
    expect(suspendedIds(game, [lastWeek, game], stats)).toEqual(['mike']);
  });
});

// The demo backend: Mike Russo and Dana Wells are on the roster but haven't joined.
async function asCaptain() {
  const api = createDemoBackend();
  await api.auth.signIn(DEMO_LOGIN.email, DEMO_LOGIN.password);
  return api;
}

beforeEach(() => localStorage.clear());

describe('the demo backend', () => {
  it('has sample RSVPs and a stat line for roster names', async () => {
    const api = await asCaptain();
    const [mike] = await api.entities.TeamGuest.filter({ display_name: 'Mike Russo' });
    const [dana] = await api.entities.TeamGuest.filter({ display_name: 'Dana Wells' });
    expect((await api.entities.Rsvp.filter({ guest_id: mike.id }))[0]).toMatchObject({ status: 'in', user_id: null });
    expect((await api.entities.Rsvp.filter({ guest_id: dana.id }))[0]).toMatchObject({ status: 'maybe' });
    expect((await api.entities.GameStat.filter({ guest_id: mike.id }))[0]).toMatchObject({ played: true, assists: 1 });
  });

  it("moves a roster name's RSVPs, stats and votes to the account that picks it, keeping the account's own RSVP", async () => {
    const api = await asCaptain();
    const [mike] = await api.entities.TeamGuest.filter({ display_name: 'Mike Russo' });
    const [mikeRsvp] = await api.entities.Rsvp.filter({ guest_id: mike.id });
    const [stat] = await api.entities.GameStat.filter({ guest_id: mike.id });
    const [jordan] = await api.entities.PlayerProfile.filter({ display_name: 'Jordan Rivera' });
    await api.entities.PotmVote.create({ game_id: stat.game_id, voter_id: jordan.user_id, voted_for_id: null, voted_for_guest_id: mike.id, award: 'man' });

    await api.auth.signUp('mike@demo.test', 'demo1234');
    const me = await api.auth.me();
    await api.entities.PlayerProfile.create({ user_id: me.id, display_name: 'Mike Russo', gender: 'M', status: 'active' });
    // Before picking his name he'd already said OUT for the next game himself.
    await api.entities.Rsvp.create({ game_id: mikeRsvp.game_id, user_id: me.id, guest_id: null, status: 'out', playing_gk: false });
    await api.users.claimGuest(mike.id);

    expect(await api.entities.Rsvp.filter({ game_id: mikeRsvp.game_id, user_id: me.id })).toMatchObject([{ status: 'out' }]);
    expect(await api.entities.GameStat.filter({ user_id: me.id })).toMatchObject([{ game_id: stat.game_id, assists: 1, guest_id: null }]);
    expect(await api.entities.PotmVote.filter({ voted_for_id: me.id })).toHaveLength(1);
    expect(await api.entities.PotmVote.filter({ voted_for_guest_id: mike.id })).toHaveLength(0);
  });
});
