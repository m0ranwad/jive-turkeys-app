-- The call for subs says a shortage the way the game page does ("2 more players, including a girl",
-- "2 more girls"), and once the open spots are full it asks only girls: a guy would only sit on the
-- bench. Same answers as before otherwise; nothing is stored differently.

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
    -- How many are still needed: the larger of the two shortages (shortageText() in src/lib/team-logic.js).
    need := greatest(hc.need_total, hc.need_women);
    short_by := case
      when hc.need_women = 0 then need || case when need = 1 then ' more player' else ' more players' end
      when hc.need_women = need then need || case when need = 1 then ' more girl' else ' more girls' end
      else need || ' more players, including ' || case when hc.need_women = 1 then 'a girl' else hc.need_women || ' girls' end || ','
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
          -- Guys only while an open spot is free (subsToAsk() in src/lib/team-posts.js).
          and (hc.need_total > hc.need_women or a.gender = 'F')
        )
      );
end;
$$;
