-- "Playing session 2?" before the schedule is out. Until now the question was
-- only asked once the new session's first game was on the schedule and next,
-- because the current session was worked out from the games alone. Teams want
-- to know who's playing well before that: between sessions (December 21 for a
-- session that starts January 3, with the schedule out December 29), and
-- sometimes while the current session still has games left.
--
-- Now captains ask about a later session themselves (session_asks, through
-- roster_ask()), giving its first game's date. Players answer with
-- roster_answer(): an answer for a session asked about ahead goes into that
-- session's list only, so the session still being played, its dues and
-- everyone's status right now stay as they are. Until it starts, an asked
-- session's list keeps following today's status for anyone who hasn't
-- answered it (roster_follow_ahead()), so its dues split and headcounts are
-- the answers so far plus everyone else as they are now. Between sessions (no
-- game coming up), an asked session is the current one, so status changes made
-- then count for it instead of the session that just ended. When an asked
-- session becomes the current one, the answers given ahead become everyone's
-- status right now (roster_apply_asked()).

create table public.session_asks (
  id uuid primary key default gen_random_uuid(),
  season_year integer not null,
  session integer not null check (session > 0),
  -- The first game's date, as the captain gave it. Null: captains stopped asking.
  starts_on date,
  asked_by uuid references public.users (id) on delete set null,
  -- When it became the current session and the answers given ahead were applied.
  applied_at timestamptz,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  constraint session_asks_session unique (season_year, session)
);

create trigger session_asks_touch before update on public.session_asks
  for each row execute function public.touch_updated_date();

-- The team reads them. Only roster_ask() writes them (captains), like dues_history.
alter table public.session_asks enable row level security;
create policy session_asks_select on public.session_asks for select to authenticated
  using ((select public.is_team_member()));
grant select, insert, update, delete on public.session_asks to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The current session: the next game's; between sessions, the earliest later
-- session captains asked about; else the latest game's; else this year's
-- first. Same as currentSession() in src/lib/dues.js, with "today" in the
-- team's time zone.
-- ---------------------------------------------------------------------------

