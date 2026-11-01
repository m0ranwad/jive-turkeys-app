-- A heads-up for captains when someone new joins as Playing while a session is
-- open: they now split its dues, and if they're really a fan, partner or friend
-- who tapped Playing, captains can fix it before people pay. The site posts it
-- in the Captains' Lounge, so every captain sees it and gets it like any
-- Lounge message. Rules: docs/dues.md section 2.

-- Who captains were told about, so it's said once. No policies and no grant to
-- players: only tell_captains_new_player() uses it, like session_ask_log.
create table public.new_player_notices (
  user_id uuid primary key references public.users (id) on delete cascade,
  season_year integer not null,
  session integer not null,
  created_date timestamptz not null default now()
);

alter table public.new_player_notices enable row level security;
grant select, insert, update on public.new_player_notices to service_role;

-- Called by the sign-up screen once a new player's profile is saved (and their
-- roster name picked, if they picked one). The database decides whether to say
-- anything: only for someone who joined in the last hour, is Playing, and
-- didn't pick a roster name (a roster name brings the status a captain gave
-- it), while a session is open (status changes count for it), once.
create or replace function public.tell_captains_new_player()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  p public.player_profiles;
  cur record;
  lounge uuid;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_team_member() then
    raise exception 'Join the team first';
  end if;

  select * into p from public.player_profiles where user_id = me;
  if p.id is null or p.removed or p.status <> 'active'
    or p.created_date < now() - interval '1 hour'
    or public.is_captain()
    or exists (select 1 from public.team_guests where linked_user_id = me) then
    return;
  end if;

  select * into cur from public.roster_open_session();
  select id into lounge from public.chat_threads where visibility = 'captains';
  if cur.open_year is null or lounge is null then
    return;
  end if;

  insert into public.new_player_notices (user_id, season_year, session)
    values (me, cur.open_year, cur.open_session)
    on conflict (user_id) do nothing;
  if not found then
    return;
  end if;

  insert into public.messages (thread_id, user_id, author_name, body)
    values (
      lounge, null, 'Roster',
      format(
        '👋 %s just joined and said they''re Playing, so they now split session %s''s dues. '
          || 'If they''re not playing, change their status on the Team page before people pay.',
        p.display_name, cur.open_session
      )
    );
end;
$$;

revoke execute on function public.tell_captains_new_player() from public, anon;
grant execute on function public.tell_captains_new_player() to authenticated, service_role;
