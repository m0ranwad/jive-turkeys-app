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
-- Everyone here has joined the team with its code (membership.test.sql covers who hasn't).
update public.users set joined_team_at = now();

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
select test.touches($$update public.messages set body = 'edited' where body = 'Who has pinnies?'$$, 0, 'a player cannot edit someone else''s message');

-- Editing your own message: the text only, marked edited, and never as anyone else.
select test.sign_in('ann');
select test.touches($$update public.messages set body = 'Who has the pinnies?' where body = 'Who has pinnies?'$$, 1,
  'a player fixes a typo in their own message');
select test.ok((select edited_date is not null from public.messages where body = 'Who has the pinnies?'), 'and it''s marked edited');
select test.ok((select edited_date is null from public.messages where body = 'I do'), 'other messages aren''t');
select test.refused($$update public.messages set user_id = test.id('bob') where body = 'Who has the pinnies?'$$,
  'only the text can change, not who wrote it');
select test.refused($$update public.messages set created_date = now() - interval '1 day' where body = 'Who has the pinnies?'$$,
  'or when');
select test.refused($$update public.messages set edited_date = null where body = 'Who has the pinnies?'$$,
  'or the edited label');
select test.refused($$update public.messages set body = '' where body = 'Who has the pinnies?'$$, 'an edit can''t empty a message');
select test.sign_in('cap');
select test.touches($$update public.messages set body = 'captain was here' where body = 'Who has the pinnies?'$$, 0,
  'captains don''t edit other people''s messages either');
-- Back as it was, for the checks below.
reset role;
update public.messages set body = 'Who has pinnies?', edited_date = null where body = 'Who has the pinnies?';
select test.sign_in('bob');

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
select test.sign_in('ann');
select test.refused(
  $$update public.messages m set body = 'changed' from public.chat_threads t where t.id = m.thread_id and t.title = '⚽ Sunday pickup' and m.user_id = auth.uid()$$,
  'or edit their messages in it');

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
        and (c.conrelid::regclass::text in ('messages', 'chat_threads', 'message_reactions', 'chat_reads', 'chat_thread_members')
          or c.confrelid::regclass::text in ('messages', 'chat_threads'))
    ) links
  ) = 'chat_reads.thread_id->chat_threads:c, chat_reads.user_id->users:c, chat_thread_members.added_by->users:n, '
      'chat_thread_members.thread_id->chat_threads:c, chat_thread_members.user_id->users:c, chat_threads.created_by->users:n, '
      'message_reactions.message_id->messages:c, message_reactions.user_id->users:c, messages.reply_to_id->messages:n, '
      'messages.thread_id->chat_threads:c, messages.user_id->users:n, push_log.message_id->messages:c',
  'chat links keep their delete rules (messages and threads outlive accounts; only deleting a thread removes its messages and member list)'
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
    @> array['chat_thread_members', 'chat_threads', 'message_reactions', 'messages'],
  'messages, threads, reactions and who''s in each private chat are live (in the realtime publication)'
);

select test.ok(
  not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and cmd in ('DELETE', 'ALL')
      and qual not like '%auth.uid()%'
  ),
  'deleting messages still needs to be the author or a captain'
);

-- ---------------------------------------------------------------------------
-- Phone notifications
-- ---------------------------------------------------------------------------

grant usage on schema test to service_role;
grant execute on all functions in schema test to service_role;
grant select on test.people to service_role;

-- Who gets a message, as the notification sender (service role) sees it.
create function test.push_targets(message text) returns text language sql as $$
  select coalesce(string_agg(t.endpoint, ',' order by t.endpoint), '')
  from public.chat_push_targets((select id from public.messages where body = message order by created_date desc limit 1)) t;
$$;
grant execute on function test.push_targets(text) to service_role;

select test.sign_in('ann');
select public.push_subscribe('https://push.test/ann', 'ann-key', 'ann-auth', 'iPhone');
select test.ok((select count(*) from public.push_subscriptions) = 1, 'a player saves their phone for notifications');
select public.push_subscribe('https://push.test/ann', 'ann-key-2', 'ann-auth-2', 'iPhone');
select test.ok((select p256dh from public.push_subscriptions) = 'ann-key-2', 'saving the same phone again updates it instead of adding another');
select test.refused($$insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (test.id('cy'), 'https://push.test/x', 'k', 'a')$$,
  'a player cannot sign someone else up for notifications');

select test.sign_in('cy');
select test.ok((select count(*) from public.push_subscriptions) = 0, 'players cannot see anyone else''s devices');
select test.touches($$delete from public.push_subscriptions where endpoint = 'https://push.test/ann'$$, 0, 'players cannot remove anyone else''s device');
select public.push_subscribe('https://push.test/cy', 'cy-key', 'cy-auth', 'Android');
select test.refused($$select * from public.chat_push_targets(gen_random_uuid())$$, 'players cannot ask who gets notified');
select test.refused($$select * from public.push_log$$, 'players cannot read the notification log');

