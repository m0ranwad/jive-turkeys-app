-- With no games on the schedule at all, the current session is the session
-- today is in (#125), not the calendar year's first: January to April belong
-- to the season that started the November before, so January 2027 is
-- 2026-27 session 2, not 2027-28 session 1. Replacing the functions changes no
-- stored rows during the database update.

-- ---------------------------------------------------------------------------
-- The session a date is in: November and December are its season's first,
-- January and February the second, March and April the third. May to October
-- count for the first of the season coming up. Seasons are filed under the
-- year they start in. Same as sessionOf() in src/lib/format.js.
-- ---------------------------------------------------------------------------

create or replace function public.roster_session_of(d date, out cur_year integer, out cur_session integer)
language sql
immutable
set search_path = public
as $$
  select
    case when extract(month from d) >= 5 then extract(year from d) else extract(year from d) - 1 end::integer,
    case when extract(month from d) >= 5 then 1 when extract(month from d) <= 2 then 2 else 3 end;
$$;

revoke execute on function public.roster_session_of(date) from public, anon;
grant execute on function public.roster_session_of(date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The current session: the next game's; between sessions, the earliest later
-- session captains asked about; else the latest game's; else, with no games at
-- all, the session today is in. Same as currentSession() in src/lib/dues.js,
-- with "today" in the team's time zone.
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
  if latest_year is not null then
    cur_year := latest_year;
    cur_session := latest_session;
    return;
  end if;
  select s.cur_year, s.cur_session into cur_year, cur_session from public.roster_session_of(today) s;
end;
$$;
