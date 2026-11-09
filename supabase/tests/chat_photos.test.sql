-- Photos in chat (docs/chat.md section 9): one image in the poster's own
-- chat-media folder per message, and once posted it can't be changed, only
-- deleted. Run by scripts/test-db.sh after every migration is applied.

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

grant execute on all functions in schema photo_test to authenticated, anon;

create function photo_test.sign_in(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', photo_test.id(who)::text, false);
  perform set_config('role', 'authenticated', false);
end;
$$;

create function photo_test.path(who text, file_id uuid default '00000000-0000-4000-8000-00000000f2b1')
returns text language sql stable as $$
  select photo_test.id(who)::text || '/' || file_id::text || '.webp';
$$;

create function photo_test.image(path text, width int default 800, height int default 600)
returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object(
    'type', 'image',
    'path', path,
    'width', width,
    'height', height
  ));
$$;

create function photo_test.post(attachments jsonb, body text default 'Photo', new_id uuid default gen_random_uuid())
returns uuid language plpgsql as $$
begin
  insert into public.messages (id, user_id, author_name, body, attachments)
    values (new_id, auth.uid(), 'Pat', body, attachments);
  return new_id;
end;
$$;
grant execute on function photo_test.post(jsonb, text, uuid) to authenticated;

create function photo_test.first() returns uuid language sql immutable as $$
  select '00000000-0000-4000-8000-00000000f2f1'::uuid
$$;
grant execute on function photo_test.first() to authenticated;

insert into photo_test.people values
  ('kim', '00000000-0000-4000-8000-00000000f2a1'),
  ('pat', '00000000-0000-4000-8000-00000000f2a2'),
  ('sam', '00000000-0000-4000-8000-00000000f2a4'),
  ('zed', '00000000-0000-4000-8000-00000000f2a3');

insert into auth.users (id, email) select id, name || '@photos.test' from photo_test.people;
update public.users set role = case when id = photo_test.id('kim') then 'admin' else 'user' end,
  joined_team_at = case when id = photo_test.id('zed') then null else now() end
  where id in (select id from photo_test.people);

create function photo_test.upload(who text, file_id uuid default '00000000-0000-4000-8000-00000000f2b1')
returns void language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name, owner)
  values ('chat-media', photo_test.path(who, file_id), photo_test.id(who));
