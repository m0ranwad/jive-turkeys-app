-- Player of the Match voting closes. When a captain posts a result, voting
-- opens for a set number of hours (12 unless captains change it in Team
-- Settings), and:
--   - everyone on the team with notifications on is told it's open and until when;
--   - a few hours before it closes (3 unless changed), players who played and
--     haven't voted are reminded;
--   - when it closes, the winners are posted in Team Chat.
-- Each of these can be turned off in Team Settings. Games whose result was
-- posted before this change have no deadline, as before.
--
-- The reminder and the announcement run on a timer (pg_cron, every 5 minutes,
-- potm_tick()). Notifications go through the notify-chat function, which asks
-- the database who to notify (potm_push_targets), like chat messages.

alter table public.team_settings
  add column potm_window_hours integer not null default 12 check (potm_window_hours between 1 and 168),
  add column potm_notify boolean not null default true,
  -- Hours before voting closes to remind players who haven't voted; 0 is off.
  add column potm_reminder_hours integer not null default 3 check (potm_reminder_hours between 0 and 48),
  add column potm_announce boolean not null default true;

alter table public.games
  add column potm_opened_at timestamptz,
  add column potm_closes_at timestamptz;

-- The team's settings, with the defaults when there's no settings row yet.
create or replace function public.potm_settings(
  out window_hours integer,
  out notify boolean,
  out reminder_hours integer,
  out announce boolean,
  out mode text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(s.potm_window_hours, 12),
    coalesce(s.potm_notify, true),
    coalesce(s.potm_reminder_hours, 3),
    coalesce(s.potm_announce, true),
    coalesce(s.potm_mode, 'separate')
  from (select 1) one
  left join lateral (select * from public.team_settings order by created_date limit 1) s on true;
$$;

-- Voting is open until the deadline. No deadline (results posted before this
-- change) means open, as before.
create or replace function public.potm_voting_open(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select g.potm_closes_at > now() from public.games g where g.id = p_game_id), true);
$$;

-- "Fri 9:30 AM", in the team's time zone (the complex is in Ohio).
create or replace function public.potm_when(p_at timestamptz)
returns text
language sql
stable
set search_path = public
as $$
  select to_char(p_at at time zone 'America/New_York', 'Dy FMHH12:MI AM');
$$;

-- "5–3 W vs Ball Busters"
create or replace function public.potm_matchup(g public.games)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(g.score_us, 0) || '–' || coalesce(g.score_them, 0) || ' '
    || case when coalesce(g.score_us, 0) > coalesce(g.score_them, 0) then 'W'
            when coalesce(g.score_us, 0) < coalesce(g.score_them, 0) then 'L' else 'D' end
    || ' vs ' || g.opponent;
$$;

-- ---------------------------------------------------------------------------
-- Votes: only while voting is open. Captains can still remove a vote.
-- Otherwise as in 20261014031844_guests_in_games.sql.
-- ---------------------------------------------------------------------------

alter policy potm_insert on public.potm_votes
  with check (
    voter_id = (select auth.uid()) and voted_for_id is distinct from voter_id and (select public.is_team_member())
    and public.potm_voting_open(game_id)
  );
alter policy potm_update on public.potm_votes
  using (voter_id = (select auth.uid()) and (select public.is_team_member()) and public.potm_voting_open(game_id))
  with check (
    voter_id = (select auth.uid()) and voted_for_id is distinct from voter_id and (select public.is_team_member())
    and public.potm_voting_open(game_id)
  );
alter policy potm_delete on public.potm_votes
  using (
    (voter_id = (select auth.uid()) and (select public.is_team_member()) and public.potm_voting_open(game_id))
    or (select public.is_captain())
  );

-- ---------------------------------------------------------------------------
-- Notifications: which ones went out, so each goes out once.
-- ---------------------------------------------------------------------------

create table public.potm_push_log (
  game_id uuid not null references public.games (id) on delete cascade,
  kind text not null check (kind in ('open', 'reminder', 'winner')),
  created_date timestamptz not null default now(),
  primary key (game_id, kind)
);

