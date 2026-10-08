import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '@/api';
import { clearTeamCache } from './useTeam';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null });

  const refresh = useCallback(async () => {
    try {
      const user = await api.auth.me();
      setState({ loading: false, user });
    } catch {
      setState({ loading: false, user: null });
    }
  }, []);

  useEffect(() => {
    refresh();
    return api.auth.onChange((event) => {
      // Initial session is already covered by refresh() above.
      if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') return;
      clearTeamCache();
      refresh();
    });
  }, [refresh]);

  return <AuthContext.Provider value={{ ...state, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
