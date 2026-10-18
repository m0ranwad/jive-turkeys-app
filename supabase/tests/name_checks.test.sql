-- Captains' answers to the Team page's name checks (team_name_checks): the team
-- reads them, only captains add them. Run by scripts/test-db.sh after every
-- migration is applied. Everything happens in one transaction that's rolled
-- back. The first failed check stops the run with "FAILED: <what was expected>".

begin;

create schema names_test;
grant usage on schema names_test to authenticated, anon;

create table names_test.people (name text primary key, id uuid not null);
grant select on names_test.people to authenticated, anon;

create function names_test.id(who text) returns uuid language sql stable as $$
  select id from names_test.people where name = who;
$$;

create function names_test.ok(passed boolean, what text) returns void language plpgsql as $$
begin
  if passed is not true then
    raise exception 'FAILED: %', what;
  end if;
  raise notice 'ok - %', what;
end;
$$;

create function names_test.refused(statement text, what text) returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    raise notice 'ok - % (refused: %)', what, sqlerrm;
    return;
  end;
  raise exception 'FAILED: % (it was allowed)', what;
end;
$$;

grant execute on all functions in schema names_test to authenticated, anon;

create function names_test.sign_in(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', names_test.id(who)::text, false);
  perform set_config('role', 'authenticated', false);
end;
$$;

-- Kim is a captain. Josh B and Josh A are two different Joshes; Rob joined
-- without picking a roster name; Nia signed up but hasn't entered the team code.
insert into names_test.people values
  ('kim', '00000000-0000-4000-8000-0000000000d1'),
  ('joshb', '00000000-0000-4000-8000-0000000000d2'),
  ('josha', '00000000-0000-4000-8000-0000000000d3'),
  ('rob', '00000000-0000-4000-8000-0000000000d4'),
  ('nia', '00000000-0000-4000-8000-0000000000d5');
insert into auth.users (id, email) select id, name || '@names.test' from names_test.people;
update public.users set role = case when id = names_test.id('kim') then 'admin' else 'user' end,
  joined_team_at = case when id = names_test.id('nia') then null else now() end
  where id in (select id from names_test.people);

select names_test.sign_in('kim');
insert into public.team_name_checks (kind, user_id, other_user_id, checked_by)
  values ('different_people', names_test.id('joshb'), names_test.id('josha'), auth.uid());
insert into public.team_name_checks (kind, user_id, checked_by) values ('not_on_roster', names_test.id('rob'), auth.uid());
select names_test.ok((select count(*) = 2 from public.team_name_checks), 'a captain answers both kinds of name check');
select names_test.refused(
  $$insert into public.team_name_checks (kind, user_id) values ('different_people', names_test.id('joshb'))$$,
  'different people needs the other account');
select names_test.refused(
  $$insert into public.team_name_checks (kind, user_id, other_user_id) values ('not_on_roster', names_test.id('rob'), names_test.id('kim'))$$,
  'not on the roster is about one account');
reset role;

select names_test.sign_in('joshb');
select names_test.ok((select count(*) = 2 from public.team_name_checks), 'teammates read the answers');
select names_test.refused(
  $$insert into public.team_name_checks (kind, user_id) values ('not_on_roster', names_test.id('josha'))$$,
  'players cannot answer them');
reset role;

select names_test.sign_in('nia');
select names_test.ok((select count(*) = 0 from public.team_name_checks), 'someone who has not entered the team code sees none');
reset role;

set role anon;
select names_test.refused($$select count(*) from public.team_name_checks$$, 'signed-out visitors cannot read them');
reset role;

rollback;
