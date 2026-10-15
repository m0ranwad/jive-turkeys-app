-- Game reminders on players' phones, a set time before kickoff (6 hours
-- unless captains change it in Team Settings):
--   - Active players who haven't answered: "Are you in?"
--   - when we're short, Sub Pool and On Break players who haven't said OUT:
--     "We need 2 more players (1 woman)". If only women are short, only women
--     are asked. This one can also go out later, up to kickoff, if someone
--     drops out and we become short.
-- Each goes out once per game, only to players who kept Game alerts on, and
-- captains can turn reminders off. A timer (pg_cron, every 5 minutes,
-- game_reminders_tick()) sends them through notify-chat, which asks the
-- database who to notify (game_reminder_targets), like the other alerts.

alter table public.team_settings
  add column game_reminders boolean not null default true,
  add column game_reminder_hours integer not null default 6 check (game_reminder_hours between 1 and 48);

-- When a game kicks off: its date and time ("19:00", "7:00 PM", "7pm") in the
-- team's time zone. Null without a usable time.
create or replace function public.game_kickoff(p_date date, p_time text)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  parts text[];
  h integer;
  m integer;
begin
  parts := regexp_match(coalesce(p_time, ''), '(\d{1,2})(?::(\d{2}))?\s*([ap])?', 'i');
  if parts is null then
    return null;
  end if;
  h := parts[1]::integer;
  m := coalesce(parts[2], '0')::integer;
  if lower(parts[3]) = 'p' and h < 12 then
    h := h + 12;
  elsif lower(parts[3]) = 'a' and h = 12 then
    h := 0;
  end if;
  if h > 23 or m > 59 then
    return null;
  end if;
  return (p_date + make_time(h, m, 0)) at time zone 'America/New_York';
end;
$$;

-- Who's on the team for a game, as the headcount counts them (membersForSession()
-- in src/lib/roster.js): the game's session list if it has one, otherwise
-- everyone's status today. App players by user_id, roster names by guest_id.
create or replace function public.game_roster(p_game_id uuid)
returns table (user_id uuid, guest_id uuid, status text, gender text)
language sql
stable
security definer
set search_path = public
as $$
  with g as (
    select season_year, session from public.games where id = p_game_id
  ),
  listed as (
    select exists (
      select 1 from public.session_roster r, g where r.season_year = g.season_year and r.session = g.session
    ) as yes
  )
  select r.user_id, r.guest_id, r.status, coalesce(p.gender, t.gender)
  from public.session_roster r
  join g on r.season_year = g.season_year and r.session = g.session
  left join public.player_profiles p on p.user_id = r.user_id
  left join public.team_guests t on t.id = r.guest_id
  where (select yes from listed)
    and r.status in ('active', 'sub_pool', 'on_break')
    and (p.user_id is not null or (t.id is not null and t.linked_user_id is null))
  union all
  select p.user_id, null, p.status, p.gender
  from public.player_profiles p
  where not (select yes from listed) and not p.removed and p.status in ('active', 'sub_pool', 'on_break')
  union all
  select null, t.id, t.status, t.gender
  from public.team_guests t
  where not (select yes from listed) and not t.removed and t.linked_user_id is null
    and t.status in ('active', 'sub_pool', 'on_break');
$$;

-- Each roster player's answer for a game (null if they haven't).
create or replace function public.game_answers(p_game_id uuid)
returns table (user_id uuid, guest_id uuid, status text, gender text, answer text, playing_gk boolean)
language sql
stable
security definer
set search_path = public
as $$
  select r.user_id, r.guest_id, r.status, r.gender, v.status, coalesce(v.playing_gk, false)
  from public.game_roster(p_game_id) r
  left join public.rsvps v on v.game_id = p_game_id
    and ((r.user_id is not null and v.user_id = r.user_id) or (r.guest_id is not null and v.guest_id = r.guest_id));
$$;

-- The headcount for a game, the same as headcount() in src/lib/team-logic.js:
-- a woman playing goalie doesn't count toward the women on the field.
create or replace function public.game_headcount(
  p_game_id uuid,
  out total_in integer,
  out women_field_in integer,
  out need_total integer,
  out need_women integer
)
language sql
stable
security definer
set search_path = public
as $$
  with a as (select * from public.game_answers(p_game_id)),
  s as (
    select coalesce(t.min_players, 8) as min_players, coalesce(t.min_women, 3) as min_women
    from (select 1) one
    left join lateral (select * from public.team_settings order by created_date limit 1) t on true
  )
  select
    (select count(*) from a where answer = 'in')::integer,
    (select count(*) from a where answer = 'in' and gender = 'F' and not playing_gk)::integer,
    greatest(0, s.min_players - (select count(*) from a where answer = 'in'))::integer,
    greatest(0, s.min_women - (select count(*) from a where answer = 'in' and gender = 'F' and not playing_gk))::integer
  from s;
$$;

-- Reminders that went out, so each goes out once.
create table public.game_reminder_log (
  game_id uuid not null references public.games (id) on delete cascade,
  kind text not null check (kind in ('rsvp', 'subs')),
  created_date timestamptz not null default now(),
  primary key (game_id, kind)
);

alter table public.game_reminder_log enable row level security;
-- No policies and no grant to players: only the timer and the notification sender use it.
grant select, insert, update on public.game_reminder_log to service_role;

