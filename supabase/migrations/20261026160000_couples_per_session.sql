-- Who pays together, per session (#83). Until now a couple was one setting
-- per player (player_profiles.pays_with, team_guests.pays_with_*) that every
-- session read, past ones included: linking Alex and Riley in session 2 showed
-- them as a couple in session 1 too, where they'd paid on their own, and
-- "Mark as not paid" there unmarked both.
--
-- Now each session's list keeps who paid with whom, like its statuses
-- (session_roster.pays_with_user / pays_with_guest). The setting on the
-- profile is who pays together from now on: a session's list starts with it,
-- and the session status changes count for (roster_open_session()) and the
-- sessions after it keep following it. A session that's over keeps its own:
-- linking a couple between sessions counts from the next session, and
-- captains correct a past session's couples with set_session_partner().
--
-- Lists that already exist start with today's couples, so every session shows
-- what it showed before this.

alter table public.session_roster
  add column pays_with_user uuid references public.users (id) on delete set null,
  add column pays_with_guest uuid references public.team_guests (id) on delete set null;

-- Sessions where the name's entry moved to the account, whose entries for the
-- name's partner were pointed at the account (moved with it, like moved_roster).
alter table public.team_guest_links
  add column moved_partners uuid[] not null default '{}';

-- ---------------------------------------------------------------------------
-- The sessions that follow who pays together now: the session status changes
-- count for and any later one. Not a session that's over, or before.
-- ---------------------------------------------------------------------------

create or replace function public.roster_follows_couples(p_year integer, p_session integer)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cur record;
  o record;
begin
  select * into cur from public.roster_current_session();
  if (p_year, p_session) > (cur.cur_year, cur.cur_session) then
    return true;
  end if;
  select * into o from public.roster_open_session();
  return o.open_year is not null and (p_year, p_session) = (o.open_year, o.open_session);
end;
$$;

-- An entry added to a session that follows who pays together now (its list
-- starting, a new player, a session asked about ahead) starts with the
-- player's partner. A captain adding someone to a past session doesn't.
create or replace function public.session_roster_couple()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.pays_with_user is not null or new.pays_with_guest is not null)
    or not public.roster_follows_couples(new.season_year, new.session) then
    return new;
  end if;
  if new.user_id is not null then
    select p.pays_with, p.pays_with_guest into new.pays_with_user, new.pays_with_guest
      from public.player_profiles p where p.user_id = new.user_id;
  else
    select g.pays_with_user, g.pays_with_guest into new.pays_with_user, new.pays_with_guest
      from public.team_guests g where g.id = new.guest_id and g.linked_user_id is null;
  end if;
  return new;
end;
$$;

create trigger session_roster_couple before insert on public.session_roster
  for each row execute function public.session_roster_couple();

-- Linking or unlinking a couple (set_dues_partner()) changes who they pay with
-- in the session status changes count for and the ones after it.
create or replace function public.roster_follow_couple()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cur record;
  o record;
  self_user uuid;
  self_guest uuid;
  with_user uuid;
  with_guest uuid;
begin
  if tg_table_name = 'player_profiles' then
    self_user := new.user_id;
    with_user := new.pays_with;
    with_guest := new.pays_with_guest;
  else
    -- Once a roster name has joined, their account's entries are the ones that count.
    if new.linked_user_id is not null then
      return new;
    end if;
    self_guest := new.id;
    with_user := new.pays_with_user;
    with_guest := new.pays_with_guest;
  end if;
  select * into cur from public.roster_current_session();
  select * into o from public.roster_open_session();
  update public.session_roster r
    set pays_with_user = with_user, pays_with_guest = with_guest
    where (r.user_id = self_user or r.guest_id = self_guest)
      and ((r.season_year, r.session) > (cur.cur_year, cur.cur_session)
        or (r.season_year = o.open_year and r.session = o.open_session))
      and (r.pays_with_user is distinct from with_user or r.pays_with_guest is distinct from with_guest);
  return new;
end;
$$;

create trigger player_profiles_couple
  after update of pays_with, pays_with_guest on public.player_profiles
  for each row
  when (old.pays_with is distinct from new.pays_with or old.pays_with_guest is distinct from new.pays_with_guest)
  execute function public.roster_follow_couple();

