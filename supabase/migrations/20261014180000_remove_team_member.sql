-- Captains can take a signed-up player off the team, and add them back. A
-- removed player loses access to the site (no team data, no chat, no chat
-- notifications) and the team code no longer lets them back in. Their past
-- stats, votes, dues payments and history and chat messages stay. They come off
-- the current session's list ('off', like a removed roster name), so the dues
-- split and headcounts leave them out; past sessions keep them.

alter table public.users
  add column removed_at timestamptz;

alter table public.player_profiles
  add column removed boolean not null default false;

-- Removed accounts can't rejoin with the code. Returns 'removed' for them.
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
  if u.removed_at is not null then
    return 'removed';
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

-- Captains: take a player off the team (p_removed true) or add them back
-- (false, as Active). A captain being removed stops being a captain. Captains
-- can't remove themselves.
create or replace function public.set_team_member_removed(p_user_id uuid, p_removed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_captain() then
    raise exception 'Only captains can remove a player';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'You can''t remove yourself';
  end if;
  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'That player isn''t on the site';
  end if;

  if p_removed then
    update public.users set removed_at = now(), joined_team_at = null, role = 'user' where id = p_user_id;
    update public.player_profiles set removed = true where user_id = p_user_id;
  else
    update public.users set removed_at = null, joined_team_at = now() where id = p_user_id;
    update public.player_profiles set removed = false, status = 'active' where user_id = p_user_id;
  end if;
end;
$$;

revoke execute on function public.set_team_member_removed(uuid, boolean) from public, anon;
grant execute on function public.set_team_member_removed(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Session lists: same as 20261013225036_session_roster.sql, plus a removed
-- player is 'off' for the current session and left out of new ones.
-- ---------------------------------------------------------------------------

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
    where not p.removed
    on conflict do nothing;
  insert into public.session_roster (season_year, session, guest_id, status)
    select p_year, p_session, g.id, g.status from public.team_guests g
    where not g.removed and g.linked_user_id is null
    on conflict do nothing;
end;
$$;

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
  values (
    cur.cur_year, cur.cur_session, new.user_id,
    case when new.removed then 'off' else new.status end,
    now(), (select auth.uid())
  )
  on conflict (season_year, session, user_id) do update
    set status = excluded.status, answered_at = excluded.answered_at, changed_by = excluded.changed_by;
  return new;
end;
$$;

create or replace trigger player_profiles_roster
  after insert or update of status, removed on public.player_profiles
  for each row execute function public.roster_follow_profile();

-- ---------------------------------------------------------------------------
-- Chat notifications: same as 20261009224036_chat_push.sql, plus only phones
-- of players on the team get them.
-- ---------------------------------------------------------------------------

create or replace function public.chat_push_targets(p_message_id uuid)
returns table (
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  thread_id uuid,
  thread_title text,
  author_name text,
  body text
)
language plpgsql
set search_path = public
as $$
#variable_conflict use_column
declare
  m public.messages%rowtype;
begin
  select * into m from public.messages where id = p_message_id;
  if not found or m.created_date < now() - interval '10 minutes' then
    return;
  end if;
  insert into public.push_log (message_id) values (p_message_id) on conflict do nothing;
  if not found then
    return;
  end if;

  return query
    select s.id, s.endpoint, s.p256dh, s.auth, m.thread_id, t.title,
      coalesce(p.display_name, m.author_name, 'Player'), m.body
    from public.push_subscriptions s
    join public.users u on u.id = s.user_id and (u.joined_team_at is not null or u.role = 'admin')
    left join public.chat_threads t on t.id = m.thread_id
    left join public.player_profiles p on p.user_id = m.user_id
    where s.user_id is distinct from m.user_id
      and (
        m.thread_id is null
        or s.user_id = t.created_by
        or exists (select 1 from public.chat_reads r where r.user_id = s.user_id and r.thread_id = m.thread_id)
      )
      and not exists (
        select 1 from public.chat_reads v
        where v.user_id = s.user_id
          and v.thread_id is not distinct from m.thread_id
          and v.viewing_at > now() - interval '40 seconds'
      );
end;
$$;