select test.sign_in('cap');
select public.push_subscribe('https://push.test/cap', 'cap-key', 'cap-auth', 'Desktop');
-- A shared phone, signed in as cap now, notifies cap instead of its old owner.
select public.push_subscribe('https://push.test/shared', 'k', 'a', 'iPad');
select test.sign_in('ann');
select public.push_subscribe('https://push.test/shared', 'k', 'a', 'iPad');
select test.ok((select count(*) from public.push_subscriptions where endpoint = 'https://push.test/shared') = 1,
  'a device moves to whoever turned notifications on last');
select test.touches($$delete from public.push_subscriptions where endpoint = 'https://push.test/shared'$$, 1, 'a player turns notifications off on their device');

reset role;
set role anon;
select test.refused($$select public.push_subscribe('https://push.test/anon', 'k', 'a', 'x')$$, 'signed-out visitors cannot sign up for notifications');
select test.refused($$select public.chat_viewing(null)$$, 'signed-out visitors cannot check in to a room');
reset role;

-- Posting a message asks the sender to send it out.
truncate net.test_requests;
select test.sign_in('ann');
insert into public.messages (user_id, author_name, body) values (test.id('ann'), 'Ann', 'Push me');
reset role;
select test.ok(
  (select count(*) from net.test_requests r join public.messages m on m.id = (r.body ->> 'message_id')::uuid
    where m.body = 'Push me' and r.url like 'https://%.supabase.co/functions/v1/notify-chat') = 1,
  'posting a message calls the notification sender with its id'
);

set role service_role;
select test.ok(test.push_targets('Push me') = 'https://push.test/cap,https://push.test/cy',
  'Team Chat messages go to everyone with notifications on, except the author');
select test.ok(test.push_targets('Push me') = '', 'each message is sent out only once');
reset role;

insert into public.messages (user_id, author_name, body, created_date) values (test.id('ann'), 'Ann', 'Old news', now() - interval '11 minutes');
set role service_role;
select test.ok(test.push_targets('Old news') = '', 'messages older than 10 minutes are not sent');
reset role;

-- Someone looking at the room doesn't get buzzed for it.
select test.sign_in('cy');
select public.chat_viewing(null);
select test.ok((select viewing_at > now() - interval '5 seconds' from public.chat_reads where thread_id is null), 'the chat page checks in while it is on screen');
select test.sign_in('ann');
insert into public.messages (user_id, author_name, body) values (test.id('ann'), 'Ann', 'While cy watches');
set role service_role;
select test.ok(test.push_targets('While cy watches') = 'https://push.test/cap', 'whoever is looking at the room right now is skipped');
reset role;
update public.chat_reads set viewing_at = now() - interval '1 minute' where user_id = test.id('cy');
select test.sign_in('ann');
insert into public.messages (user_id, author_name, body) values (test.id('ann'), 'Ann', 'After cy left');
set role service_role;
select test.ok(test.push_targets('After cy left') = 'https://push.test/cap,https://push.test/cy', 'once they leave, they get notified again');
reset role;

-- Threads: the starter and anyone who opened it.
select test.sign_in('ann');
insert into public.chat_threads (title, created_by, author_name) values ('Carpool', test.id('ann'), 'Ann');
select test.sign_in('cap');
select public.chat_mark_read((select id from public.chat_threads where title = 'Carpool'), now());
insert into public.messages (user_id, author_name, body, thread_id) select test.id('cap'), 'Cap', 'Room for 2', id from public.chat_threads where title = 'Carpool';
select test.sign_in('ann');
insert into public.messages (user_id, author_name, body, thread_id) select test.id('ann'), 'Ann', 'Leaving at 6', id from public.chat_threads where title = 'Carpool';
set role service_role;
select test.ok(test.push_targets('Room for 2') = 'https://push.test/ann', 'thread messages go to the thread''s starter');
select test.ok(test.push_targets('Leaving at 6') = 'https://push.test/cap', 'thread messages go to people who opened it, not everyone');
select test.ok((select thread_title from public.chat_push_targets(gen_random_uuid())) is null, 'an unknown message sends nothing');
reset role;

