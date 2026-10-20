-- "Playing session N?" on players' phones, under Game alerts:
--   - When captains ask about a session ahead (roster_ask()), everyone on its
--     list hears about it right away: "Session 2 starts Sat, Jan 2. Tap to say
--     I'm in, Sub only or Sitting out." The captain who asked doesn't.
--   - At noon (Eastern) a week before the session starts, anyone who still
--     hasn't answered gets a reminder. That's whenever the question is open,
--     as the site asks it: asked ahead by captains, or opened on its own once
--     the new session's schedule is up and its first game is next. If it opens
--     later than that, the reminder goes out at the next chance between noon
--     and 9 PM, at least a day after the "captains asked" one, and never on
--     the first game's day (the game reminders cover that day).
-- The start is the first game's date once the schedule is up, else the date
-- captains gave. Each goes out once per session, only to players who kept Game
-- alerts on. A timer (pg_cron, every 5 minutes, session_asks_tick()) sends the
-- reminders through notify-chat, which asks the database who to notify
-- (session_ask_targets()), like the game reminders.

-- Notifications that went out, so each goes out once per session.
create table public.session_ask_log (
  season_year integer not null,
  session integer not null,
  kind text not null check (kind in ('asked', 'reminder')),
  created_date timestamptz not null default now(),
  primary key (season_year, session, kind)
);

alter table public.session_ask_log enable row level security;
-- No policies and no grant to players: only the timer and the notification
-- sender use it, like game_reminder_log.
grant select, insert, update on public.session_ask_log to service_role;

-- The sessions "Playing session N?" is open for, the way the site asks it
-- (sessionAsk() in src/components/SessionPrompt.jsx): the current session,
-- and the earliest later one captains asked about. Each until its first game
-- is played, and only with a start: its first game's date, else the date
-- captains gave.
create or replace function public.session_questions()
returns table (season_year integer, session integer, starts_on date)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  today date := (now() at time zone 'America/New_York')::date;
  cur record;
begin
  select * into cur from public.roster_current_session();
  return query
    with periods as (
      select cur.cur_year as y, cur.cur_session as s
      union
      (select a.season_year, a.session from public.session_asks a
        where a.starts_on is not null and (a.season_year, a.session) > (cur.cur_year, cur.cur_session)
        order by a.starts_on, a.season_year, a.session
        limit 1)
    ),
    starts as (
      select p.y, p.s,
        (select min(g.date) from public.games g where g.season_year = p.y and g.session = p.s) as first_game,
        (select a.starts_on from public.session_asks a where a.season_year = p.y and a.session = p.s) as asked_on
      from periods p
    )
    select st.y, st.s, coalesce(st.first_game, st.asked_on)
    from starts st
    where case when st.first_game is not null then st.first_game >= today else st.asked_on is not null end;
end;
$$;

-- Whether the reminder for a session starting on p_start is due at p_at: from
-- noon (Eastern) a week before, between noon and 9 PM, before the first game's
-- day, and at least a day after the "captains asked" notification.
create or replace function public.session_reminder_due(p_year integer, p_session integer, p_start date, p_at timestamptz default now())
returns boolean
language sql
stable
set search_path = public
as $$
  select p_at >= ((p_start - 7) + time '12:00') at time zone 'America/New_York'
    and (p_at at time zone 'America/New_York')::date < p_start
    and extract(hour from p_at at time zone 'America/New_York') between 12 and 20
    and not exists (
      select 1 from public.session_ask_log l
      where l.season_year = p_year and l.session = p_session and l.kind = 'asked'
        and l.created_date > p_at - interval '1 day'
    );
$$;

-- The phones to notify, with what to say. Returns nothing if captains aren't
-- asking about it ('asked'), it isn't time ('reminder'), or it already went out.
create or replace function public.session_ask_targets(p_year integer, p_session integer, p_kind text, p_at timestamptz default now())
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
  starts date;
  asker uuid;
  t text;
  b text;