alter table public.potm_push_log enable row level security;
-- No policies and no grant to players: only the timer and the notification sender use it.
grant select, insert, update on public.potm_push_log to service_role;

-- Asks notify-chat to send one kind of notification for a game. Never stops
-- the result from saving.
create or replace function public.potm_send(p_game_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://alsskultsdgcbxlukznv.supabase.co/functions/v1/notify-chat',
    body := jsonb_build_object('potm_game_id', p_game_id, 'kind', p_kind),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
exception when others then
  raise warning 'Player of the Match notification not sent: %', sqlerrm;
end;
$$;

-- The phones to notify, with what to say. Returns nothing if it isn't time, the
-- team turned it off, or it already went out.
--   'open':     everyone on the team, right after the result is posted.
--   'reminder': players who played and haven't cast every vote, in the last hours.
create or replace function public.potm_push_targets(p_game_id uuid, p_kind text)
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
  s record;
  awards integer;
  t text;
  b text;
begin
  select * into g from public.games where id = p_game_id;
  if not found or not g.has_result or g.potm_closes_at is null or g.potm_closes_at <= now() then
    return;
  end if;
  select * into s from public.potm_settings();
  if p_kind = 'open' then
    if not s.notify or g.potm_opened_at < now() - interval '1 hour' then
      return;
    end if;
    t := '🏆 Player of the Match';
    b := 'Final: ' || public.potm_matchup(g) || '. Voting is open until ' || public.potm_when(g.potm_closes_at) || '.';
  elsif p_kind = 'reminder' then
    if s.reminder_hours <= 0 or now() < g.potm_closes_at - make_interval(hours => s.reminder_hours) then
      return;
    end if;
    t := '🏆 Voting closes in ' || s.reminder_hours || case when s.reminder_hours = 1 then ' hour' else ' hours' end;
    b := 'You haven''t voted for Player of the Match (' || public.potm_matchup(g) || '). Voting closes '
      || public.potm_when(g.potm_closes_at) || '.';
  else
    return;
  end if;

  insert into public.potm_push_log (game_id, kind) values (p_game_id, p_kind) on conflict do nothing;
  if not found then
    return;
  end if;

  awards := case when s.mode = 'overall' then 1 else 2 end;
  return query
    select sub.id, sub.endpoint, sub.p256dh, sub.auth, t, b, '/games/' || g.id
    from public.push_subscriptions sub
    join public.users u on u.id = sub.user_id and (u.joined_team_at is not null or u.role = 'admin')
    where p_kind = 'open'
      or (
        exists (select 1 from public.game_stats st where st.game_id = g.id and st.user_id = u.id and st.played)
        and (select count(*) from public.potm_votes v where v.game_id = g.id and v.voter_id = u.id) < awards
      );
end;
$$;

-- "🏆 Player of the Match, 5–3 W vs Ball Busters" and one line per award with
-- the most-voted (ties share it). Null if nobody voted.
create or replace function public.potm_winners_message(p_game_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  with tally as (
    select v.award, coalesce(v.voted_for_id, v.voted_for_guest_id) as who,
      coalesce(p.display_name, tg.display_name, 'Unknown') as name, count(*) as n
    from public.potm_votes v
    left join public.player_profiles p on p.user_id = v.voted_for_id
    left join public.team_guests tg on tg.id = v.voted_for_guest_id
    where v.game_id = p_game_id
    group by 1, 2, 3
  ),
  ranked as (
    select award, name, n, rank() over (partition by award order by n desc) as r from tally
  ),
  winners as (
    select award,
      case award when 'overall' then 'Player of the Match' when 'man' then 'Man of the Match' else 'Woman of the Match' end
        || ': ' || string_agg(name, ' & ' order by name)
        || ' (' || max(n) || case when max(n) = 1 then ' vote' else ' votes' end
        || case when count(*) > 1 then ' each, tied)' else ')' end as line
    from ranked where r = 1
    group by award
  )
  select '🏆 Player of the Match, ' || (select public.potm_matchup(g) from public.games g where g.id = p_game_id) || E'\n'
    || string_agg(w.line, E'\n' order by case w.award when 'overall' then 0 when 'man' then 1 else 2 end)
  from winners w;
$$;

-- ---------------------------------------------------------------------------
-- Posting a result opens voting (once per game) and tells the team.
-- Only a result posted on an existing game: importing old games with scores
-- doesn't.
-- ---------------------------------------------------------------------------

create or replace function public.potm_open_voting()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.has_result and not old.has_result and new.potm_opened_at is null then
    new.potm_opened_at := now();
    new.potm_closes_at := now() + make_interval(hours => (select window_hours from public.potm_settings()));
  end if;
  return new;
end;
$$;

create or replace function public.potm_notify_open()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.potm_opened_at is not null and old.potm_opened_at is null and (select notify from public.potm_settings()) then
    perform public.potm_send(new.id, 'open');
  end if;
  return new;
end;
$$;

create trigger games_potm_open before update of has_result on public.games
  for each row execute function public.potm_open_voting();

create trigger games_potm_notify after update of has_result on public.games
  for each row execute function public.potm_notify_open();

-- ---------------------------------------------------------------------------
-- The timer: reminders before voting closes, and the winners once it has.
-- ---------------------------------------------------------------------------

create or replace function public.potm_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  g record;
  message text;
begin
  select * into s from public.potm_settings();

  if s.reminder_hours > 0 then
    for g in
      select ga.id from public.games ga
      where ga.has_result and ga.potm_closes_at > now()
        and ga.potm_closes_at - make_interval(hours => s.reminder_hours) <= now()
        -- A reminder as long as the whole window would go out with the result.
        and ga.potm_closes_at - make_interval(hours => s.reminder_hours) > ga.potm_opened_at
        and not exists (select 1 from public.potm_push_log l where l.game_id = ga.id and l.kind = 'reminder')
    loop
      perform public.potm_send(g.id, 'reminder');
    end loop;
  end if;

  -- Voting that closed in the last day (so turning this on doesn't announce old games).
  for g in
    select ga.id from public.games ga
    where ga.potm_closes_at <= now() and ga.potm_closes_at > now() - interval '1 day'
      and not exists (select 1 from public.potm_push_log l where l.game_id = ga.id and l.kind = 'winner')
  loop
    insert into public.potm_push_log (game_id, kind) values (g.id, 'winner') on conflict do nothing;
    if s.announce then
      message := public.potm_winners_message(g.id);
      if message is not null then
        -- From the site rather than a player; it notifies like any Team Chat message.
        insert into public.messages (user_id, author_name, body) values (null, 'Scoreboard', message);
      end if;
    end if;
  end loop;
end;
$$;

revoke execute on function public.potm_settings() from public, anon;
revoke execute on function public.potm_voting_open(uuid) from public, anon;
revoke execute on function public.potm_when(timestamptz) from public, anon;
revoke execute on function public.potm_matchup(public.games) from public, anon;
revoke execute on function public.potm_winners_message(uuid) from public, anon, authenticated;
revoke execute on function public.potm_send(uuid, text) from public, anon, authenticated;
revoke execute on function public.potm_push_targets(uuid, text) from public, anon, authenticated;
revoke execute on function public.potm_open_voting() from public, anon, authenticated;
revoke execute on function public.potm_notify_open() from public, anon, authenticated;
revoke execute on function public.potm_tick() from public, anon, authenticated;
grant execute on function public.potm_settings() to authenticated, service_role;
grant execute on function public.potm_voting_open(uuid) to authenticated, service_role;
grant execute on function public.potm_when(timestamptz) to authenticated, service_role;
grant execute on function public.potm_matchup(public.games) to authenticated, service_role;
grant execute on function public.potm_push_targets(uuid, text) to service_role;

-- Every 5 minutes. pg_cron is on Supabase (free plan included); the test
-- databases don't have it, and their tests call potm_tick() themselves.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    -- As Supabase's docs set it up.
    create extension if not exists pg_cron with schema pg_catalog;
    grant usage on schema cron to postgres;
    grant all privileges on all tables in schema cron to postgres;
    perform cron.schedule('potm-voting', '*/5 * * * *', 'select public.potm_tick()');
  end if;
end;
$$;