-- The number on the app icon: each notification carries the player's Chat tab number
-- (unreadTotal in src/lib/chat.js: Team Chat, private chats and the Captains' Lounge,
-- plus threads they've opened).
create table test.chat_tab (name text primary key, n bigint not null);
grant insert on test.chat_tab to authenticated;
grant select on test.chat_tab to service_role;
create function test.note_chat_tab(who text) returns void language sql as $$
  insert into test.chat_tab
  select who, coalesce(sum(o.unread) filter (
    where o.thread_id is null or o.visibility is distinct from 'team' or o.last_read_at is not null
  ), 0)
  from public.chat_overview() o;
$$;
grant execute on function test.note_chat_tab(text) to authenticated;
create function test.icon_numbers() returns table (name text, n bigint) language sql as $$
  select p.name, b.unread
  from public.chat_push_unread(array(select id from public.push_subscriptions)) b
  join public.push_subscriptions s on s.id = b.subscription_id
  join test.people p on p.id = s.user_id;
$$;
grant execute on function test.icon_numbers() to service_role;

select test.sign_in('cy');
select public.chat_mark_read(null, now());
select test.sign_in('ann');
insert into public.messages (user_id, author_name, body) values (test.id('ann'), 'Ann', 'Badge one'), (test.id('ann'), 'Ann', 'Badge two');
select test.note_chat_tab('ann');
select test.sign_in('cap');
select test.note_chat_tab('cap');
select test.sign_in('cy');
select test.note_chat_tab('cy');
reset role;
set role service_role;
select test.ok((select n from test.icon_numbers() where name = 'cy') = 2,
  'the app icon counts unread messages since the player last read (not before)');
select test.ok(
  (select count(*) = 3 and bool_and(i.n = t.n) from test.icon_numbers() i join test.chat_tab t using (name))
    and (select count(distinct n) > 1 from test.chat_tab),
  'the app icon shows the same number as each player''s Chat tab (Team Chat plus threads they opened, not their own messages)'
);
select test.ok(not exists (select 1 from public.chat_push_unread(array[gen_random_uuid()])), 'an unknown device gets no number');
reset role;
select test.sign_in('cy');
select test.refused($$select * from public.chat_push_unread(array(select id from public.push_subscriptions))$$,
  'players cannot ask for anyone''s unread count');
reset role;

-- A broken sender never stops a message from being posted.
alter function net.http_post(text, jsonb, jsonb, jsonb, integer) rename to http_post_working;
select test.sign_in('ann');
select test.touches($$insert into public.messages (user_id, author_name, body) values (test.id('ann'), 'Ann', 'Still posts')$$, 1,
  'messages still post when the notification sender is unavailable');
reset role;
alter function net.http_post_working(text, jsonb, jsonb, jsonb, integer) rename to http_post;

-- Deleting a message clears its notification record.
delete from public.messages where body = 'Push me';
select test.ok(not exists (select 1 from public.push_log l left join public.messages m on m.id = l.message_id where m.id is null),
  'deleting a message clears its notification record');

-- ---------------------------------------------------------------------------
-- Searching the chat
-- ---------------------------------------------------------------------------

select test.sign_in('cy');
insert into public.messages (user_id, author_name, body) values
  (test.id('cy'), 'Cy', 'Bring the pinnies Thursday'),
  (test.id('cy'), 'Cy', 'Parking tip: the back lot is closer'),
  (test.id('cy'), 'Cy', 'Dues to Venmo @cory_b-91 please'),
  (test.id('cy'), 'Cy', '100% of us should be there'),
  (test.id('cy'), 'Cy', 'Gate code is 555-4417');
select test.ok(exists (select 1 from public.chat_search('pinnies') where body = 'Bring the pinnies Thursday'), 'search finds a word');
select test.ok(exists (select 1 from public.chat_search('parked') where body like 'Parking tip%'), 'in any form ("parked" finds "parking")');
select test.ok(exists (select 1 from public.chat_search('@cory_b') where body like 'Dues to Venmo%'), 'and handles as typed');
select test.ok(not exists (select 1 from public.chat_search('1%0')), 'a % is just a character, not "anything"');
select test.ok((select array_agg(body) = array['Gate code is 555-4417'] from public.chat_search('-4417')), 'and a leading - too, not "without"');
select test.ok(not exists (select 1 from public.chat_search('x')), 'one letter finds nothing');
select test.ok(exists (select 1 from public.chat_search('Leaving') where thread_title = 'Carpool'), 'thread messages come with their thread''s title');
reset role;

-- ---------------------------------------------------------------------------
-- @mentions (rolled back at the end, so the other test files don't see Dee or Cy's profile)
-- ---------------------------------------------------------------------------

begin;

-- Dee signed up but hasn't entered the team code.
insert into test.people values ('dee', '00000000-0000-4000-8000-00000000000e');
insert into auth.users (id, email) values (test.id('dee'), 'dee@test.local');
-- Cy has a profile, so their notification choices can change.
insert into public.player_profiles (user_id, display_name) values (test.id('cy'), 'Cy');
update public.chat_reads set viewing_at = null;

create function test.mentions_of(message text) returns uuid[] language sql as $$
  select mentions from public.messages where body = message order by created_date desc limit 1;
$$;
grant execute on function test.mentions_of(text) to authenticated, service_role;

select test.sign_in('ann');
select test.touches($$insert into public.messages (user_id, author_name, body, mentions) values (test.id('ann'), 'Ann', '@Cy bring the ball', array[test.id('cy')])$$, 1,
  'a player mentions a teammate');
select test.ok(test.mentions_of('@Cy bring the ball') = array[test.id('cy')], 'the message keeps who it mentions');
insert into public.messages (user_id, author_name, body, mentions)
  values (test.id('ann'), 'Ann', '@Ann @Cy @Cy @Dee @Nobody', array[test.id('ann'), test.id('cy'), test.id('cy'), test.id('dee'), gen_random_uuid()]);
select test.ok(test.mentions_of('@Ann @Cy @Cy @Dee @Nobody') = array[test.id('cy')],
  'only teammates on the site, each once, and never the author');
insert into public.messages (user_id, author_name, body, mentions) values (test.id('ann'), 'Ann', '@Dee hi', array[test.id('dee')]);
select test.ok(test.mentions_of('@Dee hi') is null, 'a message that mentions nobody on the team mentions nobody');
insert into public.messages (user_id, author_name, body, mentions_team) values (test.id('ann'), 'Ann', '@team party at mine', true);
select test.ok((select not mentions_team from public.messages where body = '@team party at mine'), 'players can''t ping the whole team');
select test.sign_in('cap');
insert into public.messages (user_id, author_name, body, mentions_team) values (test.id('cap'), 'Cap', '@team game moved to Field 3', true);
select test.ok((select mentions_team from public.messages where body = '@team game moved to Field 3'), 'captains can');

-- Editing can change who a message mentions, with the same rules; never someone else's.
select test.sign_in('ann');
select test.touches($$update public.messages set body = '@Cap bring the ball', mentions = array[test.id('cap'), test.id('dee')] where body = '@Cy bring the ball'$$, 1,
  'an edit changes who a message mentions');
select test.ok(test.mentions_of('@Cap bring the ball') = array[test.id('cap')], 'with the same rules');
update public.messages set mentions_team = true where body = '@Cap bring the ball';
select test.ok((select not mentions_team from public.messages where body = '@Cap bring the ball'), 'and still no @team for players');
select test.sign_in('cy');
select test.touches($$update public.messages set mentions = array[test.id('cy')] where body = '@Cap bring the ball'$$, 0,
  'players can''t change who someone else''s message mentions');
reset role;

-- The @ count: unread messages that mention you, in any room, including threads you've never opened.
select test.sign_in('ann');
insert into public.messages (user_id, author_name, body, thread_id, mentions)
  select test.id('ann'), 'Ann', '@Cy want a ride?', id, array[test.id('cy')] from public.chat_threads where title = 'Carpool';
select test.sign_in('cy');
select test.ok((select mentions from public.chat_overview() where thread_id is null) = 2,
  'Team Chat counts unread messages that mention you by name or @team');
select test.ok((select o.mentions from public.chat_overview() o join public.chat_threads t on t.id = o.thread_id where t.title = 'Carpool') = 1,
  'mentions count in threads you''ve never opened');
select public.chat_mark_read(null, now());
select test.ok((select mentions from public.chat_overview() where thread_id is null) = 0, 'reading the room clears its mentions');
select test.sign_in('cap');
select test.ok((select coalesce(sum(mentions), 0) from public.chat_overview()) = 1, 'and they''re per player (cap: ann''s edit, not cy''s)');
reset role;

-- Notifications: a mention reaches the player in a thread they haven't opened.
set role service_role;
select test.ok(test.push_targets('@Cy want a ride?') = 'https://push.test/cap,https://push.test/cy',
  'a mention notifies the player even in a thread they haven''t opened');
reset role;

-- With chat messages off, only mentions (and @team) come through.
update public.player_profiles set notify_chat = false where user_id = test.id('cy');
select test.sign_in('ann');
insert into public.messages (user_id, author_name, body) values (test.id('ann'), 'Ann', 'Chatter for nobody in particular');
insert into public.messages (user_id, author_name, body, mentions) values (test.id('ann'), 'Ann', '@Cy you there?', array[test.id('cy')]);
select test.sign_in('cap');
insert into public.messages (user_id, author_name, body, mentions_team) values (test.id('cap'), 'Cap', '@team bring both jerseys', true);
set role service_role;
select test.ok(test.push_targets('Chatter for nobody in particular') = 'https://push.test/cap', 'chat messages off: no ordinary messages');
select test.ok(test.push_targets('@Cy you there?') = 'https://push.test/cap,https://push.test/cy', 'but mentions still come through');
select test.ok(test.push_targets('@team bring both jerseys') = 'https://push.test/ann,https://push.test/cy', 'and @team');
select test.ok((select n from test.icon_numbers() where name = 'cy') = 0, 'with chat messages off, the app icon gets no number');
reset role;

-- With @mentions off as well, nothing.
update public.player_profiles set notify_mentions = false where user_id = test.id('cy');
select test.sign_in('ann');
insert into public.messages (user_id, author_name, body, mentions) values (test.id('ann'), 'Ann', '@Cy hello?', array[test.id('cy')]);
set role service_role;
select test.ok(test.push_targets('@Cy hello?') = 'https://push.test/cap', '@mentions off: no mention notifications');
reset role;
update public.player_profiles set notify_chat = true where user_id = test.id('cy');
select test.sign_in('ann');
insert into public.messages (user_id, author_name, body, thread_id, mentions)
  select test.id('ann'), 'Ann', '@Cy seat saved', id, array[test.id('cy')] from public.chat_threads where title = 'Carpool';
set role service_role;
select test.ok(test.push_targets('@Cy seat saved') = 'https://push.test/cap',
  'chat messages on but @mentions off: only the rooms they follow');
reset role;

-- Someone looking at the room isn't buzzed for a mention there either.
update public.player_profiles set notify_mentions = true where user_id = test.id('cy');
select test.sign_in('cy');
select public.chat_viewing(null);
select test.sign_in('ann');
insert into public.messages (user_id, author_name, body, mentions) values (test.id('ann'), 'Ann', '@Cy look up', array[test.id('cy')]);
set role service_role;
select test.ok(test.push_targets('@Cy look up') = 'https://push.test/cap', 'whoever is looking at the room isn''t buzzed for a mention in it');
reset role;

select test.sign_in('cy');
select test.touches($$update public.player_profiles set notify_mentions = true where user_id = auth.uid()$$, 1, 'a player sets their own @mentions choice');
select test.touches($$update public.player_profiles set notify_mentions = false where user_id <> auth.uid()$$, 0, 'and nobody else''s');
reset role;

rollback;

-- ---------------------------------------------------------------------------
-- Private chats and the Captains' Lounge (rolled back at the end, like
-- @mentions). Everything in a transaction happens at the same now(), so
-- messages here are stamped with clock_timestamp() to keep their order.
-- ---------------------------------------------------------------------------

