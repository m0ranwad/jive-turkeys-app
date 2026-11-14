// Goalkeepers (docs/games.md section 2): halves in goal, goals against by half,
// clean sheets (a half at 0), the record in goal, and who the result screen
// suggests in goal from "I'll play GK".
import { describe, expect, it } from 'vitest';
import { createDemoBackend, DEMO_LOGIN } from '@/api/demo';
import { guestAsPlayer } from '@/lib/dues';
import {
  cleanLabel,
  halvesAgainst,
  keeperGame,
  keeperLabel,
  keeperTotals,
  recordText,
  suggestedKeepers,
} from '@/lib/keepers';
import { resultRows } from '@/lib/results';
import { careerStats, leaderboard } from '@/lib/team-logic';

const game = (id, us, them, firstHalf, extra = {}) => ({
  id, has_result: true, score_us: us, score_them: them, score_them_first_half: firstHalf, season_year: 2026, session: 1, ...extra,
});
const line = (game_id, user_id, halves, extra = {}) => ({
  game_id, user_id, played: true, goals: 0, assists: 0, blue_cards: 0, red_cards: 0,
  gk_first_half: halves.includes(1), gk_second_half: halves.includes(2), ...extra,
});

describe('goals against by half', () => {
  it('are the 1st half and the rest of the final score', () => {
    expect(halvesAgainst(game('g', 3, 2, 0))).toEqual([0, 2]);
    expect(halvesAgainst(game('g', 3, 2, 2))).toEqual([2, 0]);
  });

  it('are 0 and 0 when the other team never scored, even if nobody entered a split', () => {
    expect(halvesAgainst(game('g', 3, 0, null))).toEqual([0, 0]);
  });

  it("are unknown when nobody was sure how the goals split, or there's no result", () => {
    expect(halvesAgainst(game('g', 3, 2, null))).toBeNull();
    expect(halvesAgainst({ id: 'g', has_result: false })).toBeNull();
  });
});

describe('one keeper in one game', () => {
  it('counts the halves they kept, the clean ones and what they let in', () => {
    const g = game('g', 3, 2, 0);
    expect(keeperGame(line('g', 'taylor', [1]), g)).toEqual({ halves: [0], clean: [0], against: 0 });
    expect(keeperGame(line('g', 'sam', [2]), g)).toEqual({ halves: [1], clean: [], against: 2 });
  });

  it('gives a keeper in goal both halves the whole score even when the split is unknown, but no clean sheet', () => {
    expect(keeperGame(line('g', 'taylor', [1, 2]), game('g', 3, 2, null))).toEqual({ halves: [0, 1], clean: [], against: 2 });
  });

  it("leaves a split game's goals against unknown when nobody was sure", () => {
    expect(keeperGame(line('g', 'sam', [2]), game('g', 3, 2, null))).toEqual({ halves: [1], clean: [], against: null });
  });

  it('labels the halves and clean sheets for the Result card', () => {
    expect(keeperLabel([0])).toBe('GK · 1st half');
    expect(keeperLabel([1])).toBe('GK · 2nd half');
    expect(keeperLabel([0, 1])).toBe('GK · both halves');
    expect(keeperLabel([])).toBeNull();
    expect(cleanLabel({ halves: [0], clean: [0] })).toBe('Clean sheet');
    expect(cleanLabel({ halves: [0, 1], clean: [0, 1] })).toBe('Clean sheet');
    expect(cleanLabel({ halves: [0, 1], clean: [1] })).toBe('Clean 2nd half');
    expect(cleanLabel({ halves: [1], clean: [] })).toBeNull();
  });
});

describe('keeper totals', () => {
  const games = [game('a', 3, 2, 0), game('b', 1, 1, 1), game('c', 4, 1, null), game('d', 2, 5, null), { id: 'e', has_result: false }];
  const byId = Object.fromEntries(games.map((g) => [g.id, g]));

  it('add up halves, clean halves (a game with no goals against would be 2), goals against and the record in goal', () => {
    const taylor = [line('a', 't', [1]), line('b', 't', [1, 2]), line('c', 't', [1, 2]), line('e', 't', [1, 2])];
    const t = keeperTotals(taylor, byId);
    // a: 1st half, clean. b: both, 1st let in 1, 2nd clean. c: both, not sure, let in 1. e: no result yet.
    expect(t).toEqual({ halves: 5, clean: 2, against: 2, w: 2, l: 0, d: 1, games: 3 });
    expect(recordText(t)).toBe('2-0-1');
  });

  it("count a split game in both keepers' records, and only lines in goal", () => {
    const sam = [line('a', 's', [2]), line('d', 's', [2]), line('b', 's', [], { goals: 1 })];
    // d: split game, not sure how it split, so no goals against or clean sheet for it.
    expect(keeperTotals(sam, byId)).toEqual({ halves: 2, clean: 0, against: 2, w: 1, l: 1, d: 0, games: 2 });
  });

  it('show on the leaderboard for the season or session picked, and in career stats', () => {
    const profiles = [{ user_id: 't', display_name: 'Taylor', gender: 'M' }];
    const lines = [line('a', 't', [1, 2]), line('x', 't', [1, 2])];
    const all = [game('a', 3, 0, null), game('x', 0, 2, 1, { season_year: 2025, session: 3 })];
    const thisSeason = leaderboard({ games: all, stats: lines, profiles, year: 2026, session: 'all' })[0];
    expect(thisSeason.keeper).toMatchObject({ halves: 2, clean: 2, against: 0, w: 1 });
    const career = careerStats({ games: all, stats: lines, profiles })[0];
    expect(career.keeper).toMatchObject({ halves: 4, clean: 2, against: 2, w: 1, l: 1 });
    expect(career.sessions.map((s) => s.gkHalves)).toEqual([2, 2]);
  });
});

