-- Captains can undo a wrong "Find your name" pick (two Sams, or one person who
-- signed up twice and picked their name with the account they don't use), or
-- a wrong link. Picking a name moves its dues payments and history, session
-- lists, game sign-ups, stat lines, votes and dues changes to the account, and
-- merges payments in place where both had one for a session, so it couldn't be
-- undone from the data alone. Now each pick keeps a record of exactly what it
-- moved and what it overwrote (team_guest_links), and unlink_team_guest() puts
-- it back: the name is a grey card again with its spot and dues, and the
-- account keeps everything that was its own. Records stay after an undo, so a
-- name can be picked, undone and picked again (by the right account).
--
-- Also: two sign-ups picking the same name at the same moment could both get
-- it, the dues going to one and the name to the other. A name is now locked
-- while it moves.

create table public.team_guest_links (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.team_guests (id),
  user_id uuid not null references public.users (id) on delete cascade,
  -- Rows that moved from the name to the account.
  moved_payments uuid[] not null default '{}',
  moved_history uuid[] not null default '{}',
  moved_roster uuid[] not null default '{}',
  moved_rsvps uuid[] not null default '{}',
  moved_stats uuid[] not null default '{}',
  moved_votes uuid[] not null default '{}',
  moved_changes uuid[] not null default '{}',
  -- The account's own payments that the name's payment was merged into, before
  -- and after: [{ id, before: { paid, paid_date, ... }, after: { ... } }].
  merged_payments jsonb not null default '[]',
  -- Profile details the roster filled in ({ gender, position }), and the status
  -- picking the name replaced (status_after is null after a captain's link,
  -- which keeps the player's own).
  filled jsonb not null default '{}',
  status_before text,
  status_after text,
  -- Who paid with whom: the name's partner, who moved to the account, and the
  -- account's partner before, whom that replaced.
  guest_partner uuid,
  user_partner uuid,
  -- Worked out from the data, for a name picked before these records were kept.
  rebuilt boolean not null default false,
  linked_by uuid references public.users (id) on delete set null,
  created_date timestamptz not null default now(),
  unlinked_by uuid references public.users (id) on delete set null,
  unlinked_at timestamptz
);

create index team_guest_links_guest on public.team_guest_links (guest_id, created_date);

-- The team reads them (captains see which name each player joined as). Only
-- the functions below write them.
alter table public.team_guest_links enable row level security;
create policy team_guest_links_select on public.team_guest_links for select to authenticated
  using ((select public.is_team_member()));
grant select, insert, update, delete on public.team_guest_links to authenticated, service_role;

-- Whoever someone pays with (an app player or a name on the roster), or null.
create or replace function public.dues_partner_of(p_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select coalesce(pays_with, pays_with_guest) from public.player_profiles where user_id = p_id),
    (select coalesce(pays_with_user, pays_with_guest) from public.team_guests where id = p_id)
  );
$$;

revoke execute on function public.dues_partner_of(uuid) from public, anon, authenticated;
grant execute on function public.dues_partner_of(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Same as before (20261016110000_dues_paid_amount.sql), plus: the name and the
-- account are locked while it moves, and what moved is recorded.
-- ---------------------------------------------------------------------------

create or replace function public.move_team_guest(p_guest_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.team_guests;
  p public.player_profiles;
  partner uuid;
  rec public.team_guest_links;
begin
  -- One pick at a time for a name (two sign-ups at once could otherwise both
  -- get it) and for an account (which can only have one name).
  select * into g from public.team_guests where id = p_guest_id for update;
  if g.id is null or g.linked_user_id is not null then
    raise exception 'That name has already been picked';
  end if;
  perform 1 from public.users where id = p_user_id for update;
  if not found then
    raise exception 'No such player on the app';
  end if;
  if exists (select 1 from public.team_guests where linked_user_id = p_user_id) then
    raise exception 'That player already has a name on the roster';
  end if;
  select * into p from public.player_profiles where user_id = p_user_id;

  -- Sessions the app player has nothing for yet move over as they are.
  with moved as (
    update public.dues_payments d set user_id = p_user_id, guest_id = null
    where d.guest_id = p_guest_id
      and not exists (
        select 1 from public.dues_payments u
        where u.user_id = p_user_id and u.season_year = d.season_year and u.session = d.session
      )
    returning d.id
  )
  select coalesce(array_agg(id), '{}') into rec.moved_payments from moved;
  -- Where both have one, a payment the guest made counts (with what they
  -- paid), and so does a custom amount the app player doesn't have. The app
  -- player's payment as it was is kept ("was" is the same row before this).
  with merged as (
    update public.dues_payments u set
        paid = u.paid or d.paid,
        paid_date = case when u.paid then u.paid_date else d.paid_date end,
        paid_by = case when u.paid then u.paid_by else d.paid_by end,
        paid_amount = case when u.paid then u.paid_amount else d.paid_amount end,
        override_amount = coalesce(u.override_amount, d.override_amount)
      from public.dues_payments d, public.dues_payments was
      where d.guest_id = p_guest_id and u.user_id = p_user_id
        and u.season_year = d.season_year and u.session = d.session and was.id = u.id
        and ((d.paid and not u.paid) or (u.override_amount is null and d.override_amount is not null))
      returning u.id,
        jsonb_build_object('paid', was.paid, 'paid_date', was.paid_date, 'paid_by', was.paid_by,
          'paid_amount', was.paid_amount, 'override_amount', was.override_amount) as before,
        jsonb_build_object('paid', u.paid, 'paid_date', u.paid_date, 'paid_by', u.paid_by,
          'paid_amount', u.paid_amount, 'override_amount', u.override_amount) as after
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'before', before, 'after', after)), '[]')
    into rec.merged_payments from merged;
  with moved as (
    update public.dues_history set user_id = p_user_id, guest_id = null where guest_id = p_guest_id returning id
  )
  select coalesce(array_agg(id), '{}') into rec.moved_history from moved;
  -- What moved the split for the name (team_guests_dues_changes would move
  -- these too, as the name is linked below).
  with moved as (
    update public.dues_changes set user_id = p_user_id, guest_id = null where guest_id = p_guest_id returning id
  )
  select coalesce(array_agg(id), '{}') into rec.moved_changes from moved;

  -- Sessions the roster name was on and the app player wasn't. Where both
  -- were, the app player's own entry counts (the roster name's is kept).
  with moved as (
    update public.session_roster r set user_id = p_user_id, guest_id = null
    where r.guest_id = p_guest_id
      and not exists (
        select 1 from public.session_roster u
        where u.user_id = p_user_id and u.season_year = r.season_year and u.session = r.session
      )
    returning r.id
  )
  select coalesce(array_agg(id), '{}') into rec.moved_roster from moved;

  -- Game sign-ups and stat lines. Where both have one for a game, the app
  -- player's own counts (the roster name's is kept).
  with moved as (
    update public.rsvps r set user_id = p_user_id, guest_id = null
    where r.guest_id = p_guest_id
      and not exists (select 1 from public.rsvps u where u.user_id = p_user_id and u.game_id = r.game_id)
    returning r.id
  )
  select coalesce(array_agg(id), '{}') into rec.moved_rsvps from moved;
  with moved as (
    update public.game_stats s set user_id = p_user_id, guest_id = null
    where s.guest_id = p_guest_id
      and not exists (select 1 from public.game_stats u where u.user_id = p_user_id and u.game_id = s.game_id)
    returning s.id
  )
  select coalesce(array_agg(id), '{}') into rec.moved_stats from moved;
  -- Player of the Match votes for the roster name (except any the player cast
  -- for that name themselves, which would be a vote for themselves).
  with moved as (
    update public.potm_votes v set voted_for_id = p_user_id, voted_for_guest_id = null
    where v.voted_for_guest_id = p_guest_id and v.voter_id <> p_user_id
    returning v.id
  )
  select coalesce(array_agg(id), '{}') into rec.moved_votes from moved;

  -- Details the player hasn't filled in come from the roster.
  rec.filled := case when p.id is null then '{}' else jsonb_strip_nulls(jsonb_build_object(
    'gender', case when p.gender is null then g.gender end,
    'position', case when p.position is null then g.position end
  )) end;
  update public.player_profiles
    set gender = coalesce(gender, g.gender), position = coalesce(position, g.position)
    where user_id = p_user_id;

  partner := coalesce(g.pays_with_user, g.pays_with_guest);
  rec.guest_partner := partner;
  if partner is not null then
    rec.user_partner := coalesce(p.pays_with, p.pays_with_guest);
  end if;
  update public.team_guests
    set linked_user_id = p_user_id, pays_with_user = null, pays_with_guest = null
    where id = p_guest_id;
  if partner is not null then
    perform public.set_dues_partner(p_user_id, partner);
  end if;

  rec.id := gen_random_uuid();
  rec.guest_id := p_guest_id;
  rec.user_id := p_user_id;
  rec.status_before := p.status;
  rec.rebuilt := false;
  rec.linked_by := (select auth.uid());
  rec.created_date := now();
  insert into public.team_guest_links select rec.*;
