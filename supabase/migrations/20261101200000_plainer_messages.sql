-- Plainer words for what the site sends and posts on its own, so it reads like a
-- teammate wrote it: no field number (there are only two), no "Tap to …", no
-- emoji except the 🏆 for Player of the Match, and the shortage worded the way
-- the game page says it ("We need 2 more, including a girl"). Who gets each one,
-- and when, is the same as before; nothing is stored differently.
-- Rules: docs/games.md sections 5 and 6, docs/chat.md section 7, docs/dues.md section 2.

-- ---------------------------------------------------------------------------
-- How a game went, two ways. Losses put our score second, as people say it.
-- ---------------------------------------------------------------------------

-- "We beat Ball Busters 5–3", "We lost 5–3 to Ball Busters", "We tied Ball Busters 3–3"
create or replace function public.potm_result_sentence(g public.games)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when coalesce(g.score_us, 0) > coalesce(g.score_them, 0)
      then 'We beat ' || g.opponent || ' ' || coalesce(g.score_us, 0) || '–' || coalesce(g.score_them, 0)
    when coalesce(g.score_us, 0) < coalesce(g.score_them, 0)
      then 'We lost ' || coalesce(g.score_them, 0) || '–' || coalesce(g.score_us, 0) || ' to ' || g.opponent
    else 'We tied ' || g.opponent || ' ' || coalesce(g.score_us, 0) || '–' || coalesce(g.score_them, 0)
  end;
$$;

-- "5–3 win over Ball Busters", "5–3 loss to Ball Busters", "3–3 tie with Ball Busters"
create or replace function public.potm_result_label(g public.games)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when coalesce(g.score_us, 0) > coalesce(g.score_them, 0)
      then coalesce(g.score_us, 0) || '–' || coalesce(g.score_them, 0) || ' win over ' || g.opponent
    when coalesce(g.score_us, 0) < coalesce(g.score_them, 0)
      then coalesce(g.score_them, 0) || '–' || coalesce(g.score_us, 0) || ' loss to ' || g.opponent
    else coalesce(g.score_us, 0) || '–' || coalesce(g.score_them, 0) || ' tie with ' || g.opponent
  end;
$$;

revoke execute on function public.potm_result_sentence(public.games) from public, anon;
revoke execute on function public.potm_result_label(public.games) from public, anon;
grant execute on function public.potm_result_sentence(public.games) to authenticated, service_role;
grant execute on function public.potm_result_label(public.games) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Player of the Match notifications. As in 20261015200000_notification_choices.sql,
-- except the words: "We beat Ball Busters 5–3. Vote by Sat 9:30 PM." when voting
-- opens; the reminder says whether you haven't voted or still have a vote left
-- (with a man and a woman to pick, someone may have voted once).
-- ---------------------------------------------------------------------------

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
    b := public.potm_result_sentence(g) || '. Vote by ' || public.potm_when(g.potm_closes_at) || '.';
  elsif p_kind = 'reminder' then
    if s.reminder_hours <= 0 or now() < g.potm_closes_at - make_interval(hours => s.reminder_hours) then
      return;
    end if;
    t := '🏆 Voting closes in ' || s.reminder_hours || case when s.reminder_hours = 1 then ' hour' else ' hours' end;
    -- Each player's own line is picked below.
    b := null;
  else
    return;
  end if;

  insert into public.potm_push_log (game_id, kind) values (p_game_id, p_kind) on conflict do nothing;
  if not found then
    return;
  end if;

  awards := case when s.mode = 'overall' then 1 else 2 end;
  return query
    select sub.id, sub.endpoint, sub.p256dh, sub.auth, t,
      coalesce(b, case
        when exists (select 1 from public.potm_votes v where v.game_id = g.id and v.voter_id = u.id)
          then 'You still have a vote left for the ' || g.opponent || ' game.'
        else 'You haven''t voted for the ' || g.opponent || ' game yet.'
      end),
      '/games/' || g.id
    from public.push_subscriptions sub
    join public.users u on u.id = sub.user_id and (u.joined_team_at is not null or u.role = 'admin')
    left join public.player_profiles mine on mine.user_id = u.id
    where coalesce(mine.notify_games, true)
      and (p_kind = 'open' or (
        exists (select 1 from public.game_stats st where st.game_id = g.id and st.user_id = u.id and st.played)
        and (select count(*) from public.potm_votes v where v.game_id = g.id and v.voter_id = u.id) < awards
      ));
