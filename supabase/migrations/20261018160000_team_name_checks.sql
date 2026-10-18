-- Captains' answers to the Team page's name checks, so a question one captain
-- has answered stops showing for every captain:
--   different_people: two accounts whose names look alike ("Josh" and "Josh
--     Allen") aren't one person who signed up twice.
--   not_on_roster: someone who joined without picking a roster name isn't one
--     of the grey cards under another name ("Robert" for "Bob").

create table public.team_name_checks (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('different_people', 'not_on_roster')),
  user_id uuid not null references public.users (id) on delete cascade,
  -- different_people: the other account (the pair counts either way round).
  other_user_id uuid references public.users (id) on delete cascade,
  checked_by uuid references public.users (id) on delete set null,
  created_date timestamptz not null default now(),
  constraint team_name_checks_other check ((kind = 'different_people') = (other_user_id is not null))
);

-- The team reads them; captains answer.
alter table public.team_name_checks enable row level security;
create policy team_name_checks_select on public.team_name_checks for select to authenticated
  using ((select public.is_team_member()));
create policy team_name_checks_insert on public.team_name_checks for insert to authenticated
  with check ((select public.is_captain()));
grant select, insert, update, delete on public.team_name_checks to authenticated, service_role;
