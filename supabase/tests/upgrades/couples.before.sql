-- The captain links a roster name to a new account before the couples update.
-- Session 1 is over, so only its roster-name entry moves to that account;
-- the account already has its own entry in session 2.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'captain@upgrade.test'),
  ('00000000-0000-4000-8000-000000000002', 'partner@upgrade.test'),
  ('00000000-0000-4000-8000-000000000003', 'joiner@upgrade.test');
update public.users set
  role = case when id = '00000000-0000-4000-8000-000000000001' then 'admin' else 'user' end,
  joined_team_at = now();
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);

insert into public.games (season_year, session, date, opponent)
  values (2026, 1, (now() at time zone 'America/New_York')::date + 1, 'First');
insert into public.player_profiles (user_id, display_name, status) values
  ('00000000-0000-4000-8000-000000000001', 'Captain', 'active'),
  ('00000000-0000-4000-8000-000000000002', 'Partner', 'active');
insert into public.team_guests (id, display_name, status)
  values ('00000000-0000-4000-8000-000000000004', 'Roster Name', 'active');
select public.set_dues_partner('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000004');
insert into public.session_dues (season_year, session, total_fee) values (2026, 1, 120);
select public.mark_dues_paid(2026, 1,
  array['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000004']::uuid[],
  true, current_date, array[40, 40]::numeric[]);

update public.games set date = (now() at time zone 'America/New_York')::date - 1;
insert into public.games (season_year, session, date, opponent)
  values (2026, 2, (now() at time zone 'America/New_York')::date + 1, 'Second');
insert into public.player_profiles (user_id, display_name, status)
  values ('00000000-0000-4000-8000-000000000003', 'Joiner', 'active');
select public.link_team_guest('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000003');
