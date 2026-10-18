-- Undoing a wrong "Find your name" pick (unlink_team_guest()): the name goes
-- back to a grey card with exactly what came with it, and the account is left
-- as it was before. Run by scripts/test-db.sh after every migration is applied.
-- Everything happens in one transaction that's rolled back, so the other test
-- files never see it. The first failed check stops the run with
-- "FAILED: <what was expected>".

begin;

create schema unlink_test;
grant usage on schema unlink_test to authenticated, anon;

create table unlink_test.people (name text primary key, id uuid not null);
grant select on unlink_test.people to authenticated, anon;

create function unlink_test.id(who text) returns uuid language sql stable as $$
  select id from unlink_test.people where name = who;
$$;

create function unlink_test.today() returns date language sql stable as $$
  select (now() at time zone 'America/New_York')::date;
$$;

create function unlink_test.year() returns integer language sql stable as $$
  select extract(year from unlink_test.today())::integer;
$$;

create function unlink_test.ok(passed boolean, what text) returns void language plpgsql as $$
begin
  if passed is not true then
    raise exception 'FAILED: %', what;
  end if;
  raise notice 'ok - %', what;
end;
$$;

create function unlink_test.refused(statement text, what text) returns void language plpgsql as $$
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

create function unlink_test.touches(statement text, expected integer, what text) returns void language plpgsql as $$
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

grant execute on all functions in schema unlink_test to authenticated, anon;