create trigger team_guests_couple
  after update of pays_with_user, pays_with_guest on public.team_guests
  for each row
  when (old.pays_with_user is distinct from new.pays_with_user or old.pays_with_guest is distinct from new.pays_with_guest)
  execute function public.roster_follow_couple();

-- ---------------------------------------------------------------------------
-- Captains: who paid together in a session that's over (or before), that
-- session only. Both have to be on its list; a null partner unlinks. Like
-- set_dues_partner(), anyone either of them paid with there pays on their own.
-- ---------------------------------------------------------------------------

create or replace function public.set_session_partner(p_year integer, p_session integer, p_id uuid, p_partner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ids uuid[] := array[p_id, p_partner_id];
begin
  if (select auth.uid()) is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_captain() then
    raise exception 'Only captains can change who paid together in a past session';
  end if;
  if public.roster_follows_couples(p_year, p_session) then
    raise exception 'That session isn''t over: who pays together there follows who pays together now';
  end if;
  if not exists (
    select 1 from public.session_roster
    where season_year = p_year and session = p_session and p_id in (user_id, guest_id)
  ) or (p_partner_id is not null and not exists (
    select 1 from public.session_roster
    where season_year = p_year and session = p_session and p_partner_id in (user_id, guest_id)
  )) then
    raise exception 'They weren''t on session %', p_session;
  end if;

  update public.session_roster set pays_with_user = null, pays_with_guest = null
    where season_year = p_year and session = p_session
      and (user_id = any (ids) or guest_id = any (ids) or pays_with_user = any (ids) or pays_with_guest = any (ids));

  if p_partner_id is null or p_partner_id = p_id then
    return;
  end if;

  -- Each side points at the other, in the column for the other's kind.
  update public.session_roster r set
      pays_with_user = case when other.id in (select id from public.users) then other.id end,
      pays_with_guest = case when other.id in (select id from public.team_guests) then other.id end
    from (values (p_id, p_partner_id), (p_partner_id, p_id)) as other(self, id)
    where r.season_year = p_year and r.session = p_session and other.self in (r.user_id, r.guest_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Same as 20261019120000_ask_next_session.sql, plus: where the name's entry
-- moves to the account, and in the sessions that follow who pays together
-- now, whoever paid with the name pays with the account (recorded in
-- moved_partners, so an undo can put it back).
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
  cur record;
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

  -- Sessions asked about ahead: an answer given for the name (by a captain,
  -- say) counts over an account entry that's only been following its status.
  -- A new player is put on those lists when they make their profile, just
  -- before they pick their name. That entry takes the name's answer (the
  -- name's is kept), as it was is recorded, and the dues change that answer
  -- made moves with the name's (above), so it isn't recorded again.
  select * into cur from public.roster_current_session();
  perform set_config('jive.roster_applying', 'on', true);
  with merged as (
    update public.session_roster u
      set status = r.status, answered_at = r.answered_at, changed_by = r.changed_by
      from public.session_roster r, public.session_roster was
      where u.user_id = p_user_id and u.answered_at is null
        and r.guest_id = p_guest_id and r.answered_at is not null
        and r.season_year = u.season_year and r.session = u.session
        and (u.season_year, u.session) > (cur.cur_year, cur.cur_session)
        and was.id = u.id
      returning u.id,
        jsonb_build_object('status', was.status, 'answered_at', was.answered_at, 'changed_by', was.changed_by) as before,
        jsonb_build_object('status', u.status, 'answered_at', u.answered_at, 'changed_by', u.changed_by) as after
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'before', before, 'after', after)), '[]')
    into rec.merged_roster from merged;
  perform set_config('jive.roster_applying', 'off', true);

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
  -- Whoever paid with the name pays with the account: in the sessions whose
  -- entry for the name just moved, and in the ones that follow who pays
  -- together now (set_dues_partner() below would do those too).
  with moved as (
    update public.session_roster r set pays_with_user = p_user_id, pays_with_guest = null
    where r.pays_with_guest = p_guest_id
      and (
        exists (
          select 1 from public.session_roster m
          where m.id = any (rec.moved_roster) and m.season_year = r.season_year and m.session = r.session
        )
        or public.roster_follows_couples(r.season_year, r.session)
      )
    returning r.id
  )
  select coalesce(array_agg(id), '{}') into rec.moved_partners from moved;

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

