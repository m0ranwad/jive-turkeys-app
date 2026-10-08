-- Jive Turkeys Team Hub: database schema.
--
-- Run once on a new Supabase project (SQL Editor -> paste -> Run, or
-- `supabase db push`). Every table requires a signed-in user; captains
-- (users.role = 'admin') manage games, results, dues and settings.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_date()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_date := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Users: one row per sign-in account, holding the team role.
-- ---------------------------------------------------------------------------

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create or replace function public.is_captain()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.users where id = auth.uid() and role = 'admin');
$$;

-- New sign-ups get a users row. The very first account becomes a captain so
-- someone can manage the team on a fresh install.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    case when exists (select 1 from public.users) then 'user' else 'admin' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger users_touch before update on public.users
  for each row execute function public.touch_updated_date();

-- ---------------------------------------------------------------------------
-- Team data
-- ---------------------------------------------------------------------------

create table public.player_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users (id) on delete cascade,
  email text,
  display_name text not null,
  gender text check (gender in ('M', 'F')),
  phone text,
  position text,
  year_joined integer,
  status text not null default 'active' check (status in ('active', 'on_break', 'sub_pool')),
  is_captain boolean not null default false,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create table public.team_settings (
  id uuid primary key default gen_random_uuid(),
  primary_jersey text,
  backup_jersey text,
  venue_name text,
  venue_address text,
  min_players integer,
  min_women integer,
  potm_mode text check (potm_mode in ('overall', 'separate')),
  email_reminders boolean not null default false,
  rules_intro text,
  quick_hits jsonb not null default '[]'::jsonb,
  rules_bullets jsonb not null default '[]'::jsonb,
  rules_footer text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  season_year integer not null,
  session integer not null check (session > 0),
  date date not null,
  time text,
  field_number text,
  opponent text not null,
  location text,
  jersey text not null default 'primary' check (jersey in ('primary', 'backup')),
  notes text,
  has_result boolean not null default false,
  score_us integer,
  score_them integer,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create index games_date_idx on public.games (date);

create table public.rsvps (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  status text not null check (status in ('in', 'out', 'maybe')),
  playing_gk boolean not null default false,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  unique (game_id, user_id)
);

create table public.game_stats (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  played boolean not null default false,
  goals integer not null default 0,
  assists integer not null default 0,
  blue_cards integer not null default 0,
  red_cards integer not null default 0,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  unique (game_id, user_id)
);

create table public.potm_votes (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  voter_id uuid not null references public.users (id) on delete cascade,
  voted_for_id uuid not null references public.users (id) on delete cascade,
  award text not null check (award in ('overall', 'man', 'woman')),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  unique (game_id, voter_id, award)
);

create table public.session_dues (
  id uuid primary key default gen_random_uuid(),
  season_year integer not null,
  session integer not null,
  total_fee numeric(10, 2) not null default 0,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  unique (season_year, session)
);

create table public.dues_payments (
  id uuid primary key default gen_random_uuid(),
  season_year integer not null,
  session integer not null,
  user_id uuid not null references public.users (id) on delete cascade,
  override_amount numeric(10, 2),
  paid boolean not null default false,
  paid_date date,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  unique (season_year, session, user_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete set null,
  author_name text,
  body text not null check (char_length(body) between 1 and 2000),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create index messages_created_idx on public.messages (created_date desc);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  author_name text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array[
    'player_profiles', 'team_settings', 'games', 'rsvps', 'game_stats', 'potm_votes',
    'session_dues', 'dues_payments', 'messages', 'announcements'
  ] loop
    execute format(
      'create trigger %1$s_touch before update on public.%1$s for each row execute function public.touch_updated_date()',
      t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Captain badge on profiles always mirrors users.role.
-- ---------------------------------------------------------------------------

create or replace function public.profile_captain_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.is_captain := coalesce((select role = 'admin' from public.users where id = new.user_id), false);
  return new;
end;
$$;

create trigger player_profiles_captain_flag
  before insert or update on public.player_profiles
  for each row execute function public.profile_captain_flag();

create or replace function public.sync_profile_captain_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.player_profiles set is_captain = (new.role = 'admin') where user_id = new.id;
  return new;
end;
$$;

create trigger users_role_changed
  after update of role on public.users
  for each row
  when (old.role is distinct from new.role)
  execute function public.sync_profile_captain_flag();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.users enable row level security;
alter table public.player_profiles enable row level security;
alter table public.team_settings enable row level security;
alter table public.games enable row level security;
alter table public.rsvps enable row level security;
alter table public.game_stats enable row level security;
alter table public.potm_votes enable row level security;
alter table public.session_dues enable row level security;
alter table public.dues_payments enable row level security;
alter table public.messages enable row level security;
alter table public.announcements enable row level security;

-- New Supabase projects don't expose tables automatically, so grant exactly
-- what's needed: signed-in players (limited by the policies below) and the
-- server-side admin role used by the invite function. Visitors get nothing.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
revoke all on all tables in schema public from anon;

-- Policies call is_captain(); the trigger functions are never called directly.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.is_captain() to authenticated, service_role;
revoke execute on function public.handle_new_user() from authenticated;
revoke execute on function public.profile_captain_flag() from authenticated;
revoke execute on function public.sync_profile_captain_flag() from authenticated;
revoke execute on function public.touch_updated_date() from authenticated;

-- users: see yourself; captains see everyone and change roles.
create policy users_select on public.users for select to authenticated
  using (id = (select auth.uid()) or (select public.is_captain()));
create policy users_update on public.users for update to authenticated
  using ((select public.is_captain())) with check ((select public.is_captain()));

-- player_profiles: whole team can read; you edit yours, captains edit anyone's.
create policy profiles_select on public.player_profiles for select to authenticated using (true);
create policy profiles_insert on public.player_profiles for insert to authenticated
  with check (user_id = (select auth.uid()) or (select public.is_captain()));
create policy profiles_update on public.player_profiles for update to authenticated
  using (user_id = (select auth.uid()) or (select public.is_captain()))
  with check (user_id = (select auth.uid()) or (select public.is_captain()));
create policy profiles_delete on public.player_profiles for delete to authenticated
  using ((select public.is_captain()));

-- Captain-managed, team-readable tables.
create policy team_settings_select on public.team_settings for select to authenticated using (true);
create policy team_settings_write on public.team_settings for all to authenticated
  using ((select public.is_captain())) with check ((select public.is_captain()));

create policy games_select on public.games for select to authenticated using (true);
create policy games_write on public.games for all to authenticated
  using ((select public.is_captain())) with check ((select public.is_captain()));

create policy game_stats_select on public.game_stats for select to authenticated using (true);
create policy game_stats_write on public.game_stats for all to authenticated
  using ((select public.is_captain())) with check ((select public.is_captain()));

create policy announcements_select on public.announcements for select to authenticated using (true);
create policy announcements_write on public.announcements for all to authenticated
  using ((select public.is_captain())) with check ((select public.is_captain()));

-- RSVPs: your own, or any if you're a captain.
create policy rsvps_select on public.rsvps for select to authenticated using (true);
create policy rsvps_insert on public.rsvps for insert to authenticated
  with check (user_id = (select auth.uid()) or (select public.is_captain()));
create policy rsvps_update on public.rsvps for update to authenticated
  using (user_id = (select auth.uid()) or (select public.is_captain()))
  with check (user_id = (select auth.uid()) or (select public.is_captain()));
create policy rsvps_delete on public.rsvps for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.is_captain()));

-- Player of the Match votes: cast and change your own.
create policy potm_select on public.potm_votes for select to authenticated using (true);
create policy potm_insert on public.potm_votes for insert to authenticated
  with check (voter_id = (select auth.uid()) and voted_for_id <> voter_id);
create policy potm_update on public.potm_votes for update to authenticated
  using (voter_id = (select auth.uid()))
  with check (voter_id = (select auth.uid()) and voted_for_id <> voter_id);
create policy potm_delete on public.potm_votes for delete to authenticated
  using (voter_id = (select auth.uid()) or (select public.is_captain()));

-- Dues: captains only.
create policy session_dues_captains on public.session_dues for all to authenticated
  using ((select public.is_captain())) with check ((select public.is_captain()));
create policy dues_payments_captains on public.dues_payments for all to authenticated
  using ((select public.is_captain())) with check ((select public.is_captain()));

-- Chat: everyone reads, you post as yourself, captains can remove messages.
create policy messages_select on public.messages for select to authenticated using (true);
create policy messages_insert on public.messages for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy messages_delete on public.messages for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.is_captain()));

