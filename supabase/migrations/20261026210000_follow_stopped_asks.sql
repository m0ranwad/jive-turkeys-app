-- Keep future dues and headcounts current after captains stop asking (#123).
-- Explicit answers still win; past sessions keep their lists. Replacing the
-- functions changes no stored rows during the database update.

create or replace function public.roster_follow_ahead(p_user_id uuid, p_guest_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cur record;
  was text := current_setting('jive.roster_applying', true);
begin
  select * into cur from public.roster_current_session();
  perform set_config('jive.roster_applying', 'on', true);
  update public.session_roster r
    set status = p_status, answered_at = case when p_status = 'off' then null else r.answered_at end
    from public.session_asks a
    where (a.season_year, a.session) > (cur.cur_year, cur.cur_session)
      and r.season_year = a.season_year and r.session = a.session
      and (r.user_id = p_user_id or r.guest_id = p_guest_id)
      and (r.answered_at is null or p_status = 'off')
      and (r.status is distinct from p_status or r.answered_at is not null);
  insert into public.session_roster (season_year, session, user_id, guest_id, status)
    select a.season_year, a.session, p_user_id, p_guest_id, p_status
    from public.session_asks a
    where (a.season_year, a.session) > (cur.cur_year, cur.cur_session)
      and p_status <> 'off'
      and exists (select 1 from public.session_roster r where r.season_year = a.season_year and r.session = a.session)
    on conflict do nothing;
  perform set_config('jive.roster_applying', coalesce(was, 'off'), true);
end;
$$;

-- Refresh old stopped lists on entry, before the screens load their roster.
-- Reuse the existing refresh, which preserves answers and suppresses dues
-- history for entries that are just following today's roster. Never apply a
-- future answer to a player's current profile, or start an unasked list.
create or replace function public.roster_start_current()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cur record;
  o record;
  ahead record;
begin
  if (select auth.uid()) is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_team_member() then
    raise exception 'Join the team first';
  end if;
  select * into cur from public.roster_current_session();
  perform public.roster_start_session(cur.cur_year, cur.cur_session);
  perform public.roster_apply_asked(cur.cur_year, cur.cur_session);
  for ahead in
    select a.season_year, a.session from public.session_asks a
    where a.starts_on is null and (a.season_year, a.session) > (cur.cur_year, cur.cur_session)
      and exists (select 1 from public.session_roster r where r.season_year = a.season_year and r.session = a.session)
  loop
    perform public.roster_refresh_asked(ahead.season_year, ahead.session);
  end loop;
  select * into o from public.roster_open_session();
  return jsonb_build_object('season_year', cur.cur_year, 'session', cur.cur_session, 'over', o.open_year is null);
end;
$$;