end;
$$;

-- ---------------------------------------------------------------------------
-- The winners post in Team Chat. As in 20261015120000_potm_voting_window.sql,
-- except the words:
--   🏆 Votes are in: 5–3 win over Ball Busters
--   Man of the Match: Lee, Mike and Pat (tied, 1 vote each)
--   Woman of the Match: Kim (1 vote)
-- Null if nobody voted.
-- ---------------------------------------------------------------------------

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
  top as (
    select award, array_agg(name order by name) as names, max(n) as n from ranked where r = 1 group by award
  ),
  winners as (
    select award,
      case award when 'overall' then 'Player of the Match' when 'man' then 'Man of the Match' else 'Woman of the Match' end
        || ': '
        || case when cardinality(names) = 1 then names[1]
                else array_to_string(names[1:cardinality(names) - 1], ', ') || ' and ' || names[cardinality(names)] end
        || case when cardinality(names) > 1 then ' (tied, ' else ' (' end
        || n || case when n = 1 then ' vote' else ' votes' end
        || case when cardinality(names) > 1 then ' each)' else ')' end as line
    from top
  )
  select '🏆 Votes are in: ' || (select public.potm_result_label(g) from public.games g where g.id = p_game_id) || E'\n'
    || string_agg(w.line, E'\n' order by case w.award when 'overall' then 0 when 'man' then 1 else 2 end)
  from winners w;
$$;

-- ---------------------------------------------------------------------------
-- Game reminders. As in 20261029200000_shortage_in_girls.sql, except the words:
--   "Are you in?"  "Sat 7:30 PM vs Ball Busters. You haven't answered yet."
--   "Can you sub?" "Sat 7:30 PM vs Ball Busters. We need 2 more, including a girl."
-- The shortage is shortageText() in src/lib/team-logic.js: "Need 8, including
-- 3 girls" when nobody's in yet, "2 more girls", "1 more".
-- ---------------------------------------------------------------------------

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
  need integer;
  short_by text;
  when_vs text;
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

  when_vs := public.potm_when(public.game_kickoff(g.date, g.time)) || ' vs ' || g.opponent;
  if p_kind = 'rsvp' then
    t := 'Are you in?';
    b := when_vs || '. You haven''t answered yet.';
  else
    -- How many are still needed: the larger of the two shortages.
    need := greatest(hc.need_total, hc.need_women);
    short_by := need || case when hc.total_in = 0 then '' else ' more' end;
    short_by := case
      when hc.need_women = 0 then short_by
      when hc.need_women = need then short_by || case when need = 1 then ' girl' else ' girls' end
      else short_by || ', including ' || case when hc.need_women = 1 then 'a girl' else hc.need_women || ' girls' end
    end;
    t := 'Can you sub?';
    b := when_vs || '. We need ' || short_by || '.';
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
          -- Guys only while an open spot is free (subsToAsk() in src/lib/team-posts.js).
          and (hc.need_total > hc.need_women or a.gender = 'F')
        )
      );
end;
$$;

-- ---------------------------------------------------------------------------
-- "Playing session N?" As in 20261027130000_clear_availability.sql, except the
-- words: "Session 2 starts Sat, Jan 3." and, on the reminder, "You haven't
-- answered yet."
-- ---------------------------------------------------------------------------

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

  t := 'Playing session ' || p_session || '?';
  b := 'Session ' || p_session || ' starts ' || to_char(starts, 'Dy, Mon FMDD') || '.'
    || case when p_kind = 'reminder' then ' You haven''t answered yet.' else '' end;

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

-- ---------------------------------------------------------------------------
-- The heads-up for captains when someone new joins as Playing. As in
-- 20261101120000_new_player_heads_up.sql, except the words.
-- ---------------------------------------------------------------------------

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
        '%s just joined as Playing, so session %s''s dues are now split one more way. '
          || 'If that''s wrong, change their status on the Team page before people pay.',
        p.display_name, cur.open_session
      )
    );
end;
$$;