begin;

-- Cap2 is a second captain, Eve a player, Dee signed up without the team code.
insert into test.people values
  ('cap2', '00000000-0000-4000-8000-0000000000a2'),
  ('eve', '00000000-0000-4000-8000-00000000000f'),
  ('dee', '00000000-0000-4000-8000-00000000000e');
insert into auth.users (id, email) select id, name || '@test.local' from test.people where name in ('cap2', 'eve', 'dee');
update public.users set joined_team_at = now(), role = 'admin' where id = test.id('cap2');
update public.users set joined_team_at = now() where id = test.id('eve');
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
  (test.id('cap2'), 'https://push.test/cap2', 'k', 'a'),
  (test.id('eve'), 'https://push.test/eve', 'k', 'a');
update public.chat_reads set viewing_at = null;

-- Rooms and messages by name, whoever is signed in (these skip the policies).
create function test.room_id(name text) returns uuid language sql security definer as $$
  select id from public.chat_threads where title = name;
$$;
create function test.message_id(text_ text) returns uuid language sql security definer as $$
  select id from public.messages where body = text_ order by created_date desc limit 1;
$$;
create function test.mentions_of(message text) returns uuid[] language sql security definer as $$
  select mentions from public.messages where body = message order by created_date desc limit 1;
$$;
grant execute on function test.room_id(text) to authenticated, service_role;
grant execute on function test.message_id(text) to authenticated, service_role;
grant execute on function test.mentions_of(text) to authenticated, service_role;