-- ---------------------------------------------------------------------------
-- Live chat updates
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.messages;

-- ---------------------------------------------------------------------------
-- Starting team settings, including the field rules from the original site.
-- Captains can change all of this in the app (Team Settings, Field Rules).
-- ---------------------------------------------------------------------------

insert into public.team_settings (
  primary_jersey, backup_jersey, venue_name, venue_address, min_players, min_women,
  potm_mode, email_reminders, rules_intro, quick_hits, rules_bullets, rules_footer
) values (
  'Bright green/yellow',
  'Black',
  'North Coast Premier Soccer Complex',
  '8809 Lake Rd, Seville, OH',
  8,
  3,
  'separate',
  false,
  'SAFE & FAIR PLAY ARE OUR TOP PRIORITY',
  jsonb_build_array(
    'Waiver must be on file with the complex before you can play',
    'Shin guards required, jewelry off or taped',
    'No offside, no slide tackles (goalie excepted in the box), no boarding',
    'Coed: 3 women field players minimum at all times (a woman in goal doesn''t count), 2-goal limit per man, women take all kicks',
    'Blue card = 2 minutes down a player; red card = minimum 1-game suspension'
  ),
  jsonb_build_array(
    'Players must have a completed liability waiver form on file before they will be permitted to play.',
    'Shin guards must be worn by all players. Jewelry must be taped or removed.',
    'Sporting behavior is expected from players and fans. Fighting will result in permanent suspension from the facility without a refund.',
    'Games consist of two 25-minute halves with a 5-minute halftime. The clock starts promptly at the appointed time and will not be stopped.',
    'Offside rules do not apply.',
    'Three-line violations occur when a ball is played in the air over all three lines without touching anything. The ball is placed in the middle of the first red line it passed over and a restart is given to the opposing team.',
    'Passing back to the goalie is permitted from anywhere, but the goalie is NOT permitted to pick the ball up if it is played back with the feet.',
    'A ball hitting the roof is given to the opposing team and reset at the nearest line.',
    'Out-of-bounds balls are brought back into play at the point they went out.',
    'A team down by five goals may add an additional field player as long as the differential exists.',
    'Blood from any wound must be stopped and fully covered before a player may be on the field of play.',
    'Substitutions are "on the fly." Guaranteed substitutions are allowed when the ball leaves the field of play and must be completed within 20 seconds. Substitutions are not guaranteed during the final two minutes of a half.',
    'Restarts and penalty kicks must be taken within five seconds.',
    'Slide tackling is not permitted and may result in a red card. The only exception is the goalie, who may slide in the penalty area.',
    'Intentional or violent boarding is not permitted.',
    'Foul or abusive language is not permitted.',
    'Kicks are all direct. Minor fouls inside the box are brought outside the penalty area.',
    'Cards: An offending player is sent off for two minutes and the team plays a person down. Three blue cards on the same player result in a red card, and the team plays a person down for five minutes. Red cards are serious and result in at least a one-game suspension, reviewed by management for possible further action.',
    'Coed division rules are the same as all other age groups with these exceptions:',
    'Two-goal limit per male.',
    'Minimum of three women field players on the field at all times. A woman playing in goal does not count as a field player.',
    'Women take all kicks.'
  ),
  'Final decisions regarding all rules and interpretations are made by the owners of North Coast Premier Soccer Complex.'
);
