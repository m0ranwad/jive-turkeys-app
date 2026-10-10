-- Sample team data for scripts/db-rehearsal.sh: a copy of "the live database"
-- before new migrations run. It fills every table that exists at that point,
-- so it works against older versions of the schema too (parts that need newer
-- tables or columns check for them first).

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'captain@seed.test', '{"full_name": "Casey Captain"}'),
  ('22222222-2222-4222-8222-222222222222', 'jordan@seed.test', '{"full_name": "Jordan Rivera"}'),
  ('33333333-3333-4333-8333-333333333333', 'sam@seed.test', '{"full_name": "Sam Okafor"}');

insert into public.player_profiles (id, user_id, email, display_name, gender, phone, position, year_joined, status) values
  ('a1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'captain@seed.test', 'Casey Captain', 'M', '555-0101', 'Mid-Field', 2015, 'active'),
  ('a2222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'jordan@seed.test', 'Jordan Rivera', 'F', null, 'Forward', 2016, 'active'),
  ('a3333333-3333-4333-8333-333333333333', '33333333-3333-4333-8333-333333333333', 'sam@seed.test', 'Sam Okafor', 'M', null, null, 2018, 'sub_pool');

insert into public.games (id, season_year, session, date, time, field_number, opponent, location, jersey, notes, has_result, score_us, score_them) values
  ('b1111111-1111-4111-8111-111111111111', 2026, 1, '2026-09-10', '19:00', '2', 'Net Ninjas', 'North Coast', 'primary', '', true, 3, 2),
  ('b2222222-2222-4222-8222-222222222222', 2026, 2, '2026-10-15', '20:10', '1', 'Goal Diggers', 'North Coast', 'backup', 'Bring both jerseys', false, null, null);

insert into public.rsvps (game_id, user_id, status, playing_gk) values
  ('b2222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'in', false),
  ('b2222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', 'maybe', true);

insert into public.game_stats (game_id, user_id, played, goals, assists, blue_cards, red_cards) values
  ('b1111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', true, 2, 0, 0, 0),
  ('b1111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', true, 1, 1, 1, 0);

insert into public.potm_votes (game_id, voter_id, voted_for_id, award) values
  ('b1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'woman');

insert into public.session_dues (season_year, session, total_fee) values (2026, 2, 1200.00);
insert into public.dues_payments (season_year, session, user_id, override_amount, paid, paid_date) values
  (2026, 2, '22222222-2222-4222-8222-222222222222', null, true, '2026-10-01'),
  (2026, 2, '33333333-3333-4333-8333-333333333333', 50.00, false, null);

insert into public.announcements (title, body, author_name) values ('Welcome', 'Season 12 starts soon.', 'Casey Captain');

-- Team Chat history.
insert into public.messages (id, user_id, author_name, body, created_date) values
  ('c1111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'Jordan Rivera', 'Who is bringing the pinnies?', '2026-10-01 18:00+00'),
  ('c2222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', 'Sam Okafor', 'I got them 👍', '2026-10-01 18:05+00'),
  ('c3333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'Casey Captain', 'Dues are due Friday', '2026-10-02 12:00+00');

-- Threads, replies, reactions and read markers (once those exist).
do $$
begin
  if to_regclass('public.chat_threads') is not null then
    execute $sql$
      insert into public.chat_threads (id, title, created_by, author_name, archived) values
        ('d1111111-1111-4111-8111-111111111111', '⚽ Sunday pickup', '33333333-3333-4333-8333-333333333333', 'Sam Okafor', false),
        ('d2222222-2222-4222-8222-222222222222', '🎽 Jersey order', '11111111-1111-4111-8111-111111111111', 'Casey Captain', true);
      insert into public.messages (id, user_id, author_name, body, thread_id, created_date) values
        ('c4444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', 'Sam Okafor', 'Field 3 at 10?', 'd1111111-1111-4111-8111-111111111111', '2026-10-03 09:00+00'),
        ('c6666666-6666-4666-8666-666666666666', '11111111-1111-4111-8111-111111111111', 'Casey Captain', 'Order placed', 'd2222222-2222-4222-8222-222222222222', '2026-10-03 11:00+00');
      insert into public.messages (id, user_id, author_name, body, thread_id, reply_to_id, created_date) values
        ('c5555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222', 'Jordan Rivera', 'In', 'd1111111-1111-4111-8111-111111111111', 'c4444444-4444-4444-8444-444444444444', '2026-10-03 09:30+00');
      update public.messages set reply_to_id = 'c1111111-1111-4111-8111-111111111111' where id = 'c2222222-2222-4222-8222-222222222222';
      insert into public.message_reactions (message_id, user_id, emoji) values
        ('c2222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', '🙏'),
        ('c3333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', '👍'),
        ('c3333333-3333-4333-8333-333333333333', '33333333-3333-4333-8333-333333333333', '👍');
      insert into public.chat_reads (user_id, thread_id, last_read_at) values
        ('22222222-2222-4222-8222-222222222222', null, '2026-10-02 12:00+00'),
        ('22222222-2222-4222-8222-222222222222', 'd1111111-1111-4111-8111-111111111111', '2026-10-03 09:30+00');
    $sql$;
  end if;
end;
$$;

-- Devices signed up for notifications (once that exists).
do $$
begin
  if to_regclass('public.push_subscriptions') is not null then
    execute $sql$
      insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent) values
        ('e1111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'https://web.push.apple.com/seed-jordan', 'seed-p256dh', 'seed-auth', 'iPhone'),
        ('e2222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', 'https://fcm.googleapis.com/fcm/send/seed-sam', 'seed-p256dh', 'seed-auth', 'Android');
    $sql$;
  end if;
end;
$$;

-- Dues history (once that exists).
do $$
begin
  if to_regclass('public.dues_history') is not null then
    execute $sql$
      insert into public.dues_history (season_year, session, user_id, paid, paid_date, changed_by, created_date) values
        (2026, 2, '33333333-3333-4333-8333-333333333333', true, '2026-10-02', '22222222-2222-4222-8222-222222222222', '2026-10-02 18:00+00'),
        (2026, 2, '33333333-3333-4333-8333-333333333333', false, null, '33333333-3333-4333-8333-333333333333', '2026-10-03 18:00+00');
    $sql$;
  end if;
end;
$$;
