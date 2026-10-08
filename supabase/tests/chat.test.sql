-- Team Chat database tests: who can do what (row level security), what
-- deleting removes, and what must never be removed. Run by
-- scripts/test-db.sh on a fresh database with every migration applied.
-- The first failed check stops the run with "FAILED: <what was expected>".

-- ---------------------------------------------------------------------------
-- Helpers (a throwaway schema; the app never sees it)
-- ---------------------------------------------------------------------------

create schema test;
grant usage on schema test to authenticated, anon;

create table test.people (name text primary key, id uuid not null);
grant select on test.people to authenticated, anon;

create function test.id(who text) returns uuid language sql stable as $$
  select id from test.people where name = who;
$$;

create function test.ok(passed boolean, what text) returns void language plpgsql as $$
begin
  if passed is not true then
    raise exception 'FAILED: %', what;
  end if;
  raise notice 'ok - %', what;
end;
$$;

-- Runs a statement as the current role and expects it to be refused.
create function test.refused(statement text, what text) returns void language plpgsql as $$
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
create function test.touches(statement text, expected integer, what text) returns void language plpgsql as $$
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

grant execute on all functions in schema test to authenticated, anon;

-- Signs in as one of the test people for the statements that follow.
create function test.sign_in(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', test.id(who)::text, false);
  perform set_config('role', 'authenticated', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- People: a captain (first sign-up) and three players
-- ---------------------------------------------------------------------------

insert into test.people values
  ('cap', '00000000-0000-4000-8000-00000000000a'),
  ('ann', '00000000-0000-4000-8000-00000000000b'),
  ('bob', '00000000-0000-4000-8000-00000000000c'),
  ('cy', '00000000-0000-4000-8000-00000000000d');

insert into auth.users (id, email) select id, name || '@test.local' from test.people order by name = 'cap' desc, name;

select test.ok((select role from public.users where id = test.id('cap')) = 'admin', 'the first sign-up becomes a captain');
select test.ok((select role from public.users where id = test.id('ann')) = 'user', 'later sign-ups are players');

-- A message from before this sign-up flow, so "unread since you joined" has something to skip.
insert into public.messages (user_id, author_name, body, created_date)
values (test.id('cap'), 'Cap', 'Ancient history', now() - interval '30 days');
update public.users set created_date = now() - interval '1 day';

-- ---------------------------------------------------------------------------
-- Team Chat messages
-- ---------------------------------------------------------------------------

select test.sign_in('ann');

select test.touches($$insert into public.messages (user_id, author_name, body) values (test.id('ann'), 'Ann', 'Who has pinnies?')$$, 1,
  'a player posts in Team Chat as themselves');
select test.refused($$insert into public.messages (user_id, author_name, body) values (test.id('bob'), 'Bob', 'I am Bob')$$,
  'a player cannot post as someone else');
select test.refused($$insert into public.messages (user_id, author_name, body) values (test.id('ann'), 'Ann', '')$$,
  'empty messages are refused');
select test.refused(format($$insert into public.messages (user_id, author_name, body) values (test.id('ann'), 'Ann', %L)$$, repeat('x', 2001)),
  'messages over 2000 characters are refused');
select test.ok((select count(*) from public.messages) = 2, 'players can read every Team Chat message');

select test.sign_in('bob');
insert into public.messages (user_id, author_name, body, reply_to_id)
select test.id('bob'), 'Bob', 'I do', id from public.messages where body = 'Who has pinnies?';
select test.ok((select reply_to_id is not null from public.messages where body = 'I do'), 'a reply points at the message it answers');
select test.touches($$delete from public.messages where body = 'Who has pinnies?'$$, 0, 'a player cannot delete someone else''s message');
select test.touches($$update public.messages set body = 'edited' where body = 'Who has pinnies?'$$, 0, 'players cannot edit messages (no edit feature yet)');

-- ---------------------------------------------------------------------------
-- Reactions
-- ---------------------------------------------------------------------------

select test.touches($$insert into public.message_reactions (message_id, user_id, emoji) select id, test.id('bob'), '👍' from public.messages where body = 'Who has pinnies?'$$, 1,
  'a player reacts as themselves');
select test.refused($$insert into public.message_reactions (message_id, user_id, emoji) select id, test.id('bob'), '👍' from public.messages where body = 'Who has pinnies?'$$,
  'the same reaction twice is refused');
select test.touches($$insert into public.message_reactions (message_id, user_id, emoji) select id, test.id('bob'), '🔥' from public.messages where body = 'Who has pinnies?'$$, 1,
  'a player can add a different emoji to the same message');
select test.refused($$insert into public.message_reactions (message_id, user_id, emoji) select id, test.id('cy'), '👍' from public.messages where body = 'Who has pinnies?'$$,
  'a player cannot react as someone else');

select test.sign_in('cy');
insert into public.message_reactions (message_id, user_id, emoji) select id, test.id('cy'), '😂' from public.messages where body = 'Who has pinnies?';
select test.touches($$delete from public.message_reactions where user_id = test.id('bob')$$, 0, 'a player cannot remove someone else''s reaction');
select test.touches($$delete from public.message_reactions where user_id = test.id('cy')$$, 1, 'a player removes their own reaction');
insert into public.message_reactions (message_id, user_id, emoji) select id, test.id('cy'), '😂' from public.messages where body = 'Who has pinnies?';

-- ---------------------------------------------------------------------------
-- Threads
-- ---------------------------------------------------------------------------

select test.sign_in('ann');
select test.touches($$insert into public.chat_threads (title, created_by, author_name) values ('⚽ Pickup', test.id('ann'), 'Ann')$$, 1,
  'a player starts a thread as themselves');
select test.refused($$insert into public.chat_threads (title, created_by) values ('Fake', test.id('bob'))$$,
  'a player cannot start a thread as someone else');
select test.refused($$insert into public.chat_threads (title, created_by) values ('', test.id('ann'))$$, 'thread topics cannot be empty');
select test.refused(format($$insert into public.chat_threads (title, created_by) values (%L, test.id('ann'))$$, repeat('x', 81)),
  'thread topics are 80 characters at most');

insert into public.messages (user_id, author_name, body, thread_id)
select test.id('ann'), 'Ann', 'Sunday at 10?', id from public.chat_threads where title = '⚽ Pickup';

select test.sign_in('bob');
select test.touches($$insert into public.messages (user_id, author_name, body, thread_id) select test.id('bob'), 'Bob', 'In', id from public.chat_threads where title = '⚽ Pickup'$$, 1,
  'anyone can post in an open thread');
select test.touches($$update public.chat_threads set title = 'Hijacked' where title = '⚽ Pickup'$$, 0,
  'a player cannot rename someone else''s thread');
select test.touches($$update public.chat_threads set archived = true where title = '⚽ Pickup'$$, 0,
  'a player cannot close someone else''s thread');
select test.touches($$delete from public.chat_threads where title = '⚽ Pickup'$$, 0, 'a player cannot delete someone else''s thread');

select test.sign_in('ann');
select test.touches($$update public.chat_threads set title = '⚽ Sunday pickup' where title = '⚽ Pickup'$$, 1, 'the starter renames their thread');
select test.touches($$update public.chat_threads set archived = true where title = '⚽ Sunday pickup'$$, 1, 'the starter closes their thread');

select test.sign_in('bob');
select test.refused($$insert into public.messages (user_id, author_name, body, thread_id) select test.id('bob'), 'Bob', 'Late', id from public.chat_threads where title = '⚽ Sunday pickup'$$,
  'nobody can post in a closed thread');
select test.ok((select count(*) from public.messages m join public.chat_threads t on t.id = m.thread_id where t.title = '⚽ Sunday pickup') = 2,
  'a closed thread keeps its messages readable');

select test.sign_in('cap');
select test.touches($$update public.chat_threads set archived = false where title = '⚽ Sunday pickup'$$, 1, 'a captain reopens anyone''s thread');
select test.sign_in('bob');
select test.touches($$insert into public.messages (user_id, author_name, body, thread_id) select test.id('bob'), 'Bob', 'Back in', id from public.chat_threads where title = '⚽ Sunday pickup'$$, 1,
  'posting works again once a thread is reopened');

-- ---------------------------------------------------------------------------
-- Read markers and the unread summary
-- ---------------------------------------------------------------------------

select test.sign_in('cy');
select test.ok((select unread from public.chat_overview() where thread_id is null) = 2,
  'Team Chat unread counts others'' messages since you joined (not older history, not your own)');
select test.ok((select unread from public.chat_overview() t join public.chat_threads c on c.id = t.thread_id where c.title = '⚽ Sunday pickup') = 3,
  'thread unread counts every message from others');
select test.ok((select last_body from public.chat_overview() where thread_id is null) = 'I do', 'the summary shows the latest message');
select test.ok((select last_read_at from public.chat_overview() where thread_id is null) is null, 'rooms never opened have no read marker');

select public.chat_mark_read(null, now());
select public.chat_mark_read(null, now());
select test.ok((select count(*) from public.chat_reads where thread_id is null) = 1, 'marking Team Chat read twice keeps one marker');
select test.ok((select unread from public.chat_overview() where thread_id is null) = 0, 'Team Chat shows nothing unread after reading');
select public.chat_mark_read(null, now() - interval '1 hour');
select test.ok((select last_read_at > now() - interval '1 minute' from public.chat_reads where thread_id is null),
  'the read marker never moves backwards');
select test.refused($$insert into public.chat_reads (user_id, thread_id) values (test.id('ann'), null)$$, 'a player cannot set someone else''s read marker');

select test.sign_in('ann');
select test.ok((select count(*) from public.chat_reads) = 0, 'read markers are private to each player');

reset role;
set role anon;
select test.refused($$select * from public.chat_overview()$$, 'signed-out visitors cannot use the chat summary');
select test.refused($$select public.chat_mark_read(null, now())$$, 'signed-out visitors cannot mark rooms read');
select test.refused($$select * from public.messages$$, 'signed-out visitors cannot read messages');
select test.refused($$select * from public.chat_threads$$, 'signed-out visitors cannot read threads');
select test.refused($$select * from public.message_reactions$$, 'signed-out visitors cannot read reactions');
reset role;

-- ---------------------------------------------------------------------------
-- Deleting: what goes, and what stays
-- ---------------------------------------------------------------------------

select test.sign_in('ann');
select test.touches($$delete from public.messages where body = 'Who has pinnies?'$$, 1, 'a player deletes their own message');
reset role;
select test.ok((select count(*) from public.message_reactions) = 0, 'deleting a message removes its reactions');
select test.ok((select reply_to_id is null from public.messages where body = 'I do'), 'replies to a deleted message stay, without the link');

select test.sign_in('cap');
select test.touches($$delete from public.messages where body = 'I do'$$, 1, 'a captain deletes anyone''s message');

-- A thread's delete takes only that thread's messages.
insert into public.messages (user_id, author_name, body) values (test.id('cap'), 'Cap', 'Team Chat stays');
insert into public.chat_threads (title, created_by, author_name) values ('Doomed', test.id('cap'), 'Cap');
insert into public.messages (user_id, author_name, body, thread_id) select test.id('cap'), 'Cap', 'In the doomed thread', id from public.chat_threads where title = 'Doomed';
select public.chat_mark_read((select id from public.chat_threads where title = 'Doomed'), now());
select test.touches($$delete from public.chat_threads where title = 'Doomed'$$, 1, 'a captain deletes any thread');
reset role;
select test.ok(not exists (select 1 from public.messages where body = 'In the doomed thread'), 'deleting a thread removes its messages');
select test.ok(not exists (select 1 from public.chat_reads r left join public.chat_threads t on t.id = r.thread_id where r.thread_id is not null and t.id is null),
  'deleting a thread removes its read markers');
select test.ok(exists (select 1 from public.messages where body = 'Team Chat stays'), 'deleting a thread leaves Team Chat alone');
select test.ok(exists (select 1 from public.messages m join public.chat_threads t on t.id = m.thread_id where t.title = '⚽ Sunday pickup'),
  'deleting a thread leaves other threads alone');

-- A player leaving the site (their account deleted) must not take the chat with them.
select test.sign_in('bob');
insert into public.message_reactions (message_id, user_id, emoji) select id, test.id('bob'), '👍' from public.messages where body = 'Team Chat stays';
insert into public.chat_threads (title, created_by, author_name) values ('Bob''s thread', test.id('bob'), 'Bob');
insert into public.messages (user_id, author_name, body, thread_id) select test.id('bob'), 'Bob', 'Bob was here', id from public.chat_threads where title = 'Bob''s thread';
reset role;
delete from auth.users where id = test.id('bob');
select test.ok((select count(*) from public.messages where author_name = 'Bob') = 3, 'a deleted account''s messages stay');
select test.ok((select bool_and(user_id is null) from public.messages where author_name = 'Bob'), 'they stay under the name they posted with');
select test.ok(exists (select 1 from public.chat_threads where title = 'Bob''s thread' and created_by is null), 'a deleted account''s threads stay');
select test.ok(not exists (select 1 from public.message_reactions where emoji = '👍'), 'a deleted account''s reactions go');

-- ---------------------------------------------------------------------------
-- Guards for future changes
-- ---------------------------------------------------------------------------

-- How each link involving chat behaves on delete. Changing any of these can
-- silently delete chat history (for example, making messages.user_id cascade
-- would erase a player's messages when their account goes).
select test.ok(
  (
    select string_agg(link, ', ' order by link)
    from (
      select format('%s.%s->%s:%s', c.conrelid::regclass, a.attname, c.confrelid::regclass, c.confdeltype) as link
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f'
        and (c.conrelid::regclass::text in ('messages', 'chat_threads', 'message_reactions', 'chat_reads')
          or c.confrelid::regclass::text in ('messages', 'chat_threads'))
    ) links
  ) = 'chat_reads.thread_id->chat_threads:c, chat_reads.user_id->users:c, chat_threads.created_by->users:n, '
      'message_reactions.message_id->messages:c, message_reactions.user_id->users:c, messages.reply_to_id->messages:n, '
      'messages.thread_id->chat_threads:c, messages.user_id->users:n',
  'chat links keep their delete rules (messages and threads outlive accounts; only deleting a thread removes its messages)'
);

select test.ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  ),
  'every table has row level security on'
);

select test.ok(
  not exists (
    select 1 from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'
  ),
  'signed-out visitors have no access to any table'
);

select test.ok(
  (select array_agg(tablename::text order by tablename) from pg_publication_tables where pubname = 'supabase_realtime')
    @> array['chat_threads', 'message_reactions', 'messages'],
  'messages, threads and reactions are live (in the realtime publication)'
);

select test.ok(
  not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and cmd in ('DELETE', 'ALL')
      and qual not like '%auth.uid()%'
  ),
  'deleting messages still needs to be the author or a captain'
);
