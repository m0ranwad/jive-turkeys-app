import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api';
import { guestAsPlayer } from '@/lib/dues';
import { keyedRow, keyedVote } from '@/lib/team-logic';
import { clearTeamCache, loadTeam } from './useTeam';

/**
 * Everything the schedule, game and stats pages need, loaded together.
 * `players` is the app players plus roster names who haven't joined the site
 * (guestAsPlayer(), keyed by their guest id), and sign-ups, stat lines and votes
 * are keyed the same way (keyedRow(), keyedVote()), so a roster name counts in
 * headcounts, results and stats like everyone else.
 */
export function useSeasonData() {
  const [state, setState] = useState({ loading: true });

  const load = useCallback(async () => {
    const team = await loadTeam();
    const [games, rsvps, stats, fillIns, votes, guests] = await Promise.all([
      api.entities.Game.list('-date'),
      api.entities.Rsvp.list(),
      api.entities.GameStat.list(),
      api.entities.GameFillIn.list().catch(() => []),
      api.entities.PotmVote.list(),
      api.entities.TeamGuest.list('display_name').catch(() => []),
    ]);
    const profiles = team.profiles || [];
    setState({
      loading: false,
      user: team.user,
      isCaptain: team.user?.role === 'admin',
      profile: team.profile,
      profiles,
      // A roster name that has joined is their account now.
      players: [...profiles, ...guests.filter((g) => !g.linked_user_id).map(guestAsPlayer)],
      settings: team.settings,
      settingsRecord: team.settingsRecord,
      roster: team.roster,
      games,
      rsvps: rsvps.map(keyedRow),
      stats: stats.map(keyedRow),
      // People from outside the team who played a game for us; only on that game's result.
      fillIns,
      votes: votes.map(keyedVote),
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const reload = useCallback(async () => {
    clearTeamCache();
    return load();
  }, [load]);

  /** Puts one saved RSVP in place, without downloading every game, RSVP, stat and vote again. */
  const putRsvp = useCallback((row) => {
    const saved = keyedRow(row);
    setState((s) => ({ ...s, rsvps: [...(s.rsvps || []).filter((r) => r.id !== saved.id), saved] }));
  }, []);

  return { ...state, reload, putRsvp };
}
