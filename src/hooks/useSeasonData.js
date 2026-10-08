import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api';
import { clearTeamCache, loadTeam } from './useTeam';

/** Everything the schedule, game and stats pages need, loaded together. */
export function useSeasonData() {
  const [state, setState] = useState({ loading: true });

  const load = useCallback(async () => {
    const team = await loadTeam();
    const [games, rsvps, stats, votes] = await Promise.all([
      api.entities.Game.list('-date'),
      api.entities.Rsvp.list(),
      api.entities.GameStat.list(),
      api.entities.PotmVote.list(),
    ]);
    setState({
      loading: false,
      user: team.user,
      isCaptain: team.user?.role === 'admin',
      profile: team.profile,
      profiles: team.profiles || [],
      settings: team.settings,
      settingsRecord: team.settingsRecord,
      games,
      rsvps,
      stats,
      votes,
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const reload = useCallback(async () => {
    clearTeamCache();
    return load();
  }, [load]);

  return { ...state, reload };
}
