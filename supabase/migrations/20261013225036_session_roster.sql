-- Who's on the team each session. Players come and go: some play one session
-- and don't come back, some sit one out, new ones join mid-season. Until now
-- each player had one status and every session, past ones included, was
-- worked out from today's statuses, so a status change rewrote past sessions'
-- dues.
--
-- Now each session keeps its own list (session_roster). It starts as a copy of
-- everyone's status when the session becomes the current one (the session of
-- the next game), and follows status changes made while it's current. Once the
-- next session takes over, it stays as it was; captains can still correct it.
-- player_profiles.status and team_guests.status stay each player's status
-- right now, so the rest of the site works as before.

create table public.session_roster (
  id uuid primary key default gen_random_uuid(),
  season_year integer not null,
  session integer not null check (session > 0),
  -- An app player or a roster name that hasn't joined yet (exactly one).
  user_id uuid references public.users (id) on delete cascade,
  guest_id uuid references public.team_guests (id),
  -- The usual statuses, plus 'off': not on the team that session (a roster name
  -- a captain removed while it was current), kept so the history shows it.
  status text not null check (status in ('active', 'on_break', 'sub_pool', 'off')),
  -- When the player (or a captain) set it for this session. Null: carried over
  -- from before the session started and not confirmed yet ("Playing session 2?").
  answered_at timestamptz,
  changed_by uuid references public.users (id) on delete set null,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  constraint session_roster_one_player check (num_nonnulls(user_id, guest_id) = 1),
  constraint session_roster_user unique (season_year, session, user_id)
);

create unique index session_roster_guest on public.session_roster (season_year, session, guest_id);

create trigger session_roster_touch before update on public.session_roster
  for each row execute function public.touch_updated_date();

-- Everyone reads. Players change their own status for the current session
-- through their profile (the triggers below); only captains edit the list
-- directly, to correct a past session.
alter table public.session_roster enable row level security;
create policy session_roster_select on public.session_roster for select to authenticated using (true);
create policy session_roster_captains on public.session_roster for all to authenticated
  using ((select public.is_captain())) with check ((select public.is_captain()));
grant select, insert, update, delete on public.session_roster to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The current session: the next game's, else the latest game's, else this
-- year's first. Same as currentSession() in src/lib/dues.js, with "today" in
-- the team's time zone.
-- ---------------------------------------------------------------------------