-- The reminder window for a game: from the set hours before kickoff until kickoff.
create or replace function public.game_reminder_due(g public.games)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(s.game_reminders, true)
    and not g.has_result
    and public.game_kickoff(g.date, g.time) is not null
    and now() >= public.game_kickoff(g.date, g.time) - make_interval(hours => coalesce(s.game_reminder_hours, 6))
    and now() < public.game_kickoff(g.date, g.time)
  from (select 1) one
  left join lateral (select * from public.team_settings order by created_date limit 1) s on true;
$$;

-- The phones to remind, with what to say. Returns nothing if it isn't time,
-- reminders are off, we aren't short (for 'subs'), or it already went out.
create or replace function public.game_reminder_targets(p_game_id uuid, p_kind text)
returns table (
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  title text,
  body text,
  url text
)
language plpgsql
set search_path = public
as $$
#variable_conflict use_column
declare
  g public.games%rowtype;
  hc record;
  t text;
  b text;
  short_by text;
  where_when text;
begin
  select * into g from public.games where id = p_game_id;
  if not found or not public.game_reminder_due(g) or p_kind not in ('rsvp', 'subs') then
    return;
  end if;
  select * into hc from public.game_headcount(p_game_id);
  if p_kind = 'subs' and hc.need_total = 0 and hc.need_women = 0 then
    return;
  end if;
  insert into public.game_reminder_log (game_id, kind) values (p_game_id, p_kind) on conflict do nothing;
  if not found then
    return;
  end if;

  where_when := public.potm_when(public.game_kickoff(g.date, g.time)) || ' vs ' || g.opponent
    || case when nullif(btrim(g.field_number), '') is null then '' else ', Field ' || btrim(g.field_number) end;
  if p_kind = 'rsvp' then
    t := '⚽ Are you in?';
    b := where_when || '. You haven''t answered yet. Tap to say IN, MAYBE or OUT.';
  else
    short_by := case
      when hc.need_total > 0 then hc.need_total || case when hc.need_total = 1 then ' more player' else ' more players' end
        || case when hc.need_women > 0 then ' (' || hc.need_women || case when hc.need_women = 1 then ' woman)' else ' women)' end else '' end
      else hc.need_women || case when hc.need_women = 1 then ' more woman' else ' more women' end
    end;
    t := '🆘 We need subs';
    b := 'We need ' || short_by || ' for ' || where_when || '. Can you play? Tap to answer.';
  end if;

  return query
    select sub.id, sub.endpoint, sub.p256dh, sub.auth, t, b, '/games/' || g.id
    from public.game_answers(p_game_id) a
    join public.users u on u.id = a.user_id and (u.joined_team_at is not null or u.role = 'admin')
    join public.push_subscriptions sub on sub.user_id = u.id
    left join public.player_profiles mine on mine.user_id = u.id
    where coalesce(mine.notify_games, true)
      and (
        (p_kind = 'rsvp' and a.status = 'active' and a.answer is null)
        or (
          p_kind = 'subs' and a.status in ('sub_pool', 'on_break') and (a.answer is null or a.answer = 'maybe')
          and (hc.need_total > 0 or a.gender = 'F')
        )
      );
end;
$$;

-- Asks notify-chat to send one reminder for a game. Never stops anything else.
create or replace function public.game_reminder_send(p_game_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://alsskultsdgcbxlukznv.supabase.co/functions/v1/notify-chat',
    body := jsonb_build_object('reminder_game_id', p_game_id, 'kind', p_kind),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
exception when others then
  raise warning 'game reminder not sent: %', sqlerrm;
end;
$$;

-- The timer: games inside their reminder window that still need a reminder.
create or replace function public.game_reminders_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.games%rowtype;
  hc record;
begin
  -- Games within a few days either side; the window itself is checked per game.
  for g in select * from public.games ga where not ga.has_result and ga.date between current_date - 1 and current_date + 3 loop
    if not public.game_reminder_due(g) then
      continue;
    end if;
    if not exists (select 1 from public.game_reminder_log l where l.game_id = g.id and l.kind = 'rsvp') then
      perform public.game_reminder_send(g.id, 'rsvp');
    end if;
    if not exists (select 1 from public.game_reminder_log l where l.game_id = g.id and l.kind = 'subs') then
      select * into hc from public.game_headcount(g.id);
      if hc.need_total > 0 or hc.need_women > 0 then
        perform public.game_reminder_send(g.id, 'subs');
      end if;
    end if;
  end loop;
end;
$$;

revoke execute on function public.game_kickoff(date, text) from public, anon;
revoke execute on function public.game_roster(uuid) from public, anon, authenticated;
revoke execute on function public.game_answers(uuid) from public, anon, authenticated;
revoke execute on function public.game_headcount(uuid) from public, anon, authenticated;
revoke execute on function public.game_reminder_due(public.games) from public, anon, authenticated;
revoke execute on function public.game_reminder_targets(uuid, text) from public, anon, authenticated;
revoke execute on function public.game_reminder_send(uuid, text) from public, anon, authenticated;
revoke execute on function public.game_reminders_tick() from public, anon, authenticated;
grant execute on function public.game_kickoff(date, text) to authenticated, service_role;
grant execute on function public.game_roster(uuid) to service_role;
grant execute on function public.game_answers(uuid) to service_role;
grant execute on function public.game_headcount(uuid) to service_role;
grant execute on function public.game_reminder_due(public.games) to service_role;
grant execute on function public.game_reminder_targets(uuid, text) to service_role;

-- Every 5 minutes, like the Player of the Match timer. pg_cron is on Supabase;
-- the test databases don't have it, and their tests call game_reminders_tick().
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('game-reminders', '*/5 * * * *', 'select public.game_reminders_tick()');
  end if;
end;
$$;
