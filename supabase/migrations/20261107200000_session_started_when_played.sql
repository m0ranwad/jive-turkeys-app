-- "Playing session N?" kept being asked on the day of a session's first game
-- after its score was posted, and a session counted as over as soon as nothing
-- else was on the schedule, even right after its first game while the league
-- hadn't posted the rest. Two changes, the same as the site's:
--
--   - A session has started once one of its games has been played: its score
--     is posted, or its day is over (Eastern). Until now only the day being
--     over counted, so all of game day the session still hadn't started.
--     Answers, captains asking about it and the reminders stop then.
--     (roster_session_started(), played() in src/lib/roster.js)
--   - A session is over once its games have all been played, nothing else is
--     on the schedule (captains aren't asking about the next one), and it has
--     run its course: its games cover three weeks or more, it had a game in
--     its last month (December for session 1), or the calendar has moved past
--     it. Before that an empty schedule means the rest of its games aren't up
--     yet, so status changes still count for it. (roster_session_months(),
--     sessionRanItsCourse() in src/lib/dues.js)
--
-- Only functions change: no stored rows change during the database update.

-- ---------------------------------------------------------------------------
-- A session's months on the calendar: when its last month starts and when the
-- next session's begin. Session 1 of 2026-27 is November and December 2026
-- (last month from 2026-12-01, ends 2027-01-01); session 3 ends May 1. Same as
-- sessionMonths() in src/lib/format.js.
-- ---------------------------------------------------------------------------

create or replace function public.roster_session_months(p_year integer, p_session integer, out last_month date, out ends date)
language sql
immutable
set search_path = public
as $$
  select (make_date(p_year, 11, 1) + make_interval(months => (p_session - 1) * 2 + 1))::date,
    (make_date(p_year, 11, 1) + make_interval(months => p_session * 2))::date;
$$;

revoke execute on function public.roster_session_months(integer, integer) from public, anon;
grant execute on function public.roster_session_months(integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Whether a session has started: one of its games has been played (its score
-- is posted, or its day is over in the team's time zone). Same as
-- sessionStarted() in src/lib/roster.js.
-- ---------------------------------------------------------------------------

create or replace function public.roster_session_started(p_year integer, p_session integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.games g
    where g.season_year = p_year and g.session = p_session
      and (g.has_result or g.date < (now() at time zone 'America/New_York')::date)
  );
$$;

revoke execute on function public.roster_session_started(integer, integer) from public, anon;
grant execute on function public.roster_session_started(integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The session status changes count for: the current session, unless it's
-- over. As in 20261026120000_finished_session_roster.sql, except it also has
-- to have run its course. Same as openSession() in src/lib/dues.js.
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
  m record;
  span record;
begin
  select * into cur from public.roster_current_session();
  select * into m from public.roster_session_months(cur.cur_year, cur.cur_session);
  select min(g.date) as first_game, max(g.date) as last_game into span
    from public.games g where g.season_year = cur.cur_year and g.session = cur.cur_session;
  -- Over: it has games, they've all been played, and it has run its course:
  -- they cover three weeks or more (SESSION_RUNS_DAYS), one was in its last
  -- month, or the calendar has moved past it. (With a game coming up, or a
  -- session asked about between sessions, that's the current one instead.)
  if span.last_game is not null
    and not exists (select 1 from public.games where date >= today)
    and (today >= m.ends or span.last_game >= m.last_month or span.last_game - span.first_game >= 21) then
    return;
  end if;
  open_year := cur.cur_year;
  open_session := cur.cur_session;
end;
$$;

-- ---------------------------------------------------------------------------
-- Captains asking "Playing session N?": as in 20261019120000_ask_next_session.sql,
-- except a session whose first game's score is posted has started.
-- ---------------------------------------------------------------------------

create or replace function public.roster_ask(p_year integer, p_session integer, p_starts_on date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
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
  if public.roster_session_started(p_year, p_session) then
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
-- A player's answer: as in 20261027130000_clear_availability.sql, except a
-- session whose first game's score is posted has started.
-- ---------------------------------------------------------------------------

create or replace function public.roster_answer(p_year integer, p_session integer, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  cur record;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_team_member() then
    raise exception 'Join the team first';
  end if;
  if p_status is null or p_status not in ('active', 'sub_pool', 'on_break') then
    raise exception 'Pick Playing, Available to sub or Unavailable';
  end if;
  if not exists (select 1 from public.player_profiles where user_id = me and not removed) then
    raise exception 'Make your profile first';
  end if;
  if public.roster_session_started(p_year, p_session) then
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
-- The sessions the question is open for (reminders): as in
-- 20261020200000_session_question_notifications.sql, except a session whose
-- first game's score is posted has started.
-- ---------------------------------------------------------------------------

create or replace function public.session_questions()
returns table (season_year integer, session integer, starts_on date)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
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
    where case when st.first_game is not null then not public.roster_session_started(st.y, st.s) else st.asked_on is not null end;
end;
$$;
