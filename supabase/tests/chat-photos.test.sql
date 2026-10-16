-- Chat photos database tests: who can upload, see and remove photos in the
-- chat-media bucket, and which photos a message can show. Run by
-- scripts/test-db.sh after every migration is applied (with the stand-in
-- storage tables from stubs.sql). Everything happens in one transaction
-- that's rolled back, so the other test files never see it.
-- The first failed check stops the run with "FAILED: <what was expected>".

begin;

create schema photo_test;
grant usage on schema photo_test to authenticated, anon;

create table photo_test.people (name text primary key, id uuid not null);
grant select on photo_test.people to authenticated, anon;

create function photo_test.id(who text) returns uuid language sql stable as $$
  select id from photo_test.people where name = who;
$$;

create function photo_test.ok(passed boolean, what text) returns void language plpgsql as $$
begin
  if passed is not true then
    raise exception 'FAILED: %', what;
  end if;
  raise notice 'ok - %', what;
end;
$$;

create function photo_test.refused(statement text, what text) returns void language plpgsql as $$
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

-- Runs a statement and checks how many rows it touched (RLS hides rows rather than erroring).
create function photo_test.touches(statement text, expected integer, what text) returns void language plpgsql as $$
declare
  n integer;
begin
  execute statement;
  get diagnostics n = row_count;
  if n <> expected then
    raise exception 'FAILED: % (touched % rows, expected %)', what, n, expected;
  end if;
  raise notice 'ok - %', what;
end;
$$;

-- A file in someone's folder: "<their id>/<name>".
create function photo_test.path(who text, name text) returns text language sql stable as $$
  select photo_test.id(who)::text || '/' || name;
$$;

-- What a message stores for one photo in someone's folder.
create function photo_test.photo(who text, name text) returns jsonb language sql stable as $$
  select jsonb_build_array(jsonb_build_object('type', 'image', 'path', photo_test.path(who, name), 'width', 1600, 'height', 1200));
$$;

-- Uploads a file the way Supabase Storage does: an insert into storage.objects as the signed-in player.
create function photo_test.upload(who text, name text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner) values ('chat-media', photo_test.path(who, name), auth.uid());
$$;

grant execute on all functions in schema photo_test to authenticated, anon;

