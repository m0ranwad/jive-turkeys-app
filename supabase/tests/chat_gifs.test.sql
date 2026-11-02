-- GIFs in chat (docs/chat.md section 8): only one GIF from KLIPY's servers per
-- message, and once posted it can't be changed, only deleted. Run by
-- scripts/test-db.sh after every migration is applied. Everything happens in
-- one transaction that's rolled back, so the other test files never see it.
-- The first failed check stops the run with "FAILED: <what was expected>".

begin;

create schema gif_test;
grant usage on schema gif_test to authenticated, anon;

create table gif_test.people (name text primary key, id uuid not null);
grant select on gif_test.people to authenticated, anon;

create function gif_test.id(who text) returns uuid language sql stable as $$
  select id from gif_test.people where name = who;
$$;

create function gif_test.ok(passed boolean, what text) returns void language plpgsql as $$
begin
  if passed is not true then
    raise exception 'FAILED: %', what;
  end if;
  raise notice 'ok - %', what;
end;
$$;

create function gif_test.refused(statement text, what text) returns void language plpgsql as $$
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

grant execute on all functions in schema gif_test to authenticated, anon;

create function gif_test.sign_in(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', gif_test.id(who)::text, false);
  perform set_config('role', 'authenticated', false);
end;
$$;

-- A GIF message from the signed-in player, as the chat sends it.
create function gif_test.post(attachments jsonb, body text default 'GIF', new_id uuid default gen_random_uuid()) returns uuid language plpgsql as $$
begin
  insert into public.messages (id, user_id, author_name, body, attachments)
    values (new_id, auth.uid(), 'Pat', body, attachments);
  return new_id;
end;
$$;
grant execute on function gif_test.post(jsonb, text, uuid) to authenticated;

-- The two messages the checks follow.
create function gif_test.first() returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-00000000f1f1'::uuid $$;
create function gif_test.plain() returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-00000000f1f2'::uuid $$;
grant execute on function gif_test.first(), gif_test.plain() to authenticated;

insert into gif_test.people values
  ('kim', '00000000-0000-4000-8000-00000000f1a1'),
  ('pat', '00000000-0000-4000-8000-00000000f1a2'),
  ('zed', '00000000-0000-4000-8000-00000000f1a3');

insert into auth.users (id, email) select id, name || '@gifs.test' from gif_test.people;
update public.users set role = case when id = gif_test.id('kim') then 'admin' else 'user' end,
  joined_team_at = case when id = gif_test.id('zed') then null else now() end
  where id in (select id from gif_test.people);

-- ---------------------------------------------------------------------------
-- Posting
-- ---------------------------------------------------------------------------

select gif_test.sign_in('pat');
select gif_test.post(
  '[{"type": "gif", "url": "https://static.klipy.com/ii/abc/de/fg/goal.webp", "width": 300, "height": 200, "title": "Goal!"}]',
  'GIF', gif_test.first());
reset role;
select gif_test.ok(
  (select body = 'GIF' and attachments -> 0 ->> 'url' = 'https://static.klipy.com/ii/abc/de/fg/goal.webp'
   from public.messages where id = gif_test.first()),
  'a teammate posts a GIF from KLIPY: the message says "GIF" and keeps the GIF');

select gif_test.sign_in('pat');
select gif_test.refused(
  $$select gif_test.post('[{"type": "gif", "url": "https://evil.example/track.gif", "width": 300, "height": 200}]')$$,
  'a GIF from anywhere but KLIPY''s servers is refused');
select gif_test.refused(
  $$select gif_test.post('[{"type": "gif", "url": "http://static.klipy.com/ii/a.gif", "width": 300, "height": 200}]')$$,
  'or one that isn''t https');
select gif_test.refused(
  $$select gif_test.post('[{"type": "gif", "url": "https://static.klipy.com.evil.example/a.gif", "width": 300, "height": 200}]')$$,
  'or one from a look-alike address');
select gif_test.refused(
  $$select gif_test.post('[{"type": "image", "url": "https://static.klipy.com/ii/a.gif", "width": 300, "height": 200}]')$$,
  'only GIFs (photos aren''t part of this)');
select gif_test.refused(
  $$select gif_test.post('[{"type": "gif", "url": "https://static.klipy.com/ii/a.gif", "width": 300, "height": 200}, {"type": "gif", "url": "https://static.klipy.com/ii/b.gif", "width": 300, "height": 200}]')$$,
  'one GIF per message');
select gif_test.refused(
  $$select gif_test.post('[{"type": "gif", "url": "https://static.klipy.com/ii/a.gif", "width": "300", "height": 200}]')$$,
  'with its size as numbers');
select gif_test.refused(
  $$select gif_test.post('[{"type": "gif", "url": "https://static.klipy.com/ii/a.gif", "width": 300, "height": 200, "onclick": "x"}]')$$,
  'and nothing extra');
select gif_test.refused(
  $$select gif_test.post('{"type": "gif", "url": "https://static.klipy.com/ii/a.gif", "width": 300, "height": 200}')$$,
  'as a list, the way the chat sends it');
reset role;

select gif_test.sign_in('zed');
select gif_test.refused(
  $$select gif_test.post('[{"type": "gif", "url": "https://static.klipy.com/ii/a.gif", "width": 300, "height": 200}]')$$,
  'someone who hasn''t entered the team code can''t post one');
reset role;

-- ---------------------------------------------------------------------------
-- After posting: fixed, but it can go
-- ---------------------------------------------------------------------------

select gif_test.sign_in('pat');
select gif_test.refused(
  $$update public.messages set body = 'not a gif' where id = gif_test.first()$$,
  'a GIF''s text can''t be edited');
select gif_test.refused(
  $$update public.messages set attachments = '[{"type": "gif", "url": "https://static.klipy.com/ii/other.gif", "width": 300, "height": 200}]'
    where id = gif_test.first()$$,
  'and the GIF can''t be swapped');
select gif_test.post(null, 'Plain words', gif_test.plain());
update public.messages set body = 'Plain words, fixed' where id = gif_test.plain();
reset role;
select gif_test.ok(
  (select body = 'Plain words, fixed' and edited_date is not null and attachments is null
   from public.messages where id = gif_test.plain()),
  'ordinary messages still edit as before');

select gif_test.sign_in('kim');
delete from public.messages where id = gif_test.first();
reset role;
select gif_test.ok(
  not exists (select 1 from public.messages where id = gif_test.first()),
  'captains can delete a GIF like any message');

rollback;