create or replace function public.roster_current_session(out cur_year integer, out cur_session integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/New_York')::date;
  latest_year integer;
  latest_session integer;
begin
  select g.season_year, g.session into cur_year, cur_session
    from public.games g where g.date >= today order by g.date, g.id limit 1;
  if cur_year is not null then
    return;
  end if;
  select g.season_year, g.session into latest_year, latest_session
    from public.games g order by g.date desc, g.id desc limit 1;
  select a.season_year, a.session into cur_year, cur_session
    from public.session_asks a
    where a.starts_on is not null
      and (latest_year is null or (a.season_year, a.session) > (latest_year, latest_session))
    order by a.starts_on, a.season_year, a.session
    limit 1;
  if cur_year is not null then
    return;
  end if;
  cur_year := coalesce(latest_year, extract(year from today)::integer);
  cur_session := coalesce(latest_session, 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- Sessions asked about ahead follow today's status, until they start: for
-- anyone who hasn't answered them, anyone taken off the team (off), and anyone
-- new (added). That's their list keeping up, not anyone answering, so it isn't
-- recorded as a dues change.
-- ---------------------------------------------------------------------------

create or replace function public.roster_follow_ahead(p_user_id uuid, p_guest_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cur record;
begin
  select * into cur from public.roster_current_session();
  perform set_config('jive.roster_applying', 'on', true);
  update public.session_roster r
    set status = p_status
    from public.session_asks a
    where a.starts_on is not null and (a.season_year, a.session) > (cur.cur_year, cur.cur_session)
      and r.season_year = a.season_year and r.session = a.session
      and (r.user_id = p_user_id or r.guest_id = p_guest_id)
      and (r.answered_at is null or p_status = 'off')
      and r.status is distinct from p_status;
  insert into public.session_roster (season_year, session, user_id, guest_id, status)
    select a.season_year, a.session, p_user_id, p_guest_id, p_status
    from public.session_asks a
    where a.starts_on is not null and (a.season_year, a.session) > (cur.cur_year, cur.cur_session)
      and p_status <> 'off'
      and exists (select 1 from public.session_roster r where r.season_year = a.season_year and r.session = a.session)
    on conflict do nothing;
  perform set_config('jive.roster_applying', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- The follow triggers and the dues changes for the session lists: same as
-- 20261014180000_remove_team_member.sql, 20261013225036_session_roster.sql and
-- 20261017040000_dues_changes.sql, plus sessions asked about ahead follow too
-- (above), and they stand aside while a list is only keeping up with today's
-- statuses (that's not anyone changing their status).
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
  select * into cur from public.roster_current_session();
  perform public.roster_start_session(cur.cur_year, cur.cur_session);
  insert into public.session_roster (season_year, session, user_id, status, answered_at, changed_by)
  values (
    cur.cur_year, cur.cur_session, new.user_id,
    case when new.removed then 'off' else new.status end,
    now(), (select auth.uid())
  )
  on conflict (season_year, session, user_id) do update
    set status = excluded.status, answered_at = excluded.answered_at, changed_by = excluded.changed_by;
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
  select * into cur from public.roster_current_session();
  perform public.roster_start_session(cur.cur_year, cur.cur_session);
  insert into public.session_roster (season_year, session, guest_id, status, answered_at, changed_by)
  values (
    cur.cur_year, cur.cur_session, new.id,
    case when new.removed then 'off' else new.status end,
    now(), (select auth.uid())
  )
  on conflict (season_year, session, guest_id) do update
    set status = excluded.status, answered_at = excluded.answered_at, changed_by = excluded.changed_by;
  perform public.roster_follow_ahead(null, new.id, case when new.removed then 'off' else new.status end);
  return new;
end;
$$;

create or replace function public.dues_changes_roster()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  was_active boolean := false;
begin
  if current_setting('jive.roster_applying', true) = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' and new.answered_at is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    was_active := old.status = 'active';
  end if;
  if was_active <> (new.status = 'active') then
    insert into public.dues_changes (season_year, session, kind, user_id, guest_id, old_value, new_value, changed_by)
    values (
      new.season_year, new.session, 'roster', new.user_id, new.guest_id,
      case when tg_op = 'UPDATE' then jsonb_build_object('status', old.status) end,
      jsonb_build_object('status', new.status),
      coalesce((select auth.uid()), new.changed_by)
    );
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- An asked session that has just become the current one: the answers given
-- ahead become everyone's status right now (Team page, My Profile). Its list
-- has been following today's statuses (roster_follow_ahead()); it's checked
-- once more the way it would have started today, in case anything slipped by:
-- anyone missing is added, anyone not answered gets their status right now,
-- anyone taken off the team is off. Once per asked session; two players
-- opening the site at once apply it once.
-- ---------------------------------------------------------------------------

create or replace function public.roster_apply_asked(p_year integer, p_session integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.session_asks set applied_at = now()
    where season_year = p_year and session = p_session and starts_on is not null and applied_at is null;
  if not found then
    return;
  end if;
  perform set_config('jive.roster_applying', 'on', true);

  insert into public.session_roster (season_year, session, user_id, status)
    select p_year, p_session, p.user_id, p.status from public.player_profiles p
    where not p.removed
    on conflict do nothing;
  insert into public.session_roster (season_year, session, guest_id, status)
    select p_year, p_session, g.id, g.status from public.team_guests g
    where not g.removed and g.linked_user_id is null
    on conflict do nothing;

  update public.session_roster r
    set status = case when p.removed then 'off' else p.status end
    from public.player_profiles p
    where r.season_year = p_year and r.session = p_session and r.user_id = p.user_id
      and (r.answered_at is null or p.removed)
      and r.status is distinct from (case when p.removed then 'off' else p.status end);
  update public.session_roster r
    set status = case when g.removed then 'off' else g.status end
    from public.team_guests g
    where r.season_year = p_year and r.session = p_session and r.guest_id = g.id and g.linked_user_id is null
      and (r.answered_at is null or g.removed)
      and r.status is distinct from (case when g.removed then 'off' else g.status end);

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

-- The site calls this when it opens: same as 20261014000809_team_join_code.sql,
-- plus an asked session that has just become the current one is brought up to date.
create or replace function public.roster_start_current()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cur record;
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
  return jsonb_build_object('season_year', cur.cur_year, 'session', cur.cur_session);
end;
$$;

-- ---------------------------------------------------------------------------
-- Captains ask "Playing session N?" about a session that hasn't started,
-- giving its first game's date (asking again changes the date; no date stops
-- asking). Its list starts now, a copy of everyone's status, nobody answered.
-- ---------------------------------------------------------------------------

create or replace function public.roster_ask(p_year integer, p_session integer, p_starts_on date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  today date := (now() at time zone 'America/New_York')::date;
  cur record;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_captain() then
    raise exception 'Only captains can ask who''s playing';
  end if;
  if p_session is null or p_session < 1 or p_year is null then
    raise exception 'Pick a session';
  end if;
  select * into cur from public.roster_current_session();
  if (p_year, p_session) < (cur.cur_year, cur.cur_session) then
    raise exception 'That session is over';
  end if;
  if exists (select 1 from public.games where season_year = p_year and session = p_session and date < today) then
    raise exception 'That session has already started';
  end if;
  insert into public.session_asks (season_year, session, starts_on, asked_by)
  values (p_year, p_session, p_starts_on, me)
  on conflict (season_year, session) do update
    set starts_on = excluded.starts_on, asked_by = excluded.asked_by,
      -- Asked again after it stopped: bring it up to date again when it becomes current.
      applied_at = case when excluded.starts_on is null then null else public.session_asks.applied_at end;
  if p_starts_on is not null then
    perform public.roster_start_session(p_year, p_session);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- A player's answer to "Playing session N?", for the current session (until
-- its first game) or a later one captains asked about. For the current session
-- it's their status right now, as before (the follow trigger records it). For
-- a session asked about ahead it goes into that session's list only.
-- ---------------------------------------------------------------------------

create or replace function public.roster_answer(p_year integer, p_session integer, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  today date := (now() at time zone 'America/New_York')::date;
  cur record;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_team_member() then
    raise exception 'Join the team first';
  end if;
  if p_status is null or p_status not in ('active', 'sub_pool', 'on_break') then
    raise exception 'Pick I''m in, Sub only or Sitting out';
  end if;
  if not exists (select 1 from public.player_profiles where user_id = me and not removed) then
    raise exception 'Make your profile first';
  end if;
  if exists (select 1 from public.games where season_year = p_year and session = p_session and date < today) then
    raise exception 'That session has already started';
  end if;
  select * into cur from public.roster_current_session();
  if (p_year, p_session) = (cur.cur_year, cur.cur_session) then
    update public.player_profiles set status = p_status where user_id = me;
    return;
  end if;
  if not exists (
    select 1 from public.session_asks
    where season_year = p_year and session = p_session and starts_on is not null
  ) or (p_year, p_session) < (cur.cur_year, cur.cur_session) then
    raise exception 'Nobody has asked about that session yet';
  end if;
  perform public.roster_start_session(p_year, p_session);
  insert into public.session_roster (season_year, session, user_id, status, answered_at, changed_by)
  values (p_year, p_session, me, p_status, now(), me)
  on conflict (season_year, session, user_id) do update
    set status = excluded.status, answered_at = excluded.answered_at, changed_by = excluded.changed_by;
end;
$$;

revoke execute on function public.roster_follow_ahead(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.roster_apply_asked(integer, integer) from public, anon, authenticated;
revoke execute on function public.roster_ask(integer, integer, date) from public, anon;
revoke execute on function public.roster_answer(integer, integer, text) from public, anon;
grant execute on function public.roster_follow_ahead(uuid, uuid, text) to service_role;
grant execute on function public.roster_apply_asked(integer, integer) to service_role;
grant execute on function public.roster_ask(integer, integer, date) to authenticated, service_role;
grant execute on function public.roster_answer(integer, integer, text) to authenticated, service_role;
