-- The heads-up captains get in the Captains' Lounge when someone new joins as
-- Playing while a session is open (tell_captains_new_player(), docs/dues.md
-- section 2). Run by scripts/test-db.sh after every migration is applied.
-- Everything happens in one transaction that's rolled back, so the other test
-- files never see it. The first failed check stops the run with
-- "FAILED: <what was expected>".

begin;

create schema heads_up_test;
grant usage on schema heads_up_test to authenticated, anon;

create table heads_up_test.people (name text primary key, id uuid not null);
grant select on heads_up_test.people to authenticated, anon;

create function heads_up_test.id(who text) returns uuid language sql stable as $$
  select id from heads_up_test.people where name = who;
$$;

create function heads_up_test.today() returns date language sql stable as $$
  select (now() at time zone 'America/New_York')::date;
$$;

create function heads_up_test.year() returns integer language sql stable as $$
  select extract(year from heads_up_test.today())::integer;
$$;

create function heads_up_test.ok(passed boolean, what text) returns void language plpgsql as $$
begin
  if passed is not true then
    raise exception 'FAILED: %', what;
  end if;
  raise notice 'ok - %', what;
end;
$$;

create function heads_up_test.refused(statement text, what text) returns void language plpgsql as $$
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

grant execute on all functions in schema heads_up_test to authenticated, anon;