-- The Captains' Lounge --------------------------------------------------------

select test.ok((select count(*) from public.chat_threads where visibility = 'captains' and title = 'Captains'' Lounge') = 1,
  'the Captains'' Lounge is built in');

select test.sign_in('cap');
select test.ok(exists (select 1 from public.chat_threads where title = 'Captains'' Lounge'), 'captains see the Lounge');
select test.touches($$insert into public.messages (user_id, author_name, body, thread_id, created_date) values (test.id('cap'), 'Cap', 'Lineup: Eve in goal?', test.room_id('Captains'' Lounge'), clock_timestamp())$$, 1,
  'a captain posts in the Lounge');
select test.touches($$delete from public.chat_threads where title = 'Captains'' Lounge'$$, 0, 'nobody can delete the Lounge, captains included');
select test.touches($$update public.chat_threads set archived = true where title = 'Captains'' Lounge'$$, 0, 'or close it');
select test.refused($$insert into public.chat_threads (title, created_by, visibility) values ('Second lounge', test.id('cap'), 'captains')$$,
  'there''s only the one Lounge');

select test.sign_in('ann');
select test.ok(not exists (select 1 from public.chat_threads where visibility = 'captains'), 'players don''t see the Lounge');
select test.ok(not exists (select 1 from public.messages where body = 'Lineup: Eve in goal?'), 'or its messages');
select test.ok(not exists (select 1 from public.chat_search('Lineup')), 'or find them in search');
select test.ok(not exists (select 1 from public.chat_overview() where thread_id = test.room_id('Captains'' Lounge')), 'or get its unread count');
select test.refused($$insert into public.messages (user_id, author_name, body, thread_id) values (test.id('ann'), 'Ann', 'Let me in', test.room_id('Captains'' Lounge'))$$,
  'players can''t post in the Lounge');
