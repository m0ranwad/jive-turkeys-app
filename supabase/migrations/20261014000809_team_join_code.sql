-- Only teammates get in. A new account enters the team code (captains see it
-- in Team Settings, and Copy invite includes it) before it can see anything
-- about the team. Everyone already signed up is let in, and captains always
-- are. Team data that any signed-in account could read is now members only.

alter table public.users
  add column joined_team_at timestamptz,
  -- Wrong codes in a row, and when someone who tried too many can try again.
  add column join_tries integer not null default 0,
  add column join_blocked_until timestamptz;

update public.users set joined_team_at = now();

create or replace function public.is_team_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and (joined_team_at is not null or role = 'admin')
  );
$$;

-- The first account on a fresh install is a captain, so it's in too.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  first boolean := not exists (select 1 from public.users);
begin
  insert into public.users (id, email, full_name, role, joined_team_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    case when first then 'admin' else 'user' end,
    case when first then now() end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The code: one row. Members can read it (Copy invite includes it); captains
-- change it, for example each new session so old invites stop working.
-- ---------------------------------------------------------------------------

create table public.team_join_code (
  id uuid primary key default gen_random_uuid(),
  code text not null check (char_length(btrim(code)) between 4 and 40),
  updated_by uuid references public.users (id) on delete set null,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create unique index team_join_code_one on public.team_join_code ((true));

create trigger team_join_code_touch before update on public.team_join_code
  for each row execute function public.touch_updated_date();

alter table public.team_join_code enable row level security;
create policy team_join_code_select on public.team_join_code for select to authenticated
  using ((select public.is_team_member()));
create policy team_join_code_captains on public.team_join_code for all to authenticated
  using ((select public.is_captain())) with check ((select public.is_captain()));
grant select, insert, update, delete on public.team_join_code to authenticated, service_role;

-- A random starting code (this file is public). Captains see it in Team Settings.
insert into public.team_join_code (code)
select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::integer, 1), '')
from generate_series(1, 6);