create or replace function public.roster_current_session(out cur_year integer, out cur_session integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/New_York')::date;
begin
  select g.season_year, g.session into cur_year, cur_session
    from public.games g where g.date >= today order by g.date, g.id limit 1;
  if cur_year is null then
    select g.season_year, g.session into cur_year, cur_session
      from public.games g order by g.date desc, g.id desc limit 1;
  end if;
  if cur_year is null then
    cur_year := extract(year from today)::integer;
    cur_session := 1;
  end if;
end;
$$;

-- Starts a session's list as a copy of everyone's status right now, unless it
-- already has one. Roster names that were removed or have joined are left out.
create or replace function public.roster_start_session(p_year integer, p_session integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.session_roster where season_year = p_year and session = p_session) then
    return;
  end if;
  -- Two players opening the site at once start it once.
  perform pg_advisory_xact_lock(hashtext('session_roster'), p_year * 10 + p_session);
  if exists (select 1 from public.session_roster where season_year = p_year and session = p_session) then
    return;
  end if;
  insert into public.session_roster (season_year, session, user_id, status)
    select p_year, p_session, p.user_id, p.status from public.player_profiles p
    on conflict do nothing;
  insert into public.session_roster (season_year, session, guest_id, status)
    select p_year, p_session, g.id, g.status from public.team_guests g
    where not g.removed and g.linked_user_id is null
    on conflict do nothing;
end;
$$;

-- The site calls this when it opens: starts the current session's list if it
-- hasn't been yet, and says which session that is.
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
  select * into cur from public.roster_current_session();
  perform public.roster_start_session(cur.cur_year, cur.cur_session);
  return jsonb_build_object('season_year', cur.cur_year, 'session', cur.cur_session);
end;
$$;

-- ---------------------------------------------------------------------------
-- A status set on the Team page or My Profile (or a new player joining, or a
-- captain adding or removing a roster name) is recorded for the current
-- session, and counts as that player's answer for it.
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
  select * into cur from public.roster_current_session();
  perform public.roster_start_session(cur.cur_year, cur.cur_session);
  insert into public.session_roster (season_year, session, user_id, status, answered_at, changed_by)
  values (cur.cur_year, cur.cur_session, new.user_id, new.status, now(), (select auth.uid()))
  on conflict (season_year, session, user_id) do update
    set status = excluded.status, answered_at = excluded.answered_at, changed_by = excluded.changed_by;
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
  return new;
end;
$$;

create trigger player_profiles_roster
  after insert or update of status on public.player_profiles
  for each row execute function public.roster_follow_profile();

create trigger team_guests_roster
  after insert or update of status, removed on public.team_guests
  for each row execute function public.roster_follow_guest();

-- ---------------------------------------------------------------------------
-- Same as before (20261010141838_team_guests.sql), plus: sessions the roster
-- name was on and the app player wasn't move to the app player, like their
-- dues payments.
-- ---------------------------------------------------------------------------

create or replace function public.move_team_guest(p_guest_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.team_guests;
  partner uuid;
begin
  select * into g from public.team_guests where id = p_guest_id;
  if g.id is null or g.linked_user_id is not null then
    raise exception 'That name has already been picked';
  end if;
  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'No such player on the app';
  end if;
  if exists (select 1 from public.team_guests where linked_user_id = p_user_id) then
    raise exception 'That player already has a name on the roster';
  end if;

  -- Sessions the app player has nothing for yet move over as they are.
  update public.dues_payments d set user_id = p_user_id, guest_id = null
  where d.guest_id = p_guest_id
    and not exists (
      select 1 from public.dues_payments u
      where u.user_id = p_user_id and u.season_year = d.season_year and u.session = d.session
    );
  -- Where both have one, a payment the guest made counts, and so does a
  -- custom amount the app player doesn't have.
  update public.dues_payments u set
      paid = u.paid or d.paid,
      paid_date = case when u.paid then u.paid_date else d.paid_date end,
      paid_by = case when u.paid then u.paid_by else d.paid_by end,
      override_amount = coalesce(u.override_amount, d.override_amount)
    from public.dues_payments d
    where d.guest_id = p_guest_id and u.user_id = p_user_id
      and u.season_year = d.season_year and u.session = d.session
      and ((d.paid and not u.paid) or (u.override_amount is null and d.override_amount is not null));
  update public.dues_history set user_id = p_user_id, guest_id = null where guest_id = p_guest_id;

  -- Sessions the roster name was on and the app player wasn't. Where both
  -- were, the app player's own entry counts (the roster name's is kept).
  update public.session_roster r set user_id = p_user_id, guest_id = null
  where r.guest_id = p_guest_id
    and not exists (
      select 1 from public.session_roster u
      where u.user_id = p_user_id and u.season_year = r.season_year and u.session = r.session
    );

  -- Details the player hasn't filled in come from the roster.
  update public.player_profiles
    set gender = coalesce(gender, g.gender), position = coalesce(position, g.position)
    where user_id = p_user_id;

  partner := coalesce(g.pays_with_user, g.pays_with_guest);
  update public.team_guests
    set linked_user_id = p_user_id, pays_with_user = null, pays_with_guest = null
    where id = p_guest_id;
  if partner is not null then
    perform public.set_dues_partner(p_user_id, partner);
  end if;
end;
$$;

revoke execute on function public.roster_current_session() from public, anon;
revoke execute on function public.roster_start_session(integer, integer) from public, anon, authenticated;
revoke execute on function public.roster_start_current() from public, anon;
revoke execute on function public.roster_follow_profile() from public, anon, authenticated;
revoke execute on function public.roster_follow_guest() from public, anon, authenticated;
grant execute on function public.roster_current_session() to authenticated, service_role;
grant execute on function public.roster_start_session(integer, integer) to service_role;
grant execute on function public.roster_start_current() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Existing sessions, up to the current one, start from today's statuses. The
-- site's data starts in October 2026, so for the session in progress that's
-- exactly right. They count as answered: nobody is asked about a session
-- that's already under way.
-- ---------------------------------------------------------------------------

do $$
declare
  cur record;
  s record;
begin
  select * into cur from public.roster_current_session();
  for s in
    select distinct x.season_year, x.session from (
      select season_year, session from public.games
      union select season_year, session from public.session_dues
      union select cur.cur_year, cur.cur_session
    ) x
    where (x.season_year, x.session) <= (cur.cur_year, cur.cur_session)
  loop
    perform public.roster_start_session(s.season_year, s.session);
  end loop;
  update public.session_roster set answered_at = now();
end;
$$;