-- ---------------------------------------------------------------------------
-- Same as 20261026120000_finished_session_roster.sql, plus: whoever paid with
-- the account because of the pick (moved_partners) pays with the name again.
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
  back text;
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
  -- Whoever paid with the name in those sessions, unless they've been paired up since.
  update public.session_roster set pays_with_user = null, pays_with_guest = p_guest_id
    where id = any (l.moved_partners) and pays_with_user = u;
  -- The account's entries that took the name's answer, unless changed since.
  perform set_config('jive.roster_applying', 'on', true);
  update public.session_roster r set
      status = was.before ->> 'status',
      answered_at = (was.before ->> 'answered_at')::timestamptz,
      changed_by = (was.before ->> 'changed_by')::uuid
    from jsonb_to_recordset(l.merged_roster) as was (id uuid, before jsonb, after jsonb)
    where r.id = was.id and r.user_id = u
      and r.status = was.after ->> 'status'
      and r.answered_at is not distinct from (was.after ->> 'answered_at')::timestamptz
      and r.changed_by is not distinct from (was.after ->> 'changed_by')::uuid;
  perform set_config('jive.roster_applying', 'off', true);

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

  -- Back on the current session's list, if it started while the name was
  -- linked. A session that's over keeps its list.
  select * into cur from public.roster_open_session();
  if cur.open_year is not null
    and exists (select 1 from public.session_roster where season_year = cur.open_year and session = cur.open_session) then
    insert into public.session_roster (season_year, session, guest_id, status, answered_at, changed_by)
    values (cur.open_year, cur.open_session, p_guest_id, case when g.removed then 'off' else g.status end, now(), me)
    on conflict do nothing;
  end if;
  -- Both keep up with their status in sessions asked about ahead, where they
  -- haven't answered (the name may have been left off one asked while linked).
  perform public.roster_follow_ahead(null, p_guest_id, case when g.removed then 'off' else g.status end);
  select case when removed then 'off' else status end into back from public.player_profiles where user_id = u;
  if back is not null then
    perform public.roster_follow_ahead(u, null, back);
  end if;

  update public.team_guest_links set unlinked_at = now(), unlinked_by = me where id = l.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lists that already exist start with today's couples, so every session shows
-- what it showed before this. Roster names that have joined have none.
-- ---------------------------------------------------------------------------

update public.session_roster r
  set pays_with_user = p.pays_with, pays_with_guest = p.pays_with_guest
  from public.player_profiles p
  where r.user_id = p.user_id and (p.pays_with is not null or p.pays_with_guest is not null);
update public.session_roster r
  set pays_with_user = g.pays_with_user, pays_with_guest = g.pays_with_guest
  from public.team_guests g
  where r.guest_id = g.id and g.linked_user_id is null
    and (g.pays_with_user is not null or g.pays_with_guest is not null);

-- A roster name picked before this update already has moved_roster, but its
-- new moved_partners starts empty. The snapshots above point its partner at
-- the account. Record those references too, so undoing an old pick restores
-- both sides in past sessions, where the profile-following triggers won't run.
update public.team_guest_links l
  set moved_partners = array(
    select r.id from public.session_roster r
    where r.pays_with_user = l.user_id
      and exists (
        select 1 from public.session_roster moved
        where moved.id = any (l.moved_roster) and moved.user_id = l.user_id
          and moved.season_year = r.season_year and moved.session = r.session
      )
  )
  where l.unlinked_at is null;

revoke execute on function public.roster_follows_couples(integer, integer) from public, anon, authenticated;
revoke execute on function public.session_roster_couple() from public, anon, authenticated;
revoke execute on function public.roster_follow_couple() from public, anon, authenticated;
revoke execute on function public.set_session_partner(integer, integer, uuid, uuid) from public, anon;
grant execute on function public.roster_follows_couples(integer, integer) to service_role;
grant execute on function public.set_session_partner(integer, integer, uuid, uuid) to authenticated, service_role;