create function heads_up_test.sign_in(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', heads_up_test.id(who)::text, false);
  perform set_config('role', 'authenticated', false);
end;
$$;

-- The site's posts in the Lounge, read as the database owner.
create function heads_up_test.posts() returns setof public.messages language sql stable as $$
  select m.* from public.messages m join public.chat_threads t on t.id = m.thread_id
  where t.visibility = 'captains' and m.author_name = 'Roster';
$$;

-- Joining and saying whether they're playing, as the sign-up screen does.
create function heads_up_test.join_as(who text, display_name text, status text, joined_ago interval default '0'::interval)
returns void language plpgsql as $$
begin
  insert into public.player_profiles (user_id, display_name, gender, status, created_date)
    values (heads_up_test.id(who), display_name, 'F', status, now() - joined_ago);
end;
$$;

-- ---------------------------------------------------------------------------
-- Kim is a captain. Session 2's first game is in three days, so session 2 is
-- open: a new player's status counts for its dues.
-- ---------------------------------------------------------------------------

insert into heads_up_test.people values
  ('kim', '00000000-0000-4000-8000-00000000e0a1'),
  ('neo', '00000000-0000-4000-8000-00000000e0a2'),
  ('fan', '00000000-0000-4000-8000-00000000e0a3'),
  ('sub', '00000000-0000-4000-8000-00000000e0a4'),
  ('mia', '00000000-0000-4000-8000-00000000e0a5'),
  ('old', '00000000-0000-4000-8000-00000000e0a6'),
  ('out', '00000000-0000-4000-8000-00000000e0a7'),
  ('late', '00000000-0000-4000-8000-00000000e0a8'),
  ('miag', '00000000-0000-4000-8000-00000000e0b1'),
  ('g2', '00000000-0000-4000-8000-00000000e0c1');

insert into auth.users (id, email)
  select id, name || '@heads-up.test' from heads_up_test.people where name not in ('miag', 'g2');
update public.users set role = case when id = heads_up_test.id('kim') then 'admin' else 'user' end, joined_team_at = now()
  where id in (select id from heads_up_test.people where name <> 'out');

insert into public.games (id, season_year, session, date, opponent) values
  (heads_up_test.id('g2'), heads_up_test.year(), 2, heads_up_test.today() + 3, 'Goal Diggers');

insert into public.player_profiles (user_id, display_name, gender, status) values
  (heads_up_test.id('kim'), 'Kim Captain', 'F', 'active');

select heads_up_test.ok(
  exists (select 1 from public.chat_threads where visibility = 'captains'),
  'the Captains'' Lounge is there to post in'
);

-- ---------------------------------------------------------------------------
-- Neo joins and says she's Playing: captains hear about it once.
-- ---------------------------------------------------------------------------

select heads_up_test.join_as('neo', 'Neo New', 'active');
select heads_up_test.sign_in('neo');
select public.tell_captains_new_player();
reset role;

select heads_up_test.ok((select count(*) from heads_up_test.posts()) = 1, 'a new player who says Playing gets one post in the Lounge');
select heads_up_test.ok(
  (select body from heads_up_test.posts()) =
    'Neo New just joined as Playing, so session 2''s dues are now split one more way. '
    || 'If that''s wrong, change their status on the Team page before people pay.',
  'it names them and the session whose dues they split, and says what to do'
);
select heads_up_test.ok((select user_id from heads_up_test.posts()) is null, 'it''s from the site, not from the new player');
select heads_up_test.ok(
  (select season_year = heads_up_test.year() and session = 2
   from public.new_player_notices where user_id = heads_up_test.id('neo')),
  'what was said is kept, so it''s said once'
);

select heads_up_test.sign_in('neo');
select public.tell_captains_new_player();
select heads_up_test.ok(
  (select count(*) from public.messages where author_name = 'Roster') = 0,
  'players can''t read the Lounge post'
);
select heads_up_test.refused($$select count(*) from public.new_player_notices$$, 'or the record of who captains were told about');
reset role;
select heads_up_test.ok((select count(*) from heads_up_test.posts()) = 1, 'asking again doesn''t post again');

select heads_up_test.sign_in('kim');
select heads_up_test.ok(
  (select count(*) from public.messages where author_name = 'Roster') = 1,
  'captains read it in the Lounge'
);
reset role;

-- ---------------------------------------------------------------------------
-- Nothing for anyone who doesn't split the dues, picked a roster name, joined
-- a while ago or isn't on the team.
-- ---------------------------------------------------------------------------

select heads_up_test.join_as('fan', 'Frankie Fan', 'on_break');
select heads_up_test.sign_in('fan');
select public.tell_captains_new_player();
reset role;
select heads_up_test.join_as('sub', 'Sasha Sub', 'sub_pool');
select heads_up_test.sign_in('sub');
select public.tell_captains_new_player();
reset role;
select heads_up_test.ok((select count(*) from heads_up_test.posts()) = 1, 'nothing for someone just following along, or available to sub');

-- Mia picks "Mia G", a roster name a captain set to Playing.
insert into public.team_guests (id, display_name, gender, status) values (heads_up_test.id('miag'), 'Mia G', 'F', 'active');
select heads_up_test.join_as('mia', 'Mia Garcia', 'active');
select heads_up_test.sign_in('mia');
select public.claim_team_guest(heads_up_test.id('miag'));
select public.tell_captains_new_player();
reset role;
select heads_up_test.ok((select count(*) from heads_up_test.posts()) = 1, 'nothing for someone who picked a roster name: a captain already set that');

select heads_up_test.join_as('old', 'Olive Old', 'active', '2 hours');
select heads_up_test.sign_in('old');
select public.tell_captains_new_player();
reset role;
select heads_up_test.ok((select count(*) from heads_up_test.posts()) = 1, 'nothing for someone who joined a while ago and changes to Playing later');

select heads_up_test.join_as('out', 'Otto Outside', 'active');
select heads_up_test.sign_in('out');
select heads_up_test.refused($$select public.tell_captains_new_player()$$, 'an account without the team code can''t post');
reset role;
select heads_up_test.ok((select count(*) from heads_up_test.posts()) = 1, 'and nothing was posted for it');

-- ---------------------------------------------------------------------------
-- Between sessions (the last game played, nothing on the schedule), a status
-- counts for no session's dues yet: nothing to fix, nothing posted.
-- ---------------------------------------------------------------------------

-- Three weeks of session 2's games: it has run its course.
update public.games set date = heads_up_test.today() - 3 where id = heads_up_test.id('g2');
insert into public.games (season_year, session, date, opponent) values
  (heads_up_test.year(), 2, heads_up_test.today() - 24, 'Ball Busters');
select heads_up_test.join_as('late', 'Lou Late', 'active');
select heads_up_test.sign_in('late');
select public.tell_captains_new_player();
reset role;
select heads_up_test.ok((select count(*) from heads_up_test.posts()) = 1, 'nothing between sessions');
select heads_up_test.ok(
  not exists (select 1 from public.new_player_notices where user_id = heads_up_test.id('late')),
  'and nothing kept for later'
);

set role anon;
select heads_up_test.refused($$select public.tell_captains_new_player()$$, 'signed-out visitors can''t post');
reset role;

rollback;
