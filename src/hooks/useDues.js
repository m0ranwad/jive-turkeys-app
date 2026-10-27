import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api';
import { duesMembers, profileAsPlayer } from '@/lib/dues';
import { hasSessionList, membersForSession } from '@/lib/roster';

/** Everything the Dues page shows, for every session, loaded together. */
export function useDues() {
  const [state, setState] = useState({ loading: true, failed: false });

  const load = useCallback(async () => {
    try {
      // Opening directly on Dues must finish repairing session lists before
      // reading them. useTeam() starts that work too, but loads alongside us.
      await api.roster.start();
      const [dues, payments, history, profiles, guests, games, roster, changes] = await Promise.all([
        api.entities.SessionDues.list(),
        api.entities.DuesPayment.list(),
        api.entities.DuesHistory.list('-created_date'),
        api.entities.PlayerProfile.list(),
        api.entities.TeamGuest.list('display_name'),
        api.entities.Game.list('-date'),
        // Who was on each session. No fallback: guessing with today's statuses would ask
        // players to pay for sessions they didn't play, so a failed read fails the page.
        api.entities.SessionRoster.list(),
        // What moved each session's split (fee, custom amounts, roster), once the database keeps it.
        api.entities.DuesChange.list('-created_date').catch(() => []),
      ]);
      // `profiles` is everyone who splits the dues: app players and guests alike.
      const members = duesMembers({ profiles: profiles.map(profileAsPlayer), guests, payments, history, changes });
      setState({
        loading: false,
        failed: false,
        dues,
        payments: members.payments,
        history: members.history,
        changes: members.changes,
        profiles: members.members,
        guests,
        games,
        roster,
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

/**
 * One session's slice: its fee row (or null), payments, history and changes
 * (newest first), and the team as it was that session (`members`, each with
 * that session's status). `started` is false for a session that has no list
 * of its own yet, which uses today's statuses. `linked` are roster names that
 * stopped counting when a captain linked them to an account already on the
 * session's list: dues_changes doesn't record that, so it's shaped like a
 * roster change (at the link, the name's last update) for teamDues() to tell
 * what someone's share was when they paid. Not for showing.
 */
export function sessionSlice(data, { year, session }) {
  const same = (r) => r.season_year === Number(year) && r.session === Number(session);
  return {
    row: data.dues.find(same) || null,
    payments: data.payments.filter(same),
    history: data.history.filter(same),
    changes: (data.changes || []).filter(same),
    members: membersForSession(data.profiles, data.roster, { year, session }),
    started: hasSessionList(data.roster, { year, session }),
    linked: (data.guests || [])
      .filter((g) => g.linked_user_id && data.roster.some((r) => same(r) && r.guest_id === g.id && r.status === 'active'))
      .map((g) => ({ kind: 'roster', user_id: g.id, old_value: { status: 'active' }, new_value: { status: 'off' }, created_date: g.updated_date })),
  };
}