create function unlink_test.sign_in(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', unlink_test.id(who)::text, false);
  perform set_config('role', 'authenticated', false);
end;
$$;

-- Everything a pick can touch. Session list entries leave out who answered and
-- when (an undo answers for the account again, with the status it had).
create function unlink_test.state() returns table (tbl text, id uuid, data jsonb) language sql stable as $$
  select 'dues_payments', x.id, to_jsonb(x) - 'updated_date' from public.dues_payments x
  union all select 'dues_history', x.id, to_jsonb(x) from public.dues_history x
  union all select 'session_roster', x.id, to_jsonb(x) - 'updated_date' - 'answered_at' - 'changed_by' from public.session_roster x
  union all select 'rsvps', x.id, to_jsonb(x) - 'updated_date' from public.rsvps x
  union all select 'game_stats', x.id, to_jsonb(x) - 'updated_date' from public.game_stats x
  union all select 'potm_votes', x.id, to_jsonb(x) - 'updated_date' from public.potm_votes x
  union all select 'player_profiles', x.id, to_jsonb(x) - 'updated_date' from public.player_profiles x
  union all select 'team_guests', x.id, to_jsonb(x) - 'updated_date' from public.team_guests x
$$;

create table unlink_test.snaps (name text, tbl text, id uuid, data jsonb);

create function unlink_test.snap(n text) returns void language sql as $$
  insert into unlink_test.snaps select n, s.tbl, s.id, s.data from unlink_test.state() s;
  insert into unlink_test.snaps select n, 'dues_changes', x.id, to_jsonb(x) from public.dues_changes x;
$$;

-- Every row is exactly as it was at the snapshot. The dues changes are a log,
-- so they only gain rows (the account's status going and coming back).
create function unlink_test.as_before(n text, what text) returns void language plpgsql as $$
declare
  diff text;
begin
  select string_agg(format('%s %s %s', side, tbl, data), E'\n') into diff from (
    (select 'was' as side, s.tbl, s.id, s.data from unlink_test.snaps s where s.name = n and s.tbl <> 'dues_changes'
     except select 'was', t.tbl, t.id, t.data from unlink_test.state() t)
    union all
    (select 'now', t.tbl, t.id, t.data from unlink_test.state() t
     except select 'now', s.tbl, s.id, s.data from unlink_test.snaps s where s.name = n and s.tbl <> 'dues_changes')
    union all
    (select 'was', s.tbl, s.id, s.data from unlink_test.snaps s where s.name = n and s.tbl = 'dues_changes'
     except select 'was', 'dues_changes', x.id, to_jsonb(x) from public.dues_changes x)
  ) d;
  perform unlink_test.ok(diff is null, what || coalesce(E'\n' || diff, ''));
end;
$$;

-- ---------------------------------------------------------------------------
-- Kim is a captain; Pat and Lee play. Session 1's game was three weeks ago and
-- session 2's is in three days, so session 2 is the current one.
-- ---------------------------------------------------------------------------

insert into unlink_test.people values
  ('kim', '00000000-0000-4000-8000-0000000000a1'),
  ('pat', '00000000-0000-4000-8000-0000000000a2'),
  ('lee', '00000000-0000-4000-8000-0000000000a3'),
  ('ori', '00000000-0000-4000-8000-0000000000a4'),
  ('cy1', '00000000-0000-4000-8000-0000000000a5'),
  ('cy2', '00000000-0000-4000-8000-0000000000a6'),
  ('olda', '00000000-0000-4000-8000-0000000000a7'),
  ('vet', '00000000-0000-4000-8000-0000000000a8'),
  ('samo', '00000000-0000-4000-8000-0000000000b1'),
  ('sue', '00000000-0000-4000-8000-0000000000b2'),
  ('patp', '00000000-0000-4000-8000-0000000000b3'),
  ('gil', '00000000-0000-4000-8000-0000000000b4'),
  ('cory', '00000000-0000-4000-8000-0000000000b5'),
  ('oldg', '00000000-0000-4000-8000-0000000000b6'),
  ('vetg', '00000000-0000-4000-8000-0000000000b7'),
  ('g1', '00000000-0000-4000-8000-0000000000c1'),
  ('g2', '00000000-0000-4000-8000-0000000000c2');

insert into auth.users (id, email)
  select id, name || '@unlink.test' from unlink_test.people where name in ('kim', 'pat', 'lee', 'ori', 'cy1', 'cy2', 'olda', 'vet');
update public.users set role = case when id = unlink_test.id('kim') then 'admin' else 'user' end, joined_team_at = now()
  where id in (select id from unlink_test.people);

insert into public.games (id, season_year, session, date, opponent) values
  (unlink_test.id('g1'), unlink_test.year(), 1, unlink_test.today() - 20, 'Net Ninjas'),
  (unlink_test.id('g2'), unlink_test.year(), 2, unlink_test.today() + 3, 'Goal Diggers');

insert into public.player_profiles (user_id, display_name, gender, status) values
  (unlink_test.id('kim'), 'Kim Captain', 'F', 'active'),
  (unlink_test.id('pat'), 'Pat Player', 'M', 'active'),
  (unlink_test.id('lee'), 'Lee Lane', 'F', 'active');

-- ---------------------------------------------------------------------------
-- Sam Ortiz joins and picks "Sam O" by mistake. Sam O is on break, plays
-- defense and pays with Sue O. He paid session 1 and has a custom amount for
-- session 2, was on session 1's list, is IN for the next game, set up a goal in
-- session 1's, and Pat voted him Man of the Match.
-- ---------------------------------------------------------------------------

insert into public.team_guests (id, display_name, gender, position, status) values
  (unlink_test.id('samo'), 'Sam O', 'M', 'Defense', 'on_break'),
  (unlink_test.id('sue'), 'Sue O', 'F', null, 'active');
update public.team_guests set pays_with_guest = unlink_test.id('sue') where id = unlink_test.id('samo');
update public.team_guests set pays_with_guest = unlink_test.id('samo') where id = unlink_test.id('sue');
insert into public.dues_payments (season_year, session, guest_id, paid, paid_date, paid_by, paid_amount, override_amount) values
  (unlink_test.year(), 1, unlink_test.id('samo'), true, unlink_test.today() - 30, unlink_test.id('pat'), 61, null),
  (unlink_test.year(), 2, unlink_test.id('samo'), false, null, null, null, 40);
insert into public.dues_history (season_year, session, guest_id, paid, paid_date, changed_by) values
  (unlink_test.year(), 1, unlink_test.id('samo'), true, unlink_test.today() - 30, unlink_test.id('pat'));
insert into public.session_roster (season_year, session, guest_id, status, answered_at) values
  (unlink_test.year(), 1, unlink_test.id('samo'), 'on_break', now());
insert into public.rsvps (game_id, guest_id, status, playing_gk) values (unlink_test.id('g2'), unlink_test.id('samo'), 'in', false);
insert into public.game_stats (game_id, guest_id, played, goals, assists) values (unlink_test.id('g1'), unlink_test.id('samo'), true, 0, 1);
insert into public.potm_votes (game_id, voter_id, voted_for_guest_id, award) values
  (unlink_test.id('g1'), unlink_test.id('pat'), unlink_test.id('samo'), 'man');

select unlink_test.sign_in('ori');
insert into public.player_profiles (user_id, display_name, gender, status) values (auth.uid(), 'Sam Ortiz', 'M', 'active');
reset role;
select unlink_test.snap('before Sam Ortiz picks');

select unlink_test.sign_in('ori');
select public.claim_team_guest(unlink_test.id('samo'));
reset role;
select unlink_test.ok(
  (select count(*) = 2 from public.dues_payments where user_id = unlink_test.id('ori'))
    and (select status = 'on_break' and position = 'Defense' and pays_with_guest = unlink_test.id('sue')
         from public.player_profiles where user_id = unlink_test.id('ori'))
    and exists (select 1 from public.potm_votes where voted_for_id = unlink_test.id('ori')),
  'picking Sam O brings his dues, status, position, partner and votes to Sam Ortiz');
select unlink_test.ok(
  (select status_before = 'active' and status_after = 'on_break' and cardinality(moved_payments) = 2
     and cardinality(moved_history) = 1 and cardinality(moved_roster) = 1 and cardinality(moved_rsvps) = 1
     and cardinality(moved_stats) = 1 and cardinality(moved_votes) = 1 and cardinality(moved_changes) = 1
     and filled = '{"position": "Defense"}' and guest_partner = unlink_test.id('sue') and not rebuilt
     and linked_by = unlink_test.id('ori') and unlinked_at is null
   from public.team_guest_links where guest_id = unlink_test.id('samo')),
  'and the pick keeps a record of everything it moved and changed');

select unlink_test.sign_in('pat');
select unlink_test.ok((select count(*) = 1 from public.team_guest_links), 'teammates can read the records');
select unlink_test.refused($$select public.unlink_team_guest(unlink_test.id('samo'))$$, 'only captains can undo a pick');
select unlink_test.touches($$update public.team_guest_links set unlinked_at = now()$$, 0, 'nobody changes a record by hand');
select unlink_test.refused(
  $$insert into public.team_guest_links (guest_id, user_id) values (unlink_test.id('sue'), unlink_test.id('pat'))$$,
  'or adds one');
reset role;

select unlink_test.sign_in('kim');
select public.unlink_team_guest(unlink_test.id('samo'));
reset role;
select unlink_test.as_before('before Sam Ortiz picks',
  'undoing it leaves Sam O and Sam Ortiz exactly as before: payments, history, sessions, sign-ups, stats, votes, status, position and partner');
select unlink_test.ok(
  (select unlinked_by = unlink_test.id('kim') and unlinked_at is not null
   from public.team_guest_links where guest_id = unlink_test.id('samo')),
  'the record says who undid it');
select unlink_test.sign_in('kim');
select unlink_test.refused($$select public.unlink_team_guest(unlink_test.id('samo'))$$, 'a name nobody has picked cannot be undone');
reset role;

-- ---------------------------------------------------------------------------
-- A captain links Pat P to Pat Player, who has his own session 1 payment (not
-- paid yet) and session 2 payment (paid), and pays with Lee. Pat P paid
-- session 1, has a custom amount for session 2, and pays with Gil.
-- ---------------------------------------------------------------------------

insert into public.team_guests (id, display_name, gender, status) values
  (unlink_test.id('patp'), 'Pat P', 'M', 'active'),
  (unlink_test.id('gil'), 'Gil Guest', 'M', 'active');
update public.team_guests set pays_with_user = null, pays_with_guest = unlink_test.id('gil') where id = unlink_test.id('patp');
update public.team_guests set pays_with_guest = unlink_test.id('patp') where id = unlink_test.id('gil');
update public.player_profiles set pays_with = unlink_test.id('lee') where user_id = unlink_test.id('pat');
update public.player_profiles set pays_with = unlink_test.id('pat') where user_id = unlink_test.id('lee');
insert into public.dues_payments (season_year, session, user_id, guest_id, paid, paid_date, paid_by, paid_amount, override_amount) values
  (unlink_test.year(), 1, unlink_test.id('pat'), null, false, null, null, null, null),
  (unlink_test.year(), 2, unlink_test.id('pat'), null, true, unlink_test.today() - 2, unlink_test.id('pat'), 55, null),
  (unlink_test.year(), 1, null, unlink_test.id('patp'), true, unlink_test.today() - 25, unlink_test.id('kim'), 61, null),
  (unlink_test.year(), 2, null, unlink_test.id('patp'), false, null, null, null, 50);
insert into public.rsvps (game_id, user_id, guest_id, status, playing_gk) values
  (unlink_test.id('g2'), unlink_test.id('pat'), null, 'in', false),
  (unlink_test.id('g2'), null, unlink_test.id('patp'), 'out', false);

select unlink_test.snap('before the link');
select unlink_test.sign_in('kim');
select public.link_team_guest(unlink_test.id('patp'), unlink_test.id('pat'));
reset role;
select unlink_test.ok(
  (select paid and paid_amount = 61 from public.dues_payments where user_id = unlink_test.id('pat') and session = 1)
    and (select paid and paid_amount = 55 and override_amount = 50 from public.dues_payments where user_id = unlink_test.id('pat') and session = 2)
    and (select pays_with_guest = unlink_test.id('gil') and pays_with is null from public.player_profiles where user_id = unlink_test.id('pat'))
    and (select pays_with is null from public.player_profiles where user_id = unlink_test.id('lee'))
    and (select status = 'out' from public.rsvps where guest_id = unlink_test.id('patp')),
  'a link merges Pat P''s payments into Pat''s and gives him Gil as a partner; Pat''s own sign-up counts');
select unlink_test.ok(
  (select jsonb_array_length(merged_payments) = 2 and user_partner = unlink_test.id('lee') and status_after is null
   from public.team_guest_links where guest_id = unlink_test.id('patp')),
  'the record keeps Pat''s payments as they were, and his partner');

select unlink_test.sign_in('kim');
select public.unlink_team_guest(unlink_test.id('patp'));
reset role;
select unlink_test.as_before('before the link',
  'undoing a link puts Pat''s merged payments back, Pat P''s payments back on Pat P, and both couples back together');

-- ---------------------------------------------------------------------------
-- Cory made two accounts. He picked "Cory Kay" with the first, then signed up
-- again; the second can't pick it. While the name sat on the first account a
-- new session started (session 3, whose game is tomorrow).
-- ---------------------------------------------------------------------------

insert into public.team_guests (id, display_name, gender, status) values (unlink_test.id('cory'), 'Cory Kay', 'M', 'active');
insert into public.dues_payments (season_year, session, guest_id, paid, paid_date, paid_by, paid_amount) values
  (unlink_test.year(), 1, unlink_test.id('cory'), true, unlink_test.today() - 28, unlink_test.id('kim'), 61);

select unlink_test.sign_in('cy1');
insert into public.player_profiles (user_id, display_name, gender, status) values (auth.uid(), 'Cory Kay', 'M', 'active');
select public.claim_team_guest(unlink_test.id('cory'));
reset role;
select unlink_test.sign_in('cy2');
insert into public.player_profiles (user_id, display_name, gender, status) values (auth.uid(), 'Cory K', 'M', 'active');
select unlink_test.refused($$select public.claim_team_guest(unlink_test.id('cory'))$$, 'his second account cannot pick the same name');
reset role;

insert into public.games (season_year, session, date, opponent) values (unlink_test.year(), 3, unlink_test.today() + 1, 'Ball Busters');
select unlink_test.sign_in('cy2');
select public.roster_start_current();
reset role;
select unlink_test.ok(
  not exists (select 1 from public.session_roster where session = 3 and guest_id = unlink_test.id('cory')),
  'a session that starts while the name is picked leaves it out');

select unlink_test.sign_in('kim');
select public.unlink_team_guest(unlink_test.id('cory'));
reset role;
select unlink_test.ok(
  (select guest_id = unlink_test.id('cory') and user_id is null from public.dues_payments
   where season_year = unlink_test.year() and session = 1 and paid_by = unlink_test.id('kim') and paid_date = unlink_test.today() - 28),
  'unlinking the first account puts the payment back on the grey card');
select unlink_test.ok(
  (select status = 'active' from public.session_roster where session = 3 and guest_id = unlink_test.id('cory')),
  'and the grey card is back on the current session''s list');
select unlink_test.ok(
  exists (select 1 from public.dues_changes where session = 3 and kind = 'roster' and guest_id = unlink_test.id('cory')),
  'which shows in the dues changes, as the split changes');

select unlink_test.sign_in('kim');
select public.link_team_guest(unlink_test.id('cory'), unlink_test.id('cy2'));
reset role;
select unlink_test.ok(
  (select count(*) = 1 from public.dues_payments where user_id = unlink_test.id('cy2'))
    and not exists (select 1 from public.dues_payments where user_id = unlink_test.id('cy1'))
    and (select linked_user_id = unlink_test.id('cy2') from public.team_guests where id = unlink_test.id('cory')),
  'then a captain links it to the account he uses');
select unlink_test.ok(
  (select count(*) = 2 and count(*) filter (where unlinked_at is null and user_id = unlink_test.id('cy2')) = 1
   from public.team_guest_links where guest_id = unlink_test.id('cory')),
  'both picks are on record, and only the second still counts');

-- Changes made since stay: a captain marks the payment not paid on Cory K's
-- card, then unlinks again; the payment goes back as it is now.
select unlink_test.sign_in('kim');
select public.mark_dues_paid(unlink_test.year(), 1, array[unlink_test.id('cy2')], false, null);
select public.unlink_team_guest(unlink_test.id('cory'));
reset role;
select unlink_test.ok(
  (select not paid from public.dues_payments where season_year = unlink_test.year() and session = 1 and guest_id = unlink_test.id('cory')),
  'a payment changed on the account''s card goes back to the name as it is now');
select unlink_test.sign_in('kim');
select public.link_team_guest(unlink_test.id('cory'), unlink_test.id('cy2'));
reset role;

-- ---------------------------------------------------------------------------
-- Names picked before picks were recorded. Olive picked "Olive Old" when she
-- made her profile; Vic had been on the site for a month when a captain linked
-- "Vic Vet" to him. Both happened the old way (no record).
-- ---------------------------------------------------------------------------

insert into public.team_guests (id, display_name, gender, position, status) values
  (unlink_test.id('oldg'), 'Olive Old', 'F', 'Forward', 'active'),
  (unlink_test.id('vetg'), 'Vic Vet', 'M', null, 'active');
insert into public.dues_payments (season_year, session, guest_id, paid, paid_date, created_date) values
  (unlink_test.year(), 1, unlink_test.id('oldg'), true, unlink_test.today() - 5, now() - interval '5 days'),
  (unlink_test.year(), 1, unlink_test.id('vetg'), true, unlink_test.today() - 5, now() - interval '5 days');
insert into public.dues_history (season_year, session, guest_id, paid, paid_date, created_date) values
  (unlink_test.year(), 1, unlink_test.id('oldg'), true, unlink_test.today() - 5, now() - interval '5 days');
insert into public.session_roster (season_year, session, guest_id, status, created_date) values
  (unlink_test.year(), 1, unlink_test.id('oldg'), 'active', now() - interval '20 days');
insert into public.player_profiles (user_id, display_name, gender, position, status, created_date) values
  (unlink_test.id('olda'), 'Olive Oyl', 'F', 'Forward', 'active', now()),
  (unlink_test.id('vet'), 'Vic Veteran', 'M', null, 'active', now() - interval '30 days');
update public.dues_payments set user_id = unlink_test.id('olda'), guest_id = null where guest_id = unlink_test.id('oldg');
update public.dues_history set user_id = unlink_test.id('olda'), guest_id = null where guest_id = unlink_test.id('oldg');
update public.session_roster set user_id = unlink_test.id('olda'), guest_id = null where guest_id = unlink_test.id('oldg') and session = 1;
update public.team_guests set linked_user_id = unlink_test.id('olda') where id = unlink_test.id('oldg');
update public.dues_payments set user_id = unlink_test.id('vet'), guest_id = null where guest_id = unlink_test.id('vetg');
update public.team_guests set linked_user_id = unlink_test.id('vet') where id = unlink_test.id('vetg');

select unlink_test.ok(public.team_guest_links_rebuild() = 1, 'a record is worked out for the name picked with a new profile');
select unlink_test.ok(
  (select rebuilt and cardinality(moved_payments) = 1 and cardinality(moved_history) = 1 and cardinality(moved_roster) = 1
     and filled = '{"position": "Forward"}' and status_before = 'active'
   from public.team_guest_links where guest_id = unlink_test.id('oldg')),
  'from what was on her account before she made her profile');
select unlink_test.ok(public.team_guest_links_rebuild() = 0, 'once');

select unlink_test.sign_in('kim');
select public.unlink_team_guest(unlink_test.id('oldg'));
select unlink_test.refused($$select public.unlink_team_guest(unlink_test.id('vetg'))$$,
  'a name linked to someone who had been playing a while cannot be undone here');
reset role;
select unlink_test.ok(
  (select count(*) = 1 from public.dues_payments where guest_id = unlink_test.id('oldg'))
    and (select count(*) = 1 from public.dues_history where guest_id = unlink_test.id('oldg'))
    and exists (select 1 from public.session_roster where session = 1 and guest_id = unlink_test.id('oldg'))
    and (select position is null from public.player_profiles where user_id = unlink_test.id('olda'))
    and (select linked_user_id is null from public.team_guests where id = unlink_test.id('oldg')),
  'undoing it puts Olive Old''s payment, history and session back on the grey card');
select unlink_test.ok(
  (select linked_user_id = unlink_test.id('vet') from public.team_guests where id = unlink_test.id('vetg'))
    and (select count(*) = 1 from public.dues_payments where user_id = unlink_test.id('vet')),
  'and Vic Vet stays with Vic');

set role anon;
select unlink_test.refused($$select public.unlink_team_guest(unlink_test.id('cory'))$$, 'signed-out visitors cannot undo a pick');
select unlink_test.refused($$select count(*) from public.team_guest_links$$, 'or read the records');
reset role;

rollback;
