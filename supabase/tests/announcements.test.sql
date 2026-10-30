-- Announcements database tests: which posts are new to each player (their own
-- read marker, or when they joined), and captains fixing or deleting a post.
-- Run by scripts/test-db.sh after every migration is applied. Everything
-- happens in one transaction that's rolled back, so the other test files
-- never see it. The first failed check stops the run with "FAILED: <what was
-- expected>". now() is the same all through a transaction, so posts that go
-- up "later" get an explicit time.

begin;

create schema ann_test;
grant usage on schema ann_test to authenticated, anon;

create table ann_test.people (name text primary key, id uuid not null);
grant select on ann_test.people to authenticated, anon;

create function ann_test.id(who text) returns uuid language sql stable as $$
  select id from ann_test.people where name = who;
$$;

create function ann_test.ok(passed boolean, what text) returns void language plpgsql as $$
begin
  if passed is not true then
    raise exception 'FAILED: %', what;
  end if;
  raise notice 'ok - %', what;
end;
$$;

create function ann_test.refused(statement text, what text) returns void language plpgsql as $$
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

grant execute on all functions in schema ann_test to authenticated, anon;

create function ann_test.sign_in(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', ann_test.id(who)::text, false);
  perform set_config('role', 'authenticated', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Cap is the captain (account made Sep 15, never entered the team code), Ann
-- joined Oct 1, Bo joined just now, and Zed hasn't entered the code. Three
-- posts: Sep 1, Oct 5 and Oct 10.
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claim.sub', '', false);
delete from public.announcements;
delete from auth.users;

insert into ann_test.people values
  ('cap', '00000000-0000-4000-8000-0000000000a1'),
  ('ann', '00000000-0000-4000-8000-0000000000a2'),
  ('bo', '00000000-0000-4000-8000-0000000000a3'),
  ('zed', '00000000-0000-4000-8000-0000000000a4');

insert into auth.users (id, email) values (ann_test.id('cap'), 'cap@ann.test');
insert into auth.users (id, email) select id, name || '@ann.test' from ann_test.people where name <> 'cap';
update public.users set joined_team_at = null, created_date = '2026-09-15 12:00+00' where id = ann_test.id('cap');
update public.users set joined_team_at = '2026-10-01 12:00+00' where id = ann_test.id('ann');
update public.users set joined_team_at = now() where id = ann_test.id('bo');

insert into public.announcements (id, title, body, author_name, created_date) values
  ('00000000-0000-4000-8000-00000000a0a1', 'Old news', 'Last season is done.', 'Cap', '2026-09-01 12:00+00'),
  ('00000000-0000-4000-8000-00000000a0a2', 'Dues due', 'Pay by Friday.', 'Cap', '2026-10-05 12:00+00'),
  ('00000000-0000-4000-8000-00000000a0a3', 'Team photo', 'Wear your jersey.', 'Cap', '2026-10-10 12:00+00');

-- ---------------------------------------------------------------------------
-- New posts, before anyone has opened Announcements.
-- ---------------------------------------------------------------------------

select ann_test.sign_in('ann');
select ann_test.ok(public.announcements_unread() = 2, 'with no marker, the posts from after you joined are new');
reset role;

select ann_test.sign_in('bo');
select ann_test.ok(public.announcements_unread() = 0, 'a player who just joined doesn''t start with old news');
reset role;

select ann_test.sign_in('cap');
select ann_test.ok(public.announcements_unread() = 2,
  'a captain who never entered the code counts from when their account was made');
reset role;

select ann_test.sign_in('zed');
select ann_test.ok(public.announcements_unread() = 0, 'an account that hasn''t joined counts none');
select ann_test.refused($$select public.announcements_mark_read(now())$$, 'and can''t keep a read marker');
select ann_test.refused($$insert into public.announcement_reads (user_id) values (auth.uid())$$, 'not even directly');
reset role;

-- ---------------------------------------------------------------------------
-- Opening Announcements.
-- ---------------------------------------------------------------------------

select ann_test.sign_in('ann');
select public.announcements_mark_read('2026-10-05 12:00+00');
select ann_test.ok(public.announcements_unread() = 1, 'reading up to a post leaves only the newer ones');
select public.announcements_mark_read('2026-10-10 12:00+00');
select public.announcements_mark_read('2026-10-10 12:00+00');
select ann_test.ok(public.announcements_unread() = 0, 'reading up to the newest leaves none');
select ann_test.ok((select count(*) = 1 from public.announcement_reads), 'and keeps one marker, however often');
select public.announcements_mark_read('2026-09-01 12:00+00');
select ann_test.ok((select last_read_at = '2026-10-10 12:00+00' from public.announcement_reads), 'the marker never moves back');
select public.announcements_mark_read('2099-01-01 00:00+00');
select ann_test.ok((select last_read_at = now() from public.announcement_reads), 'or past now');
reset role;

-- A post that goes up after that is new again.
insert into public.announcements (title, body, author_name, created_date)
  values ('Later', 'See you Thursday.', 'Cap', now() + interval '1 minute');
select ann_test.sign_in('ann');
select ann_test.ok(public.announcements_unread() = 1, 'a post after you last opened them is new');
reset role;
select ann_test.sign_in('bo');
select ann_test.ok(public.announcements_unread() = 1, 'and new to a player who joined before it');
reset role;

-- ---------------------------------------------------------------------------
-- Read markers are each player's own.
-- ---------------------------------------------------------------------------

select ann_test.sign_in('cap');
select ann_test.ok((select count(*) = 0 from public.announcement_reads), 'captains can''t see other players'' markers');
select ann_test.refused(
  $$insert into public.announcement_reads (user_id, last_read_at) values (ann_test.id('bo'), now())$$,
  'or set one for someone else');
update public.announcement_reads set last_read_at = '2026-01-01 00:00+00';
reset role;
select ann_test.ok((select last_read_at = now() from public.announcement_reads where user_id = ann_test.id('ann')),
  'or move someone else''s');

-- ---------------------------------------------------------------------------
-- Captains fix and delete posts; players can't.
-- ---------------------------------------------------------------------------

select ann_test.sign_in('ann');
select ann_test.refused($$insert into public.announcements (title, body) values ('Hi', 'Hi')$$, 'players can''t post');
update public.announcements set body = 'Pay whenever.' where title = 'Dues due';
delete from public.announcements where title = 'Team photo';
reset role;
select ann_test.ok((select body = 'Pay by Friday.' and edited_date is null from public.announcements where title = 'Dues due'),
  'players can''t edit a post');
select ann_test.ok(exists (select 1 from public.announcements where title = 'Team photo'), 'or delete one');

select ann_test.sign_in('cap');
update public.announcements set body = 'Pay by Saturday.' where title = 'Dues due';
update public.announcements set title = 'Team photo', body = 'Wear your jersey.' where title = 'Team photo';
update public.announcements set author_name = 'Captain Cap' where title = 'Old news';
reset role;
select ann_test.ok(
  (select body = 'Pay by Saturday.' and edited_date is not null and created_date = '2026-10-05 12:00+00'
   from public.announcements where title = 'Dues due'),
  'a captain fixes a post: it''s marked edited and keeps when it went up');
select ann_test.ok((select edited_date is null from public.announcements where title = 'Team photo'),
  'saving it unchanged doesn''t mark it edited');
select ann_test.ok((select edited_date is null from public.announcements where title = 'Old news'),
  'only the title and text count as an edit');
select ann_test.sign_in('ann');
select ann_test.ok(public.announcements_unread() = 1, 'a fixed post doesn''t show as new again');
reset role;

select ann_test.sign_in('cap');
delete from public.announcements where title = 'Later';
reset role;
select ann_test.ok(not exists (select 1 from public.announcements where title = 'Later'), 'a captain deletes a post');
select ann_test.sign_in('ann');
select ann_test.ok(public.announcements_unread() = 0, 'and it no longer counts as new');
reset role;

-- Deleting an account takes its read marker with it, and nothing else.
delete from auth.users where id = ann_test.id('ann');
select ann_test.ok(not exists (select 1 from public.announcement_reads), 'a deleted account''s marker goes with it');
select ann_test.ok((select count(*) = 3 from public.announcements), 'and the posts stay');

rollback;
