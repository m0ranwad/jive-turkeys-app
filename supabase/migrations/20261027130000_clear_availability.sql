-- Keep all existing roster statuses and answers. on_break now means Unavailable:
-- no automatic sub requests. Session questions use the same labels as the site.

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
          p_kind = 'subs' and a.status = 'sub_pool' and (a.answer is null or a.answer = 'maybe')
          and (hc.need_total > 0 or a.gender = 'F')
        )
      );
end;
$$;

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
    || '. Tap to choose Playing, Available to sub or Unavailable.';

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
    raise exception 'Pick Playing, Available to sub or Unavailable';
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