-- Joins the team with the code. Returns 'joined', 'wrong' or 'blocked'
-- (after 10 wrong codes in a row, no more tries for an hour). It returns
-- rather than raising so the count of wrong tries is kept.
create or replace function public.join_team(p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  u public.users;
  tries integer;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  select * into u from public.users where id = me for update;
  if u.id is null then
    raise exception 'Not signed in';
  end if;
  if u.joined_team_at is not null then
    return 'joined';
  end if;
  if u.join_blocked_until > now() then
    return 'blocked';
  end if;
  if exists (select 1 from public.team_join_code c where lower(btrim(c.code)) = lower(btrim(p_code))) then
    update public.users set joined_team_at = now(), join_tries = 0, join_blocked_until = null where id = me;
    return 'joined';
  end if;
  -- After a block runs out, the count starts over.
  tries := case when u.join_blocked_until is not null then 0 else u.join_tries end + 1;
  if tries >= 10 then
    update public.users set join_tries = 0, join_blocked_until = now() + interval '1 hour' where id = me;
    return 'blocked';
  end if;
  update public.users set join_tries = tries, join_blocked_until = null where id = me;
  return 'wrong';
end;
$$;

revoke execute on function public.is_team_member() from public, anon;
revoke execute on function public.join_team(text) from public, anon;
grant execute on function public.is_team_member() to authenticated, service_role;
grant execute on function public.join_team(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Team data: members only. Captains' rules and each player's own read markers
-- stay as they were.
-- ---------------------------------------------------------------------------

alter policy profiles_select on public.player_profiles using ((select public.is_team_member()));
alter policy team_settings_select on public.team_settings using ((select public.is_team_member()));
alter policy games_select on public.games using ((select public.is_team_member()));
alter policy game_stats_select on public.game_stats using ((select public.is_team_member()));
alter policy announcements_select on public.announcements using ((select public.is_team_member()));
alter policy rsvps_select on public.rsvps using ((select public.is_team_member()));
alter policy potm_select on public.potm_votes using ((select public.is_team_member()));
alter policy messages_select on public.messages using ((select public.is_team_member()));
alter policy chat_threads_select on public.chat_threads using ((select public.is_team_member()));
alter policy message_reactions_select on public.message_reactions using ((select public.is_team_member()));
alter policy session_dues_select on public.session_dues using ((select public.is_team_member()));
alter policy dues_payments_select on public.dues_payments using ((select public.is_team_member()));
alter policy dues_history_select on public.dues_history using ((select public.is_team_member()));
alter policy team_guests_select on public.team_guests using ((select public.is_team_member()));
alter policy session_roster_select on public.session_roster using ((select public.is_team_member()));

-- What players write about themselves: members only too.
alter policy profiles_insert on public.player_profiles
  with check ((user_id = (select auth.uid()) and (select public.is_team_member())) or (select public.is_captain()));
alter policy profiles_update on public.player_profiles
  using ((user_id = (select auth.uid()) and (select public.is_team_member())) or (select public.is_captain()))
  with check ((user_id = (select auth.uid()) and (select public.is_team_member())) or (select public.is_captain()));

alter policy rsvps_insert on public.rsvps
  with check ((user_id = (select auth.uid()) and (select public.is_team_member())) or (select public.is_captain()));
alter policy rsvps_update on public.rsvps
  using ((user_id = (select auth.uid()) and (select public.is_team_member())) or (select public.is_captain()))
  with check ((user_id = (select auth.uid()) and (select public.is_team_member())) or (select public.is_captain()));
alter policy rsvps_delete on public.rsvps
  using ((user_id = (select auth.uid()) and (select public.is_team_member())) or (select public.is_captain()));

alter policy potm_insert on public.potm_votes
  with check (voter_id = (select auth.uid()) and voted_for_id <> voter_id and (select public.is_team_member()));
alter policy potm_update on public.potm_votes
  using (voter_id = (select auth.uid()) and (select public.is_team_member()))
  with check (voter_id = (select auth.uid()) and voted_for_id <> voter_id and (select public.is_team_member()));
alter policy potm_delete on public.potm_votes
  using ((voter_id = (select auth.uid()) and (select public.is_team_member())) or (select public.is_captain()));

alter policy messages_insert on public.messages
  with check (
    user_id = (select auth.uid())
    and (select public.is_team_member())
    and (
      messages.thread_id is null
      or exists (select 1 from public.chat_threads t where t.id = messages.thread_id and not t.archived)
    )
  );
alter policy messages_delete on public.messages
  using ((user_id = (select auth.uid()) and (select public.is_team_member())) or (select public.is_captain()));

alter policy chat_threads_insert on public.chat_threads
  with check (created_by = (select auth.uid()) and (select public.is_team_member()));
alter policy chat_threads_update on public.chat_threads
  using ((created_by = (select auth.uid()) and (select public.is_team_member())) or (select public.is_captain()))
  with check ((created_by = (select auth.uid()) and (select public.is_team_member())) or (select public.is_captain()));
alter policy chat_threads_delete on public.chat_threads
  using ((created_by = (select auth.uid()) and (select public.is_team_member())) or (select public.is_captain()));

alter policy message_reactions_insert on public.message_reactions
  with check (user_id = (select auth.uid()) and (select public.is_team_member()));
alter policy message_reactions_delete on public.message_reactions
  using ((user_id = (select auth.uid()) and (select public.is_team_member())) or (select public.is_captain()));

-- Only members' phones get chat notifications. Anyone can still remove their own device.
alter policy push_subscriptions_own on public.push_subscriptions
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select public.is_team_member()));

-- ---------------------------------------------------------------------------
-- The functions players call that change team data: same as before, members
-- only. Bodies as in 20261010141838_team_guests.sql, 20261009224036_chat_push.sql
-- and 20261013225036_session_roster.sql.
-- ---------------------------------------------------------------------------

