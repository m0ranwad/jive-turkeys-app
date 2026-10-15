-- Saving a game's result in one step. The site used to send the score, then
-- each stat line, then the fill-ins, as separate requests; if the connection
-- dropped partway (bad signal at the complex), the game showed a final score
-- with only some players' stats. Now it all saves together or not at all.
--
-- p_lines: one per player on the result screen,
--   { user_id | guest_id, played, goals, assists, blue_cards, red_cards }.
--   A line that played or has numbers is saved; one that didn't play and has
--   none is removed. Players not listed keep what they had.
-- p_fill_ins: the game's whole list of fill-ins,
--   { id (saved ones), display_name, gender, goals, assists }.
--   Saved ones not in the list are removed.
-- Runs with the captain's own permissions, so the usual rules still apply.
--
-- owner-approved: Cory approved this on 2026-10-15. The "delete from" lines
-- below only remove the stat lines and fill-ins a captain takes off a game's
-- result screen, the same rows the site already removed one by one.

create or replace function public.save_game_result(
  p_game_id uuid,
  p_score_us integer,
  p_score_them integer,
  p_lines jsonb,
  p_fill_ins jsonb
)
returns void
language plpgsql
set search_path = public
as $$
declare
  line jsonb;
  who_user uuid;
  who_guest uuid;
  keep boolean;
  fill jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_captain() then
    raise exception 'Only captains can enter results';
  end if;
  update public.games set score_us = p_score_us, score_them = p_score_them, has_result = true where id = p_game_id;
  if not found then
    raise exception 'That game is gone';
  end if;

  for line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    who_user := nullif(line ->> 'user_id', '')::uuid;
    who_guest := nullif(line ->> 'guest_id', '')::uuid;
    keep := coalesce((line ->> 'played')::boolean, false)
      or coalesce((line ->> 'goals')::integer, 0) + coalesce((line ->> 'assists')::integer, 0)
         + coalesce((line ->> 'blue_cards')::integer, 0) + coalesce((line ->> 'red_cards')::integer, 0) > 0;
    if not keep then
      delete from public.game_stats s
      where s.game_id = p_game_id
        and (s.user_id is not distinct from who_user and s.guest_id is not distinct from who_guest);
      continue;
    end if;
    update public.game_stats s set
        played = coalesce((line ->> 'played')::boolean, false),
        goals = coalesce((line ->> 'goals')::integer, 0),
        assists = coalesce((line ->> 'assists')::integer, 0),
        blue_cards = coalesce((line ->> 'blue_cards')::integer, 0),
        red_cards = coalesce((line ->> 'red_cards')::integer, 0)
      where s.game_id = p_game_id
        and (s.user_id is not distinct from who_user and s.guest_id is not distinct from who_guest);
    if not found then
      insert into public.game_stats (game_id, user_id, guest_id, played, goals, assists, blue_cards, red_cards)
      values (
        p_game_id, who_user, who_guest,
        coalesce((line ->> 'played')::boolean, false),
        coalesce((line ->> 'goals')::integer, 0),
        coalesce((line ->> 'assists')::integer, 0),
        coalesce((line ->> 'blue_cards')::integer, 0),
        coalesce((line ->> 'red_cards')::integer, 0)
      );
    end if;
  end loop;

  if p_fill_ins is not null then
    delete from public.game_fill_ins f
    where f.game_id = p_game_id
      and f.id not in (
        select (e ->> 'id')::uuid from jsonb_array_elements(p_fill_ins) e where nullif(e ->> 'id', '') is not null
      );
    for fill in select * from jsonb_array_elements(p_fill_ins) loop
      if nullif(fill ->> 'id', '') is not null then
        update public.game_fill_ins f set
            display_name = nullif(btrim(fill ->> 'display_name'), ''),
            gender = fill ->> 'gender',
            goals = coalesce((fill ->> 'goals')::integer, 0),
            assists = coalesce((fill ->> 'assists')::integer, 0)
          where f.id = (fill ->> 'id')::uuid and f.game_id = p_game_id;
      else
        insert into public.game_fill_ins (game_id, display_name, gender, goals, assists)
        values (
          p_game_id,
          nullif(btrim(fill ->> 'display_name'), ''),
          fill ->> 'gender',
          coalesce((fill ->> 'goals')::integer, 0),
          coalesce((fill ->> 'assists')::integer, 0)
        );
      end if;
    end loop;
  end if;
end;
$$;

revoke execute on function public.save_game_result(uuid, integer, integer, jsonb, jsonb) from public, anon;
grant execute on function public.save_game_result(uuid, integer, integer, jsonb, jsonb) to authenticated, service_role;
