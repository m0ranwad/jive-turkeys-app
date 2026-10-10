import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api';
import { duesMembers } from '@/lib/dues';

/** Everything the Dues page shows, for every session, loaded together. */
export function useDues() {
  const [state, setState] = useState({ loading: true, failed: false });

  const load = useCallback(async () => {
    try {
      const [dues, payments, history, profiles, guests, games] = await Promise.all([
        api.entities.SessionDues.list(),
        api.entities.DuesPayment.list(),
        api.entities.DuesHistory.list('-created_date'),
        api.entities.PlayerProfile.list(),
        api.entities.TeamGuest.list('display_name'),
        api.entities.Game.list('-date'),
      ]);
      // `profiles` is everyone who splits the dues: app players and guests alike.
      const members = duesMembers({ profiles, guests, payments, history });
      setState({
        loading: false,
        failed: false,
        dues,
        payments: members.payments,
        history: members.history,
        profiles: members.members,
        guests,
        games,
      });
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