create or replace function public.mark_dues_paid(
  p_season_year integer,
  p_session integer,
  p_user_ids uuid[],
  p_paid boolean,
  p_paid_date date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_team_member() then
    raise exception 'Join the team first';
  end if;

  -- App players.
  with changing as (
    select u.id
    from public.users u
    left join public.dues_payments d
      on d.season_year = p_season_year and d.session = p_session and d.user_id = u.id
    where u.id = any (p_user_ids) and coalesce(d.paid, false) <> p_paid
  ),
  saved as (
    insert into public.dues_payments (season_year, session, user_id, paid, paid_date, paid_by)
    select p_season_year, p_session, c.id, p_paid,
      case when p_paid then coalesce(p_paid_date, current_date) end,
      case when p_paid then me end
    from changing c
    on conflict (season_year, session, user_id) do update
      set paid = excluded.paid, paid_date = excluded.paid_date, paid_by = excluded.paid_by
    returning user_id, paid, paid_date
  )
  insert into public.dues_history (season_year, session, user_id, paid, paid_date, changed_by)
  select p_season_year, p_session, s.user_id, s.paid, s.paid_date, me
  from saved s;

  -- Teammates who aren't on the app.
  with changing as (
    select g.id
    from public.team_guests g
    left join public.dues_payments d
      on d.season_year = p_season_year and d.session = p_session and d.guest_id = g.id
    where g.id = any (p_user_ids) and coalesce(d.paid, false) <> p_paid
  ),
  saved as (
    insert into public.dues_payments (season_year, session, guest_id, paid, paid_date, paid_by)
    select p_season_year, p_session, c.id, p_paid,
      case when p_paid then coalesce(p_paid_date, current_date) end,
      case when p_paid then me end
    from changing c
    on conflict (season_year, session, guest_id) do update
      set paid = excluded.paid, paid_date = excluded.paid_date, paid_by = excluded.paid_by
    returning guest_id, paid, paid_date
  )
  insert into public.dues_history (season_year, session, guest_id, paid, paid_date, changed_by)
  select p_season_year, p_session, s.guest_id, s.paid, s.paid_date, me
  from saved s;
end;
$$;

create or replace function public.set_dues_partner(p_user_id uuid, p_partner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ids uuid[] := array[p_user_id, p_partner_id];
begin
  if (select auth.uid()) is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_team_member() then
    raise exception 'Join the team first';
  end if;

  update public.player_profiles set pays_with = null, pays_with_guest = null
    where user_id = any (ids) or pays_with = any (ids) or pays_with_guest = any (ids);
  update public.team_guests set pays_with_user = null, pays_with_guest = null
    where id = any (ids) or pays_with_user = any (ids) or pays_with_guest = any (ids);

  if p_partner_id is null or p_partner_id = p_user_id then
    return;
  end if;

  -- Each side points at the other, in the column for the other's kind.
  update public.player_profiles p set
      pays_with = case when other.id in (select id from public.users) then other.id end,
      pays_with_guest = case when other.id in (select id from public.team_guests) then other.id end
    from (values (p_user_id, p_partner_id), (p_partner_id, p_user_id)) as other(self, id)
    where p.user_id = other.self;
  update public.team_guests g set
      pays_with_user = case when other.id in (select id from public.users) then other.id end,
      pays_with_guest = case when other.id in (select id from public.team_guests) then other.id end
    from (values (p_user_id, p_partner_id), (p_partner_id, p_user_id)) as other(self, id)
    where g.id = other.self;
end;
$$;

create or replace function public.claim_team_guest(p_guest_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  roster_status text;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_team_member() then
    raise exception 'Join the team first';
  end if;
  select status into roster_status from public.team_guests where id = p_guest_id and not removed;
  if roster_status is null then
    raise exception 'That name is no longer on the roster';
  end if;
  perform public.move_team_guest(p_guest_id, me);
  update public.player_profiles set status = roster_status where user_id = me;
end;
$$;

create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  select (select auth.uid()), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300)
  where (select auth.uid()) is not null and public.is_team_member()
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
$$;

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
  return jsonb_build_object('season_year', cur.cur_year, 'session', cur.cur_session);
end;
$$;