create function photo_test.sign_in(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', photo_test.id(who)::text, false);
  perform set_config('role', 'authenticated', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- People: a captain (first sign-up), two players, and an account that hasn't
-- entered the team code
-- ---------------------------------------------------------------------------

insert into photo_test.people values
  ('cap', '00000000-0000-4000-8000-0000000000a1'),
  ('ann', '00000000-0000-4000-8000-0000000000b1'),
  ('bob', '00000000-0000-4000-8000-0000000000c1'),
  ('new', '00000000-0000-4000-8000-0000000000d1');

insert into auth.users (id, email) select id, name || '@test.local' from photo_test.people order by name = 'cap' desc, name;
update public.users set joined_team_at = now() where id <> photo_test.id('new');

select photo_test.ok(
  (select not public and file_size_limit = 5242880 and 'image/gif' = any(allowed_mime_types) from storage.buckets where id = 'chat-media'),
  'chat photos have their own private bucket, images only, 5 MB each');

-- ---------------------------------------------------------------------------
-- Uploading
-- ---------------------------------------------------------------------------

select photo_test.sign_in('ann');
select photo_test.upload('ann', 'team.jpg');
select photo_test.ok((select count(*) from storage.objects where name = photo_test.path('ann', 'team.jpg')) = 1,
  'a player uploads a photo into their own folder');
select photo_test.refused($$select photo_test.upload('bob', 'sneaky.jpg')$$, 'but not into someone else''s');
select photo_test.refused($$insert into storage.objects (bucket_id, name, owner) values ('chat-media', 'loose.jpg', auth.uid())$$,
  'or outside a folder');

select photo_test.sign_in('new');
select photo_test.refused($$select photo_test.upload('new', 'hello.jpg')$$, 'an account that hasn''t joined the team can''t upload');
select photo_test.ok((select count(*) from storage.objects) = 0, 'or see any chat photos');

select photo_test.sign_in('bob');
select photo_test.ok((select count(*) from storage.objects where bucket_id = 'chat-media') = 1, 'teammates see every chat photo');

-- ---------------------------------------------------------------------------
-- Posting: a message shows 1 to 4 of its author's own photos
-- ---------------------------------------------------------------------------

select photo_test.sign_in('ann');
select photo_test.touches(
  $$insert into public.messages (user_id, author_name, body, attachments) values (photo_test.id('ann'), 'Ann', '📷 Photo', photo_test.photo('ann', 'team.jpg'))$$,
  1, 'a player posts a photo');
select photo_test.ok(
  (select attachments -> 0 ->> 'path' = photo_test.path('ann', 'team.jpg') from public.messages where body = '📷 Photo'),
  'the message keeps where the photo is and its size');
select photo_test.refused(
  $$insert into public.messages (user_id, author_name, body, attachments) values (photo_test.id('ann'), 'Ann', 'Look', photo_test.photo('bob', 'his.jpg'))$$,
  'a message can''t show someone else''s photo');
select photo_test.refused(
  $$insert into public.messages (user_id, author_name, body, attachments) values (photo_test.id('ann'), 'Ann', 'Look', '[]')$$,
  'or no photos at all');
select photo_test.refused(
  $$insert into public.messages (user_id, author_name, body, attachments)
    values (photo_test.id('ann'), 'Ann', 'Look', (select jsonb_agg(photo_test.photo('ann', 'p' || n || '.jpg') -> 0) from generate_series(1, 5) n))$$,
  'or more than 4');
select photo_test.refused(
  $$insert into public.messages (user_id, author_name, body, attachments)
    values (photo_test.id('ann'), 'Ann', 'Look', jsonb_build_array(jsonb_build_object('type', 'image', 'path', photo_test.path('ann', '../x.jpg'), 'width', 10, 'height', 10)))$$,
  'or an odd file name');
select photo_test.refused(
  $$insert into public.messages (user_id, author_name, body, attachments)
    values (photo_test.id('ann'), 'Ann', 'Look', jsonb_build_array(jsonb_build_object('type', 'video', 'path', photo_test.path('ann', 'x.jpg'), 'width', 10, 'height', 10)))$$,
  'or anything but images');
select photo_test.refused(
  $$insert into public.messages (user_id, author_name, body, attachments)
    values (photo_test.id('ann'), 'Ann', 'Look', jsonb_build_array(jsonb_build_object('type', 'image', 'path', photo_test.path('ann', 'x.jpg'))))$$,
  'or a photo without its size');
select photo_test.refused(
  $$insert into public.messages (user_id, author_name, body) values (photo_test.id('ann'), 'Ann', '')$$,
  'a message still needs text (a photo without a caption says "📷 Photo")');
select photo_test.refused($$update public.messages set attachments = null where body = '📷 Photo'$$,
  'photos are fixed once posted');
select photo_test.touches($$update public.messages set body = 'Champions!' where body = '📷 Photo'$$, 1,
  'but the caption can be edited');
select photo_test.ok((select attachments is not null from public.messages where body = 'Champions!'), 'and the photo stays');

-- ---------------------------------------------------------------------------
-- Removing photos: the poster or a captain, and anyone once no message shows it
-- ---------------------------------------------------------------------------

select photo_test.upload('ann', 'spare.jpg');
select photo_test.sign_in('bob');
select photo_test.upload('bob', 'goal.gif');
insert into public.messages (user_id, author_name, body, attachments) values (photo_test.id('bob'), 'Bob', 'GOAL', photo_test.photo('bob', 'goal.gif'));
select photo_test.touches(format($$delete from storage.objects where name = %L$$, photo_test.path('ann', 'team.jpg')), 0,
  'a player can''t remove someone else''s photo while a message shows it');
select photo_test.touches(format($$delete from storage.objects where name = %L$$, photo_test.path('ann', 'spare.jpg')), 1,
  'anyone can tidy up a photo no message shows (what deleting a message or thread leaves behind)');
select photo_test.touches(format($$delete from storage.objects where name = %L$$, photo_test.path('bob', 'goal.gif')), 1,
  'the poster removes their own photo');

select photo_test.sign_in('new');
select photo_test.touches($$delete from storage.objects$$, 0, 'an account that hasn''t joined the team removes nothing');

select photo_test.sign_in('cap');
select photo_test.touches(format($$delete from storage.objects where name = %L$$, photo_test.path('ann', 'team.jpg')), 1,
  'a captain removes anyone''s photo');

reset role;

rollback;
