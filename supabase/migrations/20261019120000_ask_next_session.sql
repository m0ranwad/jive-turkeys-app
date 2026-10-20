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
--
-- Also: a new player who picks their roster name brings over an answer given
-- for that name ahead (move_team_guest(), recorded in
-- team_guest_links.merged_roster), and an undo puts it back
-- (unlink_team_guest()).

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
-- recorded as a dues change. Someone taken off the team is off even if they'd
-- answered, and it's no longer their answer: added back, they follow their
-- status again and are asked again.
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
    set status = p_status, answered_at = case when p_status = 'off' then null else r.answered_at end
    from public.session_asks a
    where a.starts_on is not null and (a.season_year, a.session) > (cur.cur_year, cur.cur_session)
      and r.season_year = a.season_year and r.session = a.session
      and (r.user_id = p_user_id or r.guest_id = p_guest_id)
      and (r.answered_at is null or p_status = 'off')
      and (r.status is distinct from p_status or r.answered_at is not null);
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
-- An asked session's list brought up to date the way it would start today:
-- anyone missing is added, anyone still to answer gets their status right now,
-- anyone taken off the team is off (and no longer answered). Its list follows
-- today's statuses only while captains are asking (roster_follow_ahead()), so
-- this runs when they ask again after stopping, and once more when it becomes
-- the current session, in case anything slipped by. That's not anyone
-- answering, so it isn't recorded as a dues change.
-- ---------------------------------------------------------------------------

