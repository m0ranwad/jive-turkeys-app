-- A session captains asked about ahead and then stopped asking about is
-- brought up to date when it becomes the current one. Until now that only
-- happened while captains were still asking: once they stopped, the session's
-- list kept what it had when they stopped (it only follows today's statuses
-- while captains are asking), and when its schedule went up and it became the
-- current session nothing caught it up. Its dues and headcounts then counted
-- statuses from weeks before and left out anyone who joined in between.
--
-- Now roster_apply_asked() works the same whether or not captains are still
-- asking: once, when the session becomes the current one, its list is checked
-- (anyone still to answer gets their status right now, new players and roster
-- names are added, anyone taken off the team is off), and the answers given
-- before captains stopped become those players' status right now, as they
-- would have if captains had kept asking.

-- ---------------------------------------------------------------------------
-- Same as 20261019120000_ask_next_session.sql, but also for a session captains
-- stopped asking about (starts_on is null). Stopping clears applied_at, so this
-- still runs once.
-- ---------------------------------------------------------------------------

create or replace function public.roster_apply_asked(p_year integer, p_session integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.session_asks set applied_at = now()
    where season_year = p_year and session = p_session and applied_at is null;
  if not found then
    return;
  end if;
  perform public.roster_refresh_asked(p_year, p_session);
  perform set_config('jive.roster_applying', 'on', true);

  update public.player_profiles p
    set status = r.status
    from public.session_roster r
    where r.season_year = p_year and r.session = p_session and r.user_id = p.user_id
      and r.answered_at is not null and r.status <> 'off' and not p.removed and p.status <> r.status;
  update public.team_guests g
    set status = r.status
    from public.session_roster r
    where r.season_year = p_year and r.session = p_session and r.guest_id = g.id
      and r.answered_at is not null and r.status <> 'off' and not g.removed and g.linked_user_id is null
      and g.status <> r.status;

  perform set_config('jive.roster_applying', 'off', true);
end;
$$;