select test.refused($$insert into public.message_reactions (message_id, user_id, emoji) values (test.message_id('Lineup: Eve in goal?'), test.id('ann'), '👍')$$,
  'or react in it');

select test.sign_in('cap2');
select test.ok(exists (select 1 from public.messages where body = 'Lineup: Eve in goal?'), 'every captain sees what''s in the Lounge');
reset role;
update public.users set role = 'user' where id = test.id('cap2');
select test.sign_in('cap2');
select test.ok(not exists (select 1 from public.messages where body = 'Lineup: Eve in goal?'), 'a captain who goes back to being a player loses it');
reset role;
update public.users set role = 'admin' where id = test.id('cap2');

set role service_role;
select test.ok(test.push_targets('Lineup: Eve in goal?') = 'https://push.test/cap2',
  'Lounge messages notify the captains (even ones who never opened it), and no players');
reset role;

select test.sign_in('cap');
insert into public.messages (user_id, author_name, body, thread_id, mentions, mentions_team, created_date)
  values (test.id('cap'), 'Cap', '@team @Ann @Cap2 subs?', test.room_id('Captains'' Lounge'), array[test.id('ann'), test.id('cap2')], true, clock_timestamp());
select test.ok((select mentions = array[test.id('cap2')] and not mentions_team from public.messages where body = '@team @Ann @Cap2 subs?'),
  'in the Lounge, only captains can be mentioned, and @team pings nobody');
reset role;

-- Starting a private chat ------------------------------------------------------

select test.sign_in('ann');
select test.ok(
  (select visibility = 'private' and created_by = test.id('ann')
     from public.chat_start_private('🚗 Ride Thursday', array[test.id('cy'), test.id('dee'), gen_random_uuid(), test.id('cy')])),
  'a player starts a private chat'
);
reset role;
select test.ok(
  (select array_agg(p.name order by p.name) = array['ann', 'cy']
     from public.chat_thread_members tm join test.people p on p.id = tm.user_id where tm.thread_id = test.room_id('🚗 Ride Thursday')),
  'it has the starter and the teammates picked (each once, only teammates on the site)'
);
-- Ann and Cy have been in it a while (see the note at the top of this section).
update public.chat_thread_members set created_date = now() - interval '1 hour' where thread_id = test.room_id('🚗 Ride Thursday');

select test.sign_in('ann');
select test.refused($$select public.chat_start_private('Just me', array[test.id('ann')])$$, 'a private chat needs at least one other teammate');
select test.refused($$select public.chat_start_private('Dee?', array[test.id('dee')])$$, 'who is on the team');
select test.refused($$select public.chat_start_private('', array[test.id('cy')])$$, 'and a name');
select test.refused($$insert into public.chat_threads (title, created_by, author_name, visibility) values ('Sneaky', test.id('ann'), 'Ann', 'private')$$,
  'private chats only start with their people (not as an empty room)');
select test.refused($$insert into public.chat_thread_members (thread_id, user_id) values (test.room_id('🚗 Ride Thursday'), test.id('eve'))$$,
  'nobody adds people by writing to the member list directly');
select test.touches($$insert into public.messages (user_id, author_name, body, thread_id, created_date) values (test.id('ann'), 'Ann', 'Leaving at 6, room for one', test.room_id('🚗 Ride Thursday'), clock_timestamp())$$, 1,
  'people in a private chat post in it');

select test.sign_in('cy');
select test.ok(exists (select 1 from public.messages where body = 'Leaving at 6, room for one'), 'and read it');
select test.ok((select count(*) from public.chat_thread_members where thread_id = test.room_id('🚗 Ride Thursday')) = 2, 'and see who''s in it');
select test.ok((select unread = 1 and visibility = 'private' from public.chat_overview() where thread_id = test.room_id('🚗 Ride Thursday')),
  'it counts as unread even before they open it');