end;
$$;
grant execute on function photo_test.upload(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Posting
-- ---------------------------------------------------------------------------

select photo_test.sign_in('pat');
select photo_test.post(photo_test.image(photo_test.path('pat'), 1200, 800), 'Nice goal', photo_test.first());
reset role;
select photo_test.ok(
  (select body = 'Nice goal' and attachments -> 0 ->> 'type' = 'image'
      and attachments -> 0 ->> 'path' = photo_test.path('pat')
   from public.messages where id = photo_test.first()),
  'a teammate posts a photo with a caption');

select photo_test.sign_in('pat');
select photo_test.post(
  photo_test.image(photo_test.path('pat', '00000000-0000-4000-8000-00000000f2b2')),
  'Photo',
  '00000000-0000-4000-8000-00000000f2f2');
reset role;
select photo_test.ok(
  (select body = 'Photo' and attachments -> 0 ->> 'type' = 'image'
   from public.messages where id = '00000000-0000-4000-8000-00000000f2f2'),
  'a photo with no caption says Photo');

select photo_test.sign_in('pat');
select photo_test.refused(
  format($sql$select photo_test.post(%L::jsonb)$sql$, photo_test.image(photo_test.path('kim'))::text),
  'a photo in someone else''s folder is refused');
select photo_test.refused(
  $sql$select photo_test.post('[{"type": "image", "path": "not-a-uuid/file.webp", "width": 800, "height": 600}]'::jsonb)$sql$,
  'or one with a bad path');
select photo_test.refused(
  format(
    $sql$select photo_test.post(%L::jsonb)$sql$,
    jsonb_build_array(jsonb_build_object(
      'type', 'image',
      'path', photo_test.id('pat')::text || '/00000000-0000-4000-8000-00000000f2b3.png',
      'width', 800,
      'height', 600
    ))::text
  ),
  'or one that isn''t webp/jpeg');
select photo_test.refused(
  format(
    $sql$select photo_test.post(%L::jsonb)$sql$,
    jsonb_build_array(jsonb_build_object(
      'type', 'image',
      'path', photo_test.path('pat', '00000000-0000-4000-8000-00000000f2b6'),
      'width', 800,
      'height', 600,
      'url', 'x'
    ))::text
  ),
  'and nothing extra');
select photo_test.refused(
  format(
    $sql$select photo_test.post(%L::jsonb)$sql$,
    (photo_test.image(photo_test.path('pat', '00000000-0000-4000-8000-00000000f2b4'))
      || photo_test.image(photo_test.path('pat', '00000000-0000-4000-8000-00000000f2b5')))::text
  ),
  'one photo per message');
select photo_test.refused(
  format(
    $sql$select photo_test.post(%L::jsonb)$sql$,
    jsonb_build_array(jsonb_build_object(
      'path', photo_test.path('kim'),
      'width', 1,
      'height', 1
    ))::text
  ),
  'a path without type is refused');
reset role;

select photo_test.sign_in('zed');
select photo_test.refused(
  format($sql$select photo_test.post(%L::jsonb)$sql$, photo_test.image(photo_test.path('zed'))::text),
  'someone who hasn''t entered the team code can''t post one');
reset role;

-- ---------------------------------------------------------------------------
-- After posting: fixed, but it can go
-- ---------------------------------------------------------------------------

select photo_test.sign_in('pat');
select photo_test.refused(
  $$update public.messages set body = 'changed caption' where id = photo_test.first()$$,
  'a photo''s caption can''t be edited');
select photo_test.refused(
  format(
    $sql$update public.messages set attachments = %L::jsonb where id = photo_test.first()$sql$,
    photo_test.image(photo_test.path('pat', '00000000-0000-4000-8000-00000000f2b9'))::text
  ),
  'and the photo can''t be swapped');
reset role;

select photo_test.sign_in('kim');
delete from public.messages where id = photo_test.first();
reset role;
select photo_test.ok(
  not exists (select 1 from public.messages where id = photo_test.first()),
  'captains can delete a photo like any message');

select photo_test.ok(
  exists (select 1 from storage.buckets where id = 'chat-media' and public is false),
  'the chat-media bucket is private');

-- ---------------------------------------------------------------------------
-- Storage: uploads and who can read a file
-- ---------------------------------------------------------------------------

select photo_test.sign_in('pat');
select photo_test.upload('pat', '00000000-0000-4000-8000-00000000f2c1');
select photo_test.post(
  photo_test.image(photo_test.path('pat', '00000000-0000-4000-8000-00000000f2c1')),
  'Team board',
  '00000000-0000-4000-8000-00000000f2f3');
reset role;
select photo_test.ok(
  (select count(*) from storage.objects where name = photo_test.path('pat', '00000000-0000-4000-8000-00000000f2c1')) = 1,
  'a player uploads a photo into their own folder');

select photo_test.sign_in('pat');
select photo_test.refused(
  $$select photo_test.upload('kim', '00000000-0000-4000-8000-00000000f2c9')$$,
  'but not into someone else''s');
reset role;

select photo_test.sign_in('sam');
select photo_test.ok(
  (select count(*) from storage.objects where name = photo_test.path('pat', '00000000-0000-4000-8000-00000000f2c1')) = 1,
  'a teammate can read a Team Chat photo');
reset role;

select photo_test.sign_in('zed');
select photo_test.ok(
  (select count(*) from storage.objects where bucket_id = 'chat-media') = 0,
  'someone who hasn''t joined can''t read chat photos');
select photo_test.refused(
  $$select photo_test.upload('zed', '00000000-0000-4000-8000-00000000f2c8')$$,
  'or upload one');
reset role;

-- Private chat: only members see the photo.
select photo_test.sign_in('pat');
select public.chat_start_private('Photo ride', array[photo_test.id('kim')]);
insert into storage.objects (bucket_id, name, owner)
  values ('chat-media', photo_test.path('pat', '00000000-0000-4000-8000-00000000f2c2'), auth.uid());
insert into public.messages (id, thread_id, user_id, author_name, body, attachments)
  select '00000000-0000-4000-8000-00000000f2f4', t.id, auth.uid(), 'Pat', 'Private pic',
         photo_test.image(photo_test.path('pat', '00000000-0000-4000-8000-00000000f2c2'))
  from public.chat_threads t where t.title = 'Photo ride' and t.visibility = 'private';
reset role;

select photo_test.sign_in('kim');
select photo_test.ok(
  (select count(*) from storage.objects where name = photo_test.path('pat', '00000000-0000-4000-8000-00000000f2c2')) = 1,
  'a private-chat member can read its photo');
reset role;

select photo_test.sign_in('sam');
select photo_test.ok(
  (select count(*) from storage.objects where name = photo_test.path('pat', '00000000-0000-4000-8000-00000000f2c2')) = 0,
  'a teammate outside the private chat can''t');
reset role;

-- Captains' Lounge: only captains.
select photo_test.sign_in('kim');
insert into storage.objects (bucket_id, name, owner)
  values ('chat-media', photo_test.path('kim', '00000000-0000-4000-8000-00000000f2c3'), auth.uid());
insert into public.messages (id, thread_id, user_id, author_name, body, attachments)
  select '00000000-0000-4000-8000-00000000f2f5', t.id, auth.uid(), 'Kim', 'Lounge pic',
         photo_test.image(photo_test.path('kim', '00000000-0000-4000-8000-00000000f2c3'))
  from public.chat_threads t where t.visibility = 'captains' limit 1;
reset role;

select photo_test.sign_in('kim');
select photo_test.ok(
  (select count(*) from storage.objects where name = photo_test.path('kim', '00000000-0000-4000-8000-00000000f2c3')) = 1,
  'a captain can read a Lounge photo');
reset role;

select photo_test.sign_in('pat');
select photo_test.ok(
  (select count(*) from storage.objects where name = photo_test.path('kim', '00000000-0000-4000-8000-00000000f2c3')) = 0,
  'a player can''t read a Lounge photo');
reset role;

-- Own folder is still readable even with no message (fresh upload before send).
select photo_test.sign_in('pat');
select photo_test.upload('pat', '00000000-0000-4000-8000-00000000f2c4');
select photo_test.ok(
  (select count(*) from storage.objects where name = photo_test.path('pat', '00000000-0000-4000-8000-00000000f2c4')) = 1,
  'the uploader can read their own folder before the message posts');
reset role;

select photo_test.sign_in('sam');
select photo_test.ok(
  (select count(*) from storage.objects where name = photo_test.path('pat', '00000000-0000-4000-8000-00000000f2c4')) = 0,
  'teammates can''t read an unposted upload');
reset role;

rollback;