create or replace function public.roster_refresh_asked(p_year integer, p_session integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  was text := current_setting('jive.roster_applying', true);
begin
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
    set status = case when p.removed then 'off' else p.status end,
      answered_at = case when p.removed then null else r.answered_at end
    from public.player_profiles p
    where r.season_year = p_year and r.session = p_session and r.user_id = p.user_id
      and (r.answered_at is null or p.removed)
      and (r.status is distinct from (case when p.removed then 'off' else p.status end) or r.answered_at is not null);
  update public.session_roster r
    set status = case when g.removed then 'off' else g.status end,
      answered_at = case when g.removed then null else r.answered_at end
    from public.team_guests g
    where r.season_year = p_year and r.session = p_session and r.guest_id = g.id and g.linked_user_id is null
      and (r.answered_at is null or g.removed)
      and (r.status is distinct from (case when g.removed then 'off' else g.status end) or r.answered_at is not null);

  perform set_config('jive.roster_applying', coalesce(was, 'off'), true);
end;
$$;

-- ---------------------------------------------------------------------------
-- An asked session that has just become the current one: the answers given
-- ahead become everyone's status right now (Team page, My Profile), after its
-- list is checked once more (above). Once per asked session; two players
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
-- Asked again after they stopped, its list catches up with what changed in
-- between, keeping the answers given.
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
    perform public.roster_refresh_asked(p_year, p_session);
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

-- ---------------------------------------------------------------------------
-- Same as 20261018150000_unlink_team_guest.sql, plus: in a session asked about
-- ahead, an answer given for the name goes to the account that picks it
-- (recorded, like merged_payments), and an undo puts it back and puts the name
-- and the account back on those lists.
-- ---------------------------------------------------------------------------

-- The account's entries in sessions asked about ahead that took the name's
-- answer, before and after: [{ id, before: { status, answered_at, changed_by }, after: { ... } }].
alter table public.team_guest_links
  add column merged_roster jsonb not null default '[]';

create or replace function public.move_team_guest(p_guest_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.team_guests;
  p public.player_profiles;
  partner uuid;
  rec public.team_guest_links;
  cur record;
begin
  -- One pick at a time for a name (two sign-ups at once could otherwise both
  -- get it) and for an account (which can only have one name).
  select * into g from public.team_guests where id = p_guest_id for update;
  if g.id is null or g.linked_user_id is not null then
    raise exception 'That name has already been picked';
  end if;
  perform 1 from public.users where id = p_user_id for update;
  if not found then
    raise exception 'No such player on the app';
  end if;
  if exists (select 1 from public.team_guests where linked_user_id = p_user_id) then
    raise exception 'That player already has a name on the roster';
  end if;
  select * into p from public.player_profiles where user_id = p_user_id;

  -- Sessions the app player has nothing for yet move over as they are.
  with moved as (
    update public.dues_payments d set user_id = p_user_id, guest_id = null
    where d.guest_id = p_guest_id
      and not exists (
        select 1 from public.dues_payments u
        where u.user_id = p_user_id and u.season_year = d.season_year and u.session = d.session
      )
    returning d.id
  )
  select coalesce(array_agg(id), '{}') into rec.moved_payments from moved;
  -- Where both have one, a payment the guest made counts (with what they
  -- paid), and so does a custom amount the app player doesn't have. The app
  -- player's payment as it was is kept ("was" is the same row before this).
  with merged as (
    update public.dues_payments u set
        paid = u.paid or d.paid,
        paid_date = case when u.paid then u.paid_date else d.paid_date end,
        paid_by = case when u.paid then u.paid_by else d.paid_by end,
        paid_amount = case when u.paid then u.paid_amount else d.paid_amount end,
        override_amount = coalesce(u.override_amount, d.override_amount)
      from public.dues_payments d, public.dues_payments was
      where d.guest_id = p_guest_id and u.user_id = p_user_id
        and u.season_year = d.season_year and u.session = d.session and was.id = u.id
        and ((d.paid and not u.paid) or (u.override_amount is null and d.override_amount is not null))
      returning u.id,
        jsonb_build_object('paid', was.paid, 'paid_date', was.paid_date, 'paid_by', was.paid_by,
          'paid_amount', was.paid_amount, 'override_amount', was.override_amount) as before,
        jsonb_build_object('paid', u.paid, 'paid_date', u.paid_date, 'paid_by', u.paid_by,
          'paid_amount', u.paid_amount, 'override_amount', u.override_amount) as after
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'before', before, 'after', after)), '[]')
    into rec.merged_payments from merged;
  with moved as (
    update public.dues_history set user_id = p_user_id, guest_id = null where guest_id = p_guest_id returning id
  )
  select coalesce(array_agg(id), '{}') into rec.moved_history from moved;
  -- What moved the split for the name (team_guests_dues_changes would move
  -- these too, as the name is linked below).
  with moved as (
    update public.dues_changes set user_id = p_user_id, guest_id = null where guest_id = p_guest_id returning id
  )
  select coalesce(array_agg(id), '{}') into rec.moved_changes from moved;

  -- Sessions asked about ahead: an answer given for the name (by a captain,
  -- say) counts over an account entry that's only been following its status.
  -- A new player is put on those lists when they make their profile, just
  -- before they pick their name. That entry takes the name's answer (the
  -- name's is kept), as it was is recorded, and the dues change that answer
  -- made moves with the name's (above), so it isn't recorded again.
  select * into cur from public.roster_current_session();
  perform set_config('jive.roster_applying', 'on', true);
  with merged as (
    update public.session_roster u
      set status = r.status, answered_at = r.answered_at, changed_by = r.changed_by
      from public.session_roster r, public.session_roster was
      where u.user_id = p_user_id and u.answered_at is null
        and r.guest_id = p_guest_id and r.answered_at is not null
        and r.season_year = u.season_year and r.session = u.session
        and (u.season_year, u.session) > (cur.cur_year, cur.cur_session)
        and was.id = u.id
      returning u.id,
        jsonb_build_object('status', was.status, 'answered_at', was.answered_at, 'changed_by', was.changed_by) as before,
        jsonb_build_object('status', u.status, 'answered_at', u.answered_at, 'changed_by', u.changed_by) as after
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'before', before, 'after', after)), '[]')
    into rec.merged_roster from merged;
  perform set_config('jive.roster_applying', 'off', true);

  -- Sessions the roster name was on and the app player wasn't. Where both
  -- were, the app player's own entry counts (the roster name's is kept).
  with moved as (
    update public.session_roster r set user_id = p_user_id, guest_id = null
    where r.guest_id = p_guest_id
      and not exists (
        select 1 from public.session_roster u
        where u.user_id = p_user_id and u.season_year = r.season_year and u.session = r.session
      )
    returning r.id
  )
  select coalesce(array_agg(id), '{}') into rec.moved_roster from moved;

  -- Game sign-ups and stat lines. Where both have one for a game, the app
  -- player's own counts (the roster name's is kept).
  with moved as (
    update public.rsvps r set user_id = p_user_id, guest_id = null
    where r.guest_id = p_guest_id
      and not exists (select 1 from public.rsvps u where u.user_id = p_user_id and u.game_id = r.game_id)
    returning r.id
  )
  select coalesce(array_agg(id), '{}') into rec.moved_rsvps from moved;
  with moved as (
    update public.game_stats s set user_id = p_user_id, guest_id = null
    where s.guest_id = p_guest_id
      and not exists (select 1 from public.game_stats u where u.user_id = p_user_id and u.game_id = s.game_id)
    returning s.id
  )
  select coalesce(array_agg(id), '{}') into rec.moved_stats from moved;
  -- Player of the Match votes for the roster name (except any the player cast
  -- for that name themselves, which would be a vote for themselves).
  with moved as (
    update public.potm_votes v set voted_for_id = p_user_id, voted_for_guest_id = null
    where v.voted_for_guest_id = p_guest_id and v.voter_id <> p_user_id
    returning v.id
  )
  select coalesce(array_agg(id), '{}') into rec.moved_votes from moved;

  -- Details the player hasn't filled in come from the roster.
  rec.filled := case when p.id is null then '{}' else jsonb_strip_nulls(jsonb_build_object(
    'gender', case when p.gender is null then g.gender end,
    'position', case when p.position is null then g.position end
  )) end;
  update public.player_profiles
    set gender = coalesce(gender, g.gender), position = coalesce(position, g.position)
    where user_id = p_user_id;

  partner := coalesce(g.pays_with_user, g.pays_with_guest);
  rec.guest_partner := partner;
  if partner is not null then
    rec.user_partner := coalesce(p.pays_with, p.pays_with_guest);
  end if;
  update public.team_guests
    set linked_user_id = p_user_id, pays_with_user = null, pays_with_guest = null
    where id = p_guest_id;
  if partner is not null then
    perform public.set_dues_partner(p_user_id, partner);
  end if;

  rec.id := gen_random_uuid();
  rec.guest_id := p_guest_id;
  rec.user_id := p_user_id;
  rec.status_before := p.status;
  rec.rebuilt := false;
  rec.linked_by := (select auth.uid());
  rec.created_date := now();
  insert into public.team_guest_links select rec.*;
end;
$$;

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

  -- Back on the current session's list, if it started while the name was linked.
  select * into cur from public.roster_current_session();
  if exists (select 1 from public.session_roster where season_year = cur.cur_year and session = cur.cur_session) then
    insert into public.session_roster (season_year, session, guest_id, status, answered_at, changed_by)
    values (cur.cur_year, cur.cur_session, p_guest_id, case when g.removed then 'off' else g.status end, now(), me)
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

revoke execute on function public.roster_follow_ahead(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.roster_refresh_asked(integer, integer) from public, anon, authenticated;
revoke execute on function public.roster_apply_asked(integer, integer) from public, anon, authenticated;
revoke execute on function public.roster_ask(integer, integer, date) from public, anon;
revoke execute on function public.roster_answer(integer, integer, text) from public, anon;
grant execute on function public.roster_follow_ahead(uuid, uuid, text) to service_role;
grant execute on function public.roster_refresh_asked(integer, integer) to service_role;
grant execute on function public.roster_apply_asked(integer, integer) to service_role;
grant execute on function public.roster_ask(integer, integer, date) to authenticated, service_role;
grant execute on function public.roster_answer(integer, integer, text) to authenticated, service_role;