select test.ok(exists (select 1 from public.chat_search('room for one') where thread_title = '🚗 Ride Thursday'), 'and shows up in their search');
select test.touches($$insert into public.message_reactions (message_id, user_id, emoji) values (test.message_id('Leaving at 6, room for one'), test.id('cy'), '🙏')$$, 1,
  'and they react in it');

-- Captains can't read private chats ----------------------------------------------

select test.sign_in('cap');
select test.ok(not exists (select 1 from public.chat_threads where visibility = 'private'), 'captains don''t see private chats they aren''t in');
select test.ok(not exists (select 1 from public.messages where body = 'Leaving at 6, room for one'), 'or their messages');
select test.ok(not exists (select 1 from public.message_reactions where emoji = '🙏'), 'or reactions');
select test.ok(not exists (select 1 from public.chat_thread_members), 'or who''s in them');
select test.ok(not exists (select 1 from public.chat_search('room for one')), 'or find them in search');
select test.ok(not exists (select 1 from public.chat_overview() where thread_id = test.room_id('🚗 Ride Thursday')), 'or get their unread count');
select test.refused($$insert into public.messages (user_id, author_name, body, thread_id) values (test.id('cap'), 'Cap', 'Hi', test.room_id('🚗 Ride Thursday'))$$,
  'captains can''t post in them');
select test.touches($$delete from public.messages where id = test.message_id('Leaving at 6, room for one')$$, 0, 'or delete messages in them');
select test.touches($$delete from public.message_reactions where emoji = '🙏'$$, 0, 'or remove reactions');
select test.touches($$update public.chat_threads set title = 'Mine now' where id = test.room_id('🚗 Ride Thursday')$$, 0, 'or rename them');
select test.touches($$delete from public.chat_threads where id = test.room_id('🚗 Ride Thursday')$$, 0, 'or delete them');
select test.refused($$select public.chat_add_members(test.room_id('🚗 Ride Thursday'), array[test.id('cap')])$$, 'or add themselves');

select test.sign_in('eve');
select test.ok(not exists (select 1 from public.messages where body = 'Leaving at 6, room for one'), 'other players don''t see them either');

-- Notifications and mentions follow who's in it.
set role service_role;
select test.ok(test.push_targets('Leaving at 6, room for one') = 'https://push.test/cy',
  'private chat messages notify everyone in it (even before they open it), and nobody else');
reset role;
select test.sign_in('ann');
insert into public.messages (user_id, author_name, body, thread_id, mentions, created_date)
  values (test.id('ann'), 'Ann', '@Cap @Cy who drives?', test.room_id('🚗 Ride Thursday'), array[test.id('cap'), test.id('cy')], clock_timestamp());
select test.ok(test.mentions_of('@Cap @Cy who drives?') = array[test.id('cy')], 'a private chat only mentions people in it');
set role service_role;
select test.ok(test.push_targets('@Cap @Cy who drives?') = 'https://push.test/cy', 'so a mention can''t notify anyone outside it');
reset role;

-- Managing a private chat ----------------------------------------------------------

select test.sign_in('ann');
select test.refused($$update public.chat_threads set visibility = 'team' where id = test.room_id('🚗 Ride Thursday')$$,
  'a private chat can never be opened up to the team');
select test.touches($$update public.chat_threads set title = '🚗 Ride Friday' where id = test.room_id('🚗 Ride Thursday')$$, 1, 'the starter renames it');
select test.sign_in('cy');
select test.touches($$update public.chat_threads set title = 'Cy''s now' where id = test.room_id('🚗 Ride Friday')$$, 0, 'others in it can''t');
select test.touches($$delete from public.chat_threads where id = test.room_id('🚗 Ride Friday')$$, 0, 'or delete it');
select test.refused($$update public.chat_threads set visibility = 'team' where id = test.room_id('Captains'' Lounge')$$,
  'and no room changes kind');

-- Adding people: they see the whole chat, but what came before isn't unread for them.
select public.chat_add_members(test.room_id('🚗 Ride Friday'), array[test.id('eve'), test.id('dee')]);
reset role;
update public.chat_thread_members set created_date = clock_timestamp() where user_id = test.id('eve');
select test.ok((select count(*) from public.chat_thread_members where thread_id = test.room_id('🚗 Ride Friday')) = 3,
  'anyone in a private chat adds teammates (only ones on the site)');
select test.sign_in('ann');
insert into public.messages (user_id, author_name, body, thread_id, created_date)
  values (test.id('ann'), 'Ann', 'Welcome Eve', test.room_id('🚗 Ride Friday'), clock_timestamp());
select test.sign_in('eve');
select test.ok(exists (select 1 from public.messages where body = 'Leaving at 6, room for one'), 'someone added sees the earlier messages');
select test.ok((select unread from public.chat_overview() where thread_id = test.room_id('🚗 Ride Friday')) = 1,
  'but only what came after they were added counts as unread');

