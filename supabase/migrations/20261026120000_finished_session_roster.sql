-- A session that's over keeps its list. Until now the session status changes
-- counted for was the current session, and with nothing on the schedule after
-- its last game (between sessions, and the six months between seasons) that
-- was the session that had just ended: a player sitting out next season, a new
-- player joining, or a captain adding or removing someone rewrote its list,
-- and so its dues (a share going up for players who had already paid).
--
-- Now the session status changes count for is worked out on its own
-- (roster_open_session()): the current session, unless it's over (its games
-- have all been played, nothing else is on the schedule and captains haven't
-- asked about the next one). Then a status change only changes that player's
-- status right now, and the next session's list starts from everyone's status
-- once its first game is on the schedule or captains ask who's playing it.
-- The Dues page still opens on the session that just ended
-- (roster_current_session() doesn't change), and captains correct it from Team
-- dues like any past session.

-- ---------------------------------------------------------------------------
-- The session status changes count for: the current session, unless it's
-- over. Same as openSession() in src/lib/dues.js.
-- ---------------------------------------------------------------------------

create or replace function public.roster_open_session(out open_year integer, out open_session integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/New_York')::date;
  cur record;
begin
  select * into cur from public.roster_current_session();
  -- Over: it has games and they've all been played. (With a game coming up, or
  -- a session asked about between sessions, that's the current one instead.)
  if exists (select 1 from public.games where season_year = cur.cur_year and session = cur.cur_session)
    and not exists (select 1 from public.games where date >= today) then
    return;
  end if;
  open_year := cur.cur_year;
  open_session := cur.cur_session;
end;
$$;

-- ---------------------------------------------------------------------------
-- The follow triggers: same as 20261019120000_ask_next_session.sql, but a
-- status set while the current session is over goes on no session's list.
-- ---------------------------------------------------------------------------

create or replace function public.roster_follow_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cur record;
begin
  if current_setting('jive.roster_applying', true) = 'on' then
    return new;
  end if;
  select * into cur from public.roster_open_session();
  if cur.open_year is not null then
    perform public.roster_start_session(cur.open_year, cur.open_session);
    insert into public.session_roster (season_year, session, user_id, status, answered_at, changed_by)
    values (
      cur.open_year, cur.open_session, new.user_id,
      case when new.removed then 'off' else new.status end,
      now(), (select auth.uid())
    )
    on conflict (season_year, session, user_id) do update
      set status = excluded.status, answered_at = excluded.answered_at, changed_by = excluded.changed_by;
  end if;
  perform public.roster_follow_ahead(new.user_id, null, case when new.removed then 'off' else new.status end);
  return new;
end;
$$;

create or replace function public.roster_follow_guest()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cur record;
begin
  if current_setting('jive.roster_applying', true) = 'on' then
    return new;
  end if;
  -- Once a roster name has joined, their account's list is the one that counts.
  if new.linked_user_id is not null then
    return new;
  end if;
  select * into cur from public.roster_open_session();
  if cur.open_year is not null then
    perform public.roster_start_session(cur.open_year, cur.open_session);
    insert into public.session_roster (season_year, session, guest_id, status, answered_at, changed_by)
    values (
      cur.open_year, cur.open_session, new.id,
      case when new.removed then 'off' else new.status end,
      now(), (select auth.uid())
    )
    on conflict (season_year, session, guest_id) do update
      set status = excluded.status, answered_at = excluded.answered_at, changed_by = excluded.changed_by;
  end if;
  perform public.roster_follow_ahead(null, new.id, case when new.removed then 'off' else new.status end);
  return new;
end;
$$;

-- The site calls this when it opens: same as 20261019120000_ask_next_session.sql,
-- plus it says whether the current session is over (status changes don't count for it).
create or replace function public.roster_start_current()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cur record;
  o record;
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
  select * into o from public.roster_open_session();
  return jsonb_build_object('season_year', cur.cur_year, 'session', cur.cur_session, 'over', o.open_year is null);
end;
$$;

revoke execute on function public.roster_open_session() from public, anon;
grant execute on function public.roster_open_session() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Same as 20261019120000_ask_next_session.sql, except an undo puts the name
-- back on the list of the session status changes count for, not a session
-- that's over.
-- ---------------------------------------------------------------------------

create or replace function public.unlink_team_guest(p_guest_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  g public.team_guests;
  l public.team_guest_links;
  u uuid;
  cur record;
  back text;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_captain() then
    raise exception 'Only captains can unlink a player';
  end if;
  select * into g from public.team_guests where id = p_guest_id for update;
  if g.linked_user_id is null then
    raise exception 'That name isn''t linked to anyone';
  end if;
  u := g.linked_user_id;
  select * into l from public.team_guest_links
    where guest_id = p_guest_id and user_id = u and unlinked_at is null
    order by created_date desc limit 1
    for update;
  if l.id is null then
    raise exception 'That name was picked before undo was added, so it can''t be undone here';
  end if;

  -- Dues: the name's payments, and the account's own payments it was merged into.
  update public.dues_payments d set user_id = null, guest_id = p_guest_id
  where d.id = any (l.moved_payments) and d.user_id = u
    and not exists (
      select 1 from public.dues_payments x
      where x.guest_id = p_guest_id and x.season_year = d.season_year and x.session = d.session
    );
  update public.dues_payments d set
      paid = (was.before ->> 'paid')::boolean,
      paid_date = (was.before ->> 'paid_date')::date,
      paid_by = (was.before ->> 'paid_by')::uuid,
      paid_amount = (was.before ->> 'paid_amount')::numeric,
      override_amount = (was.before ->> 'override_amount')::numeric
    from jsonb_to_recordset(l.merged_payments) as was (id uuid, before jsonb, after jsonb)
    where d.id = was.id and d.user_id = u
      and jsonb_build_object('paid', d.paid, 'paid_date', d.paid_date, 'paid_by', d.paid_by,
        'paid_amount', d.paid_amount, 'override_amount', d.override_amount) = was.after;
  update public.dues_history set user_id = null, guest_id = p_guest_id
    where id = any (l.moved_history) and user_id = u;
  update public.dues_changes set user_id = null, guest_id = p_guest_id
    where id = any (l.moved_changes) and user_id = u;

  -- Session lists, sign-ups, stat lines and votes.
  update public.session_roster r set user_id = null, guest_id = p_guest_id
  where r.id = any (l.moved_roster) and r.user_id = u
    and not exists (
      select 1 from public.session_roster x
      where x.guest_id = p_guest_id and x.season_year = r.season_year and x.session = r.session
    );
  update public.rsvps r set user_id = null, guest_id = p_guest_id
  where r.id = any (l.moved_rsvps) and r.user_id = u
    and not exists (select 1 from public.rsvps x where x.guest_id = p_guest_id and x.game_id = r.game_id);
  update public.game_stats s set user_id = null, guest_id = p_guest_id
  where s.id = any (l.moved_stats) and s.user_id = u
    and not exists (select 1 from public.game_stats x where x.guest_id = p_guest_id and x.game_id = s.game_id);
  update public.potm_votes set voted_for_id = null, voted_for_guest_id = p_guest_id
    where id = any (l.moved_votes) and voted_for_id = u;
  -- The account's entries that took the name's answer, unless changed since.
  perform set_config('jive.roster_applying', 'on', true);
  update public.session_roster r set
      status = was.before ->> 'status',
      answered_at = (was.before ->> 'answered_at')::timestamptz,
      changed_by = (was.before ->> 'changed_by')::uuid
    from jsonb_to_recordset(l.merged_roster) as was (id uuid, before jsonb, after jsonb)
    where r.id = was.id and r.user_id = u
      and r.status = was.after ->> 'status'
      and r.answered_at is not distinct from (was.after ->> 'answered_at')::timestamptz
      and r.changed_by is not distinct from (was.after ->> 'changed_by')::uuid;
  perform set_config('jive.roster_applying', 'off', true);

  -- The account's details and status, unless they've been changed since.
  update public.player_profiles set
      gender = case when l.filled ? 'gender' and gender = l.filled ->> 'gender' then null else gender end,
      position = case when l.filled ? 'position' and position = l.filled ->> 'position' then null else position end
    where user_id = u and (l.filled ? 'gender' or l.filled ? 'position');
  if l.status_after is not null and l.status_before is not null and l.status_before <> l.status_after then
    update public.player_profiles set status = l.status_before where user_id = u and status = l.status_after;
  end if;

  update public.team_guests set linked_user_id = null where id = p_guest_id;

  -- Who paid with whom: the name's partner goes back to it, and the account's
  -- partner from before to the account, if nobody has paired them up since.
  if l.guest_partner is not null then
    if l.guest_partner <> u and public.dues_partner_of(u) = l.guest_partner then
      perform public.set_dues_partner(u, null);
    end if;
    if public.dues_partner_of(p_guest_id) is null and public.dues_partner_of(l.guest_partner) is null
      and not exists (select 1 from public.team_guests where id = l.guest_partner and linked_user_id is not null) then
      perform public.set_dues_partner(p_guest_id, l.guest_partner);
    end if;
  end if;
  if l.user_partner is not null and public.dues_partner_of(u) is null and public.dues_partner_of(l.user_partner) is null
    and not exists (select 1 from public.team_guests where id = l.user_partner and linked_user_id is not null) then
    perform public.set_dues_partner(u, l.user_partner);
  end if;

  -- Back on the current session's list, if it started while the name was
  -- linked. A session that's over keeps its list.
  select * into cur from public.roster_open_session();
  if cur.open_year is not null
    and exists (select 1 from public.session_roster where season_year = cur.open_year and session = cur.open_session) then
    insert into public.session_roster (season_year, session, guest_id, status, answered_at, changed_by)
    values (cur.open_year, cur.open_session, p_guest_id, case when g.removed then 'off' else g.status end, now(), me)
    on conflict do nothing;
  end if;
  -- Both keep up with their status in sessions asked about ahead, where they
  -- haven't answered (the name may have been left off one asked while linked).
  perform public.roster_follow_ahead(null, p_guest_id, case when g.removed then 'off' else g.status end);
  select case when removed then 'off' else status end into back from public.player_profiles where user_id = u;
  if back is not null then
    perform public.roster_follow_ahead(u, null, back);
  end if;

  update public.team_guest_links set unlinked_at = now(), unlinked_by = me where id = l.id;
end;
$$;
