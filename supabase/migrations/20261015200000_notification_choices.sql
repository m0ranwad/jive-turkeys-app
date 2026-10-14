-- Players choose which notifications they get: chat messages, game alerts
-- (Player of the Match voting now; game reminders later), or both. Both are on
-- unless a player turns one off; the choice covers all their devices. Turning
-- notifications on for a device (the browser's "Allow") is still each player's
-- own tap, on each phone or computer.

alter table public.player_profiles
  add column notify_chat boolean not null default true,
  add column notify_games boolean not null default true;

-- ---------------------------------------------------------------------------
-- Chat messages: same as 20261014180000_remove_team_member.sql, plus not to
-- players who turned chat notifications off.
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
    left join public.player_profiles mine on mine.user_id = s.user_id
    left join public.chat_threads t on t.id = m.thread_id
    left join public.player_profiles p on p.user_id = m.user_id
    where s.user_id is distinct from m.user_id
      and coalesce(mine.notify_chat, true)
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

-- ---------------------------------------------------------------------------
-- Player of the Match: same as 20261015120000_potm_voting_window.sql, plus not
-- to players who turned game alerts off.
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
    left join public.player_profiles mine on mine.user_id = u.id
    where coalesce(mine.notify_games, true)
      and (p_kind = 'open' or (
        exists (select 1 from public.game_stats st where st.game_id = g.id and st.user_id = u.id and st.played)
        and (select count(*) from public.potm_votes v where v.game_id = g.id and v.voter_id = u.id) < awards
      ));
end;
$$;