describe('keepers suggested on the result screen', () => {
  const kim = { user_id: 'kim', display_name: 'Kim', gender: 'F', status: 'active' };
  const pat = { user_id: 'pat', display_name: 'Pat', gender: 'M', status: 'active' };
  const sid = { user_id: 'sid', display_name: 'Sid', gender: 'M', status: 'active' };
  const mike = guestAsPlayer({ id: 'mike', display_name: 'Mike', gender: 'M', status: 'active' });
  const upcoming = { id: 'g1', has_result: false };
  const rsvp = (user_id, playing_gk, status = 'in') => ({ game_id: 'g1', user_id, status, playing_gk });

  it('put one volunteer in goal both halves', () => {
    const rsvps = [rsvp('kim', true), rsvp('pat', false)];
    const rows = resultRows({ game: upcoming, profiles: [kim, pat], rsvps });
    expect(suggestedKeepers(rows, rsvps, upcoming)).toEqual(['kim', 'kim']);
  });

  it('split two volunteers, the guy shown in goal on Who\'s coming taking the 1st half, roster names included', () => {
    const rsvps = [rsvp('kim', true), rsvp('mike', true), rsvp('pat', false)];
    const rows = resultRows({ game: upcoming, profiles: [kim, pat, mike], rsvps });
    expect(suggestedKeepers(rows, rsvps, upcoming)).toEqual(['mike', 'kim']);
  });

  it("leave out volunteers who didn't play, and suggest nobody without one", () => {
    const rsvps = [rsvp('sid', true, 'out'), rsvp('pat', false)];
    const rows = resultRows({ game: upcoming, profiles: [pat, sid], rsvps });
    expect(suggestedKeepers(rows, rsvps, upcoming)).toEqual([null, null]);
  });

  it('carry the saved keeper halves on each result row', () => {
    const played = { id: 'g1', has_result: true };
    const rows = resultRows({ game: played, profiles: [kim], stats: [line('g1', 'kim', [2])] });
    expect(rows[0]).toMatchObject({ gk_first_half: false, gk_second_half: true });
  });
});

describe('the sample data', () => {
  it('saves keepers and the 1st half like the database, and hides goals against to start', async () => {
    localStorage.clear();
    const api = createDemoBackend();
    await api.auth.signIn(DEMO_LOGIN.email, DEMO_LOGIN.password);
    const [settings] = await api.entities.TeamSettings.list();
    expect(settings.show_goals_against).toBe(false);
    const stats = await api.entities.GameStat.list();
    expect(stats.some((s) => s.gk_first_half) && stats.some((s) => s.gk_second_half)).toBe(true);

    const next = (await api.entities.Game.list('date')).find((g) => !g.has_result);
    const me = await api.auth.me();
    await expect(
      api.games.saveResult(next.id, { scoreUs: 2, scoreThem: 1, scoreThemFirstHalf: 2, lines: [], fillIns: [] }),
    ).rejects.toThrow("can't have more goals against");
    await api.games.saveResult(next.id, {
      scoreUs: 2, scoreThem: 1, scoreThemFirstHalf: 1,
      lines: [{ user_id: me.id, guest_id: null, played: false, goals: 0, assists: 0, blue_cards: 0, red_cards: 0, gk_first_half: true }],
      fillIns: [{ display_name: 'Gus', gender: 'M', goals: 0, assists: 0, gk_second_half: true }],
    });
    const saved = (await api.entities.Game.list()).find((g) => g.id === next.id);
    expect(saved.score_them_first_half).toBe(1);
    const mine = (await api.entities.GameStat.list()).find((s) => s.game_id === next.id && s.user_id === me.id);
    expect(mine).toMatchObject({ played: true, gk_first_half: true, gk_second_half: false });
    const gus = (await api.entities.GameFillIn.list()).find((f) => f.game_id === next.id);
    expect(gus).toMatchObject({ display_name: 'Gus', gk_second_half: true });

    await api.games.saveResult(next.id, { scoreUs: 2, scoreThem: 0, scoreThemFirstHalf: null, lines: [], fillIns: null });
    expect((await api.entities.Game.list()).find((g) => g.id === next.id).score_them_first_half).toBe(0);
  });
});