end;
$$;

revoke execute on function public.move_team_guest(uuid, uuid) from public, anon, authenticated;
grant execute on function public.move_team_guest(uuid, uuid) to service_role;

-- Same as before (20261014000809_team_join_code.sql), plus: the status it
-- gives the player is recorded, so an undo can put theirs back.
create or replace function public.claim_team_guest(p_guest_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  roster_status text;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_team_member() then
    raise exception 'Join the team first';
  end if;
  select status into roster_status from public.team_guests where id = p_guest_id and not removed;
  if roster_status is null then
    raise exception 'That name is no longer on the roster';
  end if;
  perform public.move_team_guest(p_guest_id, me);
  update public.player_profiles set status = roster_status where user_id = me;
  update public.team_guest_links set status_after = roster_status
    where guest_id = p_guest_id and user_id = me and unlinked_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Captains: undo a pick. Everything that came with the name goes back to it as
-- it is now (a payment marked on the account's card since then included), and
-- what the pick overwrote on the account is put back unless it's been changed
-- since. Anything recorded for the account since is the account's and stays.
-- ---------------------------------------------------------------------------

create or replace function public.unlink_team_guest(p_guest_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  g public.team_guests;
  l public.team_guest_links;
  u uuid;
  cur record;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_captain() then
    raise exception 'Only captains can unlink a player';
  end if;
  select * into g from public.team_guests where id = p_guest_id for update;
  if g.linked_user_id is null then
    raise exception 'That name isn''t linked to anyone';
  end if;
  u := g.linked_user_id;
  select * into l from public.team_guest_links
    where guest_id = p_guest_id and user_id = u and unlinked_at is null
    order by created_date desc limit 1
    for update;
  if l.id is null then
    raise exception 'That name was picked before undo was added, so it can''t be undone here';
  end if;

  -- Dues: the name's payments, and the account's own payments it was merged into.
  update public.dues_payments d set user_id = null, guest_id = p_guest_id
  where d.id = any (l.moved_payments) and d.user_id = u
    and not exists (
      select 1 from public.dues_payments x
      where x.guest_id = p_guest_id and x.season_year = d.season_year and x.session = d.session
    );
  update public.dues_payments d set
      paid = (was.before ->> 'paid')::boolean,
      paid_date = (was.before ->> 'paid_date')::date,
      paid_by = (was.before ->> 'paid_by')::uuid,
      paid_amount = (was.before ->> 'paid_amount')::numeric,
      override_amount = (was.before ->> 'override_amount')::numeric
    from jsonb_to_recordset(l.merged_payments) as was (id uuid, before jsonb, after jsonb)
    where d.id = was.id and d.user_id = u
      and jsonb_build_object('paid', d.paid, 'paid_date', d.paid_date, 'paid_by', d.paid_by,
        'paid_amount', d.paid_amount, 'override_amount', d.override_amount) = was.after;
  update public.dues_history set user_id = null, guest_id = p_guest_id
    where id = any (l.moved_history) and user_id = u;
  update public.dues_changes set user_id = null, guest_id = p_guest_id
    where id = any (l.moved_changes) and user_id = u;

  -- Session lists, sign-ups, stat lines and votes.
  update public.session_roster r set user_id = null, guest_id = p_guest_id
  where r.id = any (l.moved_roster) and r.user_id = u
    and not exists (
      select 1 from public.session_roster x
      where x.guest_id = p_guest_id and x.season_year = r.season_year and x.session = r.session
    );
  update public.rsvps r set user_id = null, guest_id = p_guest_id
  where r.id = any (l.moved_rsvps) and r.user_id = u
    and not exists (select 1 from public.rsvps x where x.guest_id = p_guest_id and x.game_id = r.game_id);
  update public.game_stats s set user_id = null, guest_id = p_guest_id
  where s.id = any (l.moved_stats) and s.user_id = u
    and not exists (select 1 from public.game_stats x where x.guest_id = p_guest_id and x.game_id = s.game_id);
  update public.potm_votes set voted_for_id = null, voted_for_guest_id = p_guest_id
    where id = any (l.moved_votes) and voted_for_id = u;

  -- The account's details and status, unless they've been changed since.
  update public.player_profiles set
      gender = case when l.filled ? 'gender' and gender = l.filled ->> 'gender' then null else gender end,
      position = case when l.filled ? 'position' and position = l.filled ->> 'position' then null else position end
    where user_id = u and (l.filled ? 'gender' or l.filled ? 'position');
  if l.status_after is not null and l.status_before is not null and l.status_before <> l.status_after then
    update public.player_profiles set status = l.status_before where user_id = u and status = l.status_after;
  end if;

  update public.team_guests set linked_user_id = null where id = p_guest_id;

  -- Who paid with whom: the name's partner goes back to it, and the account's
  -- partner from before to the account, if nobody has paired them up since.
  if l.guest_partner is not null then
    if l.guest_partner <> u and public.dues_partner_of(u) = l.guest_partner then
      perform public.set_dues_partner(u, null);
    end if;
    if public.dues_partner_of(p_guest_id) is null and public.dues_partner_of(l.guest_partner) is null
      and not exists (select 1 from public.team_guests where id = l.guest_partner and linked_user_id is not null) then
      perform public.set_dues_partner(p_guest_id, l.guest_partner);
    end if;
  end if;
  if l.user_partner is not null and public.dues_partner_of(u) is null and public.dues_partner_of(l.user_partner) is null
    and not exists (select 1 from public.team_guests where id = l.user_partner and linked_user_id is not null) then
    perform public.set_dues_partner(u, l.user_partner);
  end if;

  -- Back on the current session's list, if it started while the name was linked.
  select * into cur from public.roster_current_session();
  if exists (select 1 from public.session_roster where season_year = cur.cur_year and session = cur.cur_session) then
    insert into public.session_roster (season_year, session, guest_id, status, answered_at, changed_by)
    values (cur.cur_year, cur.cur_session, p_guest_id, case when g.removed then 'off' else g.status end, now(), me)
    on conflict do nothing;
  end if;

  update public.team_guest_links set unlinked_at = now(), unlinked_by = me where id = l.id;
end;
$$;

revoke execute on function public.unlink_team_guest(uuid) from public, anon;
grant execute on function public.unlink_team_guest(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Names picked before these records were kept. A new player picks their name
-- the moment they make their profile, so everything on their account from
-- before then came with the name, and there was nothing of theirs to merge.
-- A name a captain linked to someone who'd been on the site for a while can't
-- be told apart from their own data, so it gets no record and can't be undone
-- here. Returns how many records it made.
-- ---------------------------------------------------------------------------

create or replace function public.team_guest_links_rebuild()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  made integer;
begin
  insert into public.team_guest_links (
    guest_id, user_id, moved_payments, moved_history, moved_roster, moved_rsvps, moved_stats, moved_votes,
    moved_changes, filled, status_before, status_after, rebuilt, created_date
  )
  select g.id, p.user_id,
    array(select x.id from public.dues_payments x where x.user_id = p.user_id and x.created_date < p.created_date),
    array(select x.id from public.dues_history x where x.user_id = p.user_id and x.created_date < p.created_date),
    array(select x.id from public.session_roster x where x.user_id = p.user_id and x.created_date < p.created_date),
    array(select x.id from public.rsvps x where x.user_id = p.user_id and x.created_date < p.created_date),
    array(select x.id from public.game_stats x where x.user_id = p.user_id and x.created_date < p.created_date),
    array(select x.id from public.potm_votes x where x.voted_for_id = p.user_id and x.created_date < p.created_date),
    array(select x.id from public.dues_changes x where x.user_id = p.user_id and x.created_date < p.created_date),
    -- New players set man / woman themselves; the position may have come from the roster.
    case when g.position is not null and p.position = g.position then jsonb_build_object('position', g.position) else '{}' end,
    -- New profiles start Active, then take the name's status.
    'active', g.status, true, g.updated_date
  from public.team_guests g
  join public.player_profiles p on p.user_id = g.linked_user_id
  -- Linking a name is the last change to its row.
  where g.updated_date >= p.created_date and g.updated_date < p.created_date + interval '10 minutes'
    and not exists (select 1 from public.team_guest_links l where l.guest_id = g.id);
  get diagnostics made = row_count;
  return made;
end;
$$;

revoke execute on function public.team_guest_links_rebuild() from public, anon, authenticated;
grant execute on function public.team_guest_links_rebuild() to service_role;

select public.team_guest_links_rebuild();