begin
  if p_kind = 'asked' then
    -- Captains are asking about it, and it hasn't started.
    select coalesce((select min(g.date) from public.games g where g.season_year = p_year and g.session = p_session), a.starts_on),
      a.asked_by
      into starts, asker
      from public.session_asks a
      where a.season_year = p_year and a.session = p_session and a.starts_on is not null;
    if starts is null or starts < (p_at at time zone 'America/New_York')::date then
      return;
    end if;
  elsif p_kind = 'reminder' then
    select q.starts_on into starts from public.session_questions() q where q.season_year = p_year and q.session = p_session;
    if starts is null or not public.session_reminder_due(p_year, p_session, starts, p_at) then
      return;
    end if;
  else
    return;
  end if;
  insert into public.session_ask_log (season_year, session, kind) values (p_year, p_session, p_kind) on conflict do nothing;
  if not found then
    return;
  end if;
  -- Its list, in case nobody has opened the site since the schedule went up.
  perform public.roster_start_session(p_year, p_session);

  t := '📋 Playing session ' || p_session || '?';
  b := 'Session ' || p_session || ' starts ' || to_char(starts, 'Dy, Mon FMDD')
    || case when p_kind = 'reminder' then ' and you haven''t answered yet' else '' end
    || '. Tap to say I''m in, Sub only or Sitting out.';

  return query
    select sub.id, sub.endpoint, sub.p256dh, sub.auth, t, b, '/'
    from public.session_roster r
    join public.users u on u.id = r.user_id and (u.joined_team_at is not null or u.role = 'admin')
    join public.player_profiles mine on mine.user_id = r.user_id and not mine.removed
    join public.push_subscriptions sub on sub.user_id = r.user_id
    where r.season_year = p_year and r.session = p_session
      and r.status in ('active', 'sub_pool', 'on_break')
      and coalesce(mine.notify_games, true)
      and case when p_kind = 'asked' then r.user_id is distinct from asker else r.answered_at is null end;
end;
$$;

-- Asks notify-chat to send one of them. Never stops anything else.
create or replace function public.session_ask_send(p_year integer, p_session integer, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://alsskultsdgcbxlukznv.supabase.co/functions/v1/notify-chat',
    body := jsonb_build_object('session_ask', jsonb_build_object('year', p_year, 'session', p_session), 'kind', p_kind),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
exception when others then
  raise warning 'session question notification not sent: %', sqlerrm;
end;
$$;

-- Captains asking: the first time they ask about a session, not when they
-- change its date. The request goes out once the ask is saved, so the
-- session's list (started by roster_ask()) is there by then.
create or replace function public.session_asks_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.starts_on is not null and (tg_op = 'INSERT' or old.starts_on is null)
    and not exists (
      select 1 from public.session_ask_log l
      where l.season_year = new.season_year and l.session = new.session and l.kind = 'asked'
    )
  then
    perform public.session_ask_send(new.season_year, new.session, 'asked');
  end if;
  return null;
end;
$$;

create trigger session_asks_notify after insert or update of starts_on on public.session_asks
  for each row execute function public.session_asks_notify();

-- The timer: open questions whose reminder is due and hasn't gone out.
create or replace function public.session_asks_tick(p_at timestamptz default now())
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  q record;
begin
  for q in select * from public.session_questions() loop
    if not exists (
      select 1 from public.session_ask_log l
      where l.season_year = q.season_year and l.session = q.session and l.kind = 'reminder'
    ) and public.session_reminder_due(q.season_year, q.session, q.starts_on, p_at) then
      perform public.session_ask_send(q.season_year, q.session, 'reminder');
    end if;
  end loop;
end;
$$;

revoke execute on function public.session_questions() from public, anon, authenticated;
revoke execute on function public.session_reminder_due(integer, integer, date, timestamptz) from public, anon, authenticated;
revoke execute on function public.session_ask_targets(integer, integer, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.session_ask_send(integer, integer, text) from public, anon, authenticated;
revoke execute on function public.session_asks_notify() from public, anon, authenticated;
revoke execute on function public.session_asks_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.session_questions() to service_role;
grant execute on function public.session_reminder_due(integer, integer, date, timestamptz) to service_role;
grant execute on function public.session_ask_targets(integer, integer, text, timestamptz) to service_role;

-- Every 5 minutes, like the game reminders. pg_cron is already turned on
-- (20261015120000_potm_voting_window.sql); the test databases don't have it,
-- and their tests call session_asks_tick(). Don't run "create extension
-- pg_cron" again: on Supabase it fails with "dependent privileges exist".
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('session-reminders', '*/5 * * * *', 'select public.session_asks_tick()');
  end if;
end;
$$;
