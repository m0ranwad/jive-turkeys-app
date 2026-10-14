-- Fill-ins: people from outside the team (not even the sub pool) who play a
-- game for us, often without anyone catching their name. Captains record their
-- goals and assists on that game's result so our score adds up. They belong to
-- that one game: they never show on the Team page, in dues, headcounts or the
-- leaderboards, and can't win Player of the Match. Someone who keeps coming
-- back gets added to the team (team_guests) like anyone else.

create table public.game_fill_ins (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  -- Blank when nobody caught their name.
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 60),
  -- The two-goal limit for men applies to fill-ins too.
  gender text check (gender in ('M', 'F')),
  goals integer not null default 0 check (goals >= 0),
  assists integer not null default 0 check (assists >= 0),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create index game_fill_ins_game on public.game_fill_ins (game_id);

create trigger game_fill_ins_touch before update on public.game_fill_ins
  for each row execute function public.touch_updated_date();

-- Team members read; captains write, like stat lines.
alter table public.game_fill_ins enable row level security;
create policy game_fill_ins_select on public.game_fill_ins for select to authenticated
  using ((select public.is_team_member()));
create policy game_fill_ins_write on public.game_fill_ins for all to authenticated
  using ((select public.is_captain())) with check ((select public.is_captain()));
grant select, insert, update, delete on public.game_fill_ins to authenticated, service_role;
