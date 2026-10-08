import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api';
import { DEFAULT_SETTINGS } from '@/lib/constants';

// Signed-in user, roster and team settings are needed on almost every page,
// so they're cached for a short time and shared between pages.
const CACHE_MS = 20_000;
let cache = { at: 0, promise: null, data: null };

export function loadTeam() {
  const now = Date.now();
  if (cache.data && now - cache.at < CACHE_MS) return Promise.resolve(cache.data);
  if (cache.promise) return cache.promise;

  cache.promise = (async () => {
    const [user, profiles, settingsRows] = await Promise.all([
      api.auth.me(),
      api.entities.PlayerProfile.list(),
      api.entities.TeamSettings.list(),
    ]);
    const data = {
      user,
      profiles,
      profile: profiles.find((p) => p.user_id === user?.id) || null,
      settings: settingsRows[0] || DEFAULT_SETTINGS,
      settingsRecord: settingsRows[0] || null,
    };
    cache = { at: Date.now(), promise: null, data };
    return data;
  })();
  cache.promise.catch(() => {
    cache.promise = null;
  });
  return cache.promise;
}

export function clearTeamCache() {
  cache = { at: 0, promise: null, data: null };
}

export function useTeam() {
  const [state, setState] = useState({ loading: true, user: null, profile: null, profiles: [], settings: DEFAULT_SETTINGS });

  const load = useCallback(async () => {
    const data = await loadTeam();
    setState({ loading: false, ...data });
    return data;
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const reload = useCallback(async () => {
    clearTeamCache();
    return load();
  }, [load]);

  return { ...state, isCaptain: state.user?.role === 'admin', reload };
}