-- The app icon matches each player's Chat tab, private chats and the Lounge included.
reset role;
truncate test.chat_tab;
select test.sign_in('eve');
select test.note_chat_tab('eve');
select test.sign_in('cy');
select test.note_chat_tab('cy');
select test.sign_in('cap2');
select test.note_chat_tab('cap2');
reset role;
set role service_role;
select test.ok(
  (select count(*) = 3 and bool_and(i.n = t.n) from test.icon_numbers() i join test.chat_tab t using (name))
    and (select n from test.chat_tab where name = 'eve') = 1
    and (select n from test.chat_tab where name = 'cap2') >= 2,
  'the app icon counts private chats and the Lounge like the Chat tab does'
);
reset role;

-- Taking people out, and leaving.
select test.sign_in('cy');
select test.touches($$delete from public.chat_thread_members where user_id = test.id('eve')$$, 0, 'only the starter takes someone out');
select test.sign_in('ann');
select test.touches($$delete from public.chat_thread_members where user_id = test.id('eve')$$, 1, 'the starter takes someone out');
select test.sign_in('eve');
select test.ok(not exists (select 1 from public.messages where body = 'Welcome Eve'), 'and they can''t read it anymore');
select test.sign_in('cy');
select test.touches($$delete from public.chat_thread_members where user_id = auth.uid()$$, 1, 'anyone can leave a private chat');
select test.ok(not exists (select 1 from public.chat_threads where title = '🚗 Ride Friday'), 'and then it''s gone from their list');
reset role;
select test.ok(exists (select 1 from public.messages where body = 'Leaving at 6, room for one'), 'leaving keeps the messages for the others');

-- Closing.
select test.sign_in('ann');
select public.chat_add_members(test.room_id('🚗 Ride Friday'), array[test.id('cy')]);
select test.touches($$update public.chat_threads set archived = true where id = test.room_id('🚗 Ride Friday')$$, 1, 'the starter closes it');
select test.refused($$select public.chat_add_members(test.room_id('🚗 Ride Friday'), array[test.id('eve')])$$, 'nobody adds people to a closed chat');
select test.sign_in('cy');
select test.refused($$insert into public.messages (user_id, author_name, body, thread_id) values (test.id('cy'), 'Cy', 'Late', test.room_id('🚗 Ride Friday'))$$,
  'or posts in it');

-- A captain in a private chat is just one of its people.
select test.sign_in('cap');
select test.ok((select id from public.chat_start_private('Dues question', array[test.id('cy')])) is not null, 'captains start private chats too');
select test.sign_in('cy');
insert into public.messages (user_id, author_name, body, thread_id, created_date)
  values (test.id('cy'), 'Cy', 'Can I pay next week?', test.room_id('Dues question'), clock_timestamp());
select test.sign_in('cap');
insert into public.messages (user_id, author_name, body, thread_id, mentions_team, created_date)
  values (test.id('cap'), 'Cap', '@team sure', test.room_id('Dues question'), true, clock_timestamp());
select test.ok((select not mentions_team from public.messages where body = '@team sure'), 'their @team pings nobody there');
select test.touches($$delete from public.messages where body = 'Can I pay next week?'$$, 0, 'and they delete only their own messages there');
select test.touches($$delete from public.messages where body = '@team sure'$$, 1, 'like everyone else');
select test.touches($$delete from public.chat_thread_members where user_id = auth.uid() and thread_id = test.room_id('Dues question')$$, 1,
  'a starter can leave too');
select test.touches($$update public.chat_threads set title = 'Back' where id = test.room_id('Dues question')$$, 0,
  'and then has no say over it');

-- Deleting: the starter deletes it, with its messages and who was in it.
select test.sign_in('ann');
select test.touches($$delete from public.chat_threads where id = test.room_id('🚗 Ride Friday')$$, 1, 'the starter deletes a private chat');
reset role;
select test.ok(not exists (select 1 from public.messages where body = 'Leaving at 6, room for one'), 'its messages go with it');
select test.ok(not exists (select 1 from public.chat_thread_members m left join public.chat_threads t on t.id = m.thread_id where t.id is null),
  'and its member list');

-- A deleted account leaves its private chats; their messages stay.
delete from auth.users where id = test.id('cy');
select test.ok(not exists (select 1 from public.chat_thread_members where user_id = test.id('cy')), 'a deleted account leaves its private chats');
select test.ok(exists (select 1 from public.messages where body = 'Can I pay next week?' and user_id is null), 'their messages there stay');

reset role;
set role anon;
select test.refused($$select * from public.chat_thread_members$$, 'signed-out visitors can''t see who''s in private chats');
select test.refused($$select public.chat_start_private('x', array[gen_random_uuid()])$$, 'or start one');
reset role;

rollback;
