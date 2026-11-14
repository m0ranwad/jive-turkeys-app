-- Goalkeeper stats (docs/games.md section 2, issue #213). Captains record who
-- was in goal each half on a game's result, and the other team's goals in the
-- 1st half, so each half's goals against and clean sheets (a half at 0) can be
-- worked out. Goals against are always kept; the show_goals_against team
-- setting only decides whether the site shows them (off to start, so nobody's
-- goals let in are on display unless captains choose it).

-- Which halves a player (or fill-in) was in goal. Stat lines move with roster
-- names when they join, so these come along with the rest of the line.
alter table public.game_stats
  add column gk_first_half boolean not null default false,
  add column gk_second_half boolean not null default false;

alter table public.game_fill_ins
  add column gk_first_half boolean not null default false,
  add column gk_second_half boolean not null default false;

-- The other team's goals in the 1st half; the 2nd half is the rest of
-- score_them. Null: nobody was sure how they split, or no keeper was recorded.
alter table public.games
  add column score_them_first_half integer check (score_them_first_half is null or score_them_first_half >= 0);

-- Captains' choice to show goals against on results, the Goalkeepers card and Legacy.
alter table public.team_settings
  add column show_goals_against boolean not null default false;

-- Saving a result with its keepers, still in one step. The earlier version
-- (five arguments) does the score, the stat lines, lines taken off and saved
-- fill-ins exactly as before; this one adds the keeper halves and the 1st-half
-- goals against, and adds new fill-ins itself so they get their keeper halves.
-- A line with a keeper half always counts as played.
-- Runs with the captain's own permissions, so the usual rules still apply.
create or replace function public.save_game_result(
  p_game_id uuid,
  p_score_us integer,
  p_score_them integer,
  p_score_them_first_half integer,
  p_lines jsonb,
  p_fill_ins jsonb
)
returns void
language plpgsql
set search_path = public
as $$
declare
  line jsonb;
  fill jsonb;
  lines jsonb;
  saved_fill_ins jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_captain() then
    raise exception 'Only captains can enter results';
  end if;
  if p_score_them_first_half is not null
     and (p_score_them_first_half < 0 or p_score_them_first_half > coalesce(p_score_them, 0)) then
    raise exception 'The first half can''t have more goals against than the final score';
  end if;

  select coalesce(jsonb_agg(
           case
             when coalesce((e ->> 'gk_first_half')::boolean, false) or coalesce((e ->> 'gk_second_half')::boolean, false)
               then e || '{"played": true}'::jsonb
             else e
           end), '[]'::jsonb)
    into lines
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e;
  -- Only the saved fill-ins go to the earlier version: it keeps and updates those
  -- and removes the rest. New ones are added below.
  if p_fill_ins is not null then
    select coalesce(jsonb_agg(e), '[]'::jsonb) into saved_fill_ins
      from jsonb_array_elements(p_fill_ins) e
      where nullif(e ->> 'id', '') is not null;
  end if;

  perform public.save_game_result(p_game_id, p_score_us, p_score_them, lines, saved_fill_ins);

  update public.games
    set score_them_first_half = case when coalesce(p_score_them, 0) = 0 then 0 else p_score_them_first_half end
    where id = p_game_id;

  for line in select * from jsonb_array_elements(lines) loop
    update public.game_stats s set
        gk_first_half = coalesce((line ->> 'gk_first_half')::boolean, false),
        gk_second_half = coalesce((line ->> 'gk_second_half')::boolean, false)
      where s.game_id = p_game_id
        and s.user_id is not distinct from nullif(line ->> 'user_id', '')::uuid
        and s.guest_id is not distinct from nullif(line ->> 'guest_id', '')::uuid;
  end loop;

  if p_fill_ins is not null then
    for fill in select * from jsonb_array_elements(p_fill_ins) loop
      if nullif(fill ->> 'id', '') is not null then
        update public.game_fill_ins f set
            gk_first_half = coalesce((fill ->> 'gk_first_half')::boolean, false),
            gk_second_half = coalesce((fill ->> 'gk_second_half')::boolean, false)
          where f.id = (fill ->> 'id')::uuid and f.game_id = p_game_id;
      else
        insert into public.game_fill_ins (game_id, display_name, gender, goals, assists, gk_first_half, gk_second_half)
        values (
          p_game_id,
          nullif(btrim(fill ->> 'display_name'), ''),
          fill ->> 'gender',
          coalesce((fill ->> 'goals')::integer, 0),
          coalesce((fill ->> 'assists')::integer, 0),
          coalesce((fill ->> 'gk_first_half')::boolean, false),
          coalesce((fill ->> 'gk_second_half')::boolean, false)
        );
      end if;
    end loop;
  end if;
end;
$$;

revoke execute on function public.save_game_result(uuid, integer, integer, integer, jsonb, jsonb) from public, anon;
grant execute on function public.save_game_result(uuid, integer, integer, integer, jsonb, jsonb) to authenticated, service_role;
