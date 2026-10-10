import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api';

/** Everything the Dues page shows, for every session, loaded together. */
export function useDues() {
  const [state, setState] = useState({ loading: true, failed: false });

  const load = useCallback(async () => {
    try {
      const [dues, payments, history, profiles, games] = await Promise.all([
        api.entities.SessionDues.list(),
        api.entities.DuesPayment.list(),
        api.entities.DuesHistory.list('-created_date'),
        api.entities.PlayerProfile.list(),
        api.entities.Game.list('-date'),
      ]);
      setState({ loading: false, failed: false, dues, payments, history, profiles, games });
    } catch {
      setState((s) => ({ ...s, loading: false, failed: true }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: load };
}

/** One session's slice: its fee row (or null), payments and history (newest first). */
export function sessionSlice(data, { year, session }) {
  const same = (r) => r.season_year === Number(year) && r.session === Number(session);
  return {
    row: data.dues.find(same) || null,
    payments: data.payments.filter(same),
    history: data.history.filter(same),
  };
}
