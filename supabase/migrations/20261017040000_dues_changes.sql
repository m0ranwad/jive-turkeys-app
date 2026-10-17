-- Dues: keep a record of what moves everyone's share. The paid / not paid
-- history (dues_history) says who paid, but when a share changes after people
-- have paid ("share is now $62") nothing said why. Now the session fee, custom
-- amounts, and players joining, sitting out or coming off a session's roster
-- are kept too, with who changed them and when. The database writes them
-- (triggers below), so nobody can edit or remove them, captains included. The
-- whole team reads them.

create table public.dues_changes (
  id uuid primary key default gen_random_uuid(),
  season_year integer not null,
  session integer not null,
  kind text not null check (kind in ('fee', 'custom_amount', 'roster')),
  -- The player it's about (an app player or a roster name); none for the session fee.
  user_id uuid references public.users (id) on delete cascade,
  guest_id uuid references public.team_guests (id),
  -- fee: { league_fee, ref_fee, game_count, total_fee }; custom_amount: { amount }; roster: { status }.
  -- No old_value: newly set. No new_value: cleared (back on the even split).
  old_value jsonb,
  new_value jsonb,
  changed_by uuid references public.users (id) on delete set null,
  created_date timestamptz not null default now(),
  constraint dues_changes_one_player check (num_nonnulls(user_id, guest_id) <= 1)
);

create index dues_changes_session_idx on public.dues_changes (season_year, session, created_date);

alter table public.dues_changes enable row level security;
create policy dues_changes_select on public.dues_changes for select to authenticated
  using ((select public.is_team_member()));
grant select, insert, update, delete on public.dues_changes to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The session fee: set or changed.
-- ---------------------------------------------------------------------------

create or replace function public.dues_changes_fee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  before jsonb;
  after jsonb := jsonb_build_object(
    'league_fee', new.league_fee, 'ref_fee', new.ref_fee, 'game_count', new.game_count, 'total_fee', new.total_fee
  );
begin
  if tg_op = 'UPDATE' then
    before := jsonb_build_object(
      'league_fee', old.league_fee, 'ref_fee', old.ref_fee, 'game_count', old.game_count, 'total_fee', old.total_fee
    );
  end if;
  if before is distinct from after then
    insert into public.dues_changes (season_year, session, kind, old_value, new_value, changed_by)
    values (new.season_year, new.session, 'fee', before, after, (select auth.uid()));
  end if;
  return new;
end;
$$;

create trigger session_dues_changes
  after insert or update on public.session_dues
  for each row execute function public.dues_changes_fee();

-- ---------------------------------------------------------------------------
-- A player's custom amount: set, changed, or cleared (back on the even split).
-- ---------------------------------------------------------------------------

create or replace function public.dues_changes_custom_amount()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  before numeric;
begin
  if tg_op = 'UPDATE' then
    before := old.override_amount;
  end if;
  if before is distinct from new.override_amount then
    insert into public.dues_changes (season_year, session, kind, user_id, guest_id, old_value, new_value, changed_by)
    values (
      new.season_year, new.session, 'custom_amount', new.user_id, new.guest_id,
      case when before is not null then jsonb_build_object('amount', before) end,
      case when new.override_amount is not null then jsonb_build_object('amount', new.override_amount) end,
      (select auth.uid())
    );
  end if;
  return new;
end;
$$;

create trigger dues_payments_changes
  after insert or update of override_amount on public.dues_payments
  for each row execute function public.dues_changes_custom_amount();

-- ---------------------------------------------------------------------------
-- A session's roster: someone coming onto or off the active list (joining,
-- sitting out, the sub pool, taken off the team, a captain's correction).
-- A session's list starting as a copy of everyone's status isn't a change:
-- those rows aren't answered yet.
-- ---------------------------------------------------------------------------

create or replace function public.dues_changes_roster()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  was_active boolean := false;
begin
  if tg_op = 'INSERT' and new.answered_at is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    was_active := old.status = 'active';
  end if;
  if was_active <> (new.status = 'active') then
    insert into public.dues_changes (season_year, session, kind, user_id, guest_id, old_value, new_value, changed_by)
    values (
      new.season_year, new.session, 'roster', new.user_id, new.guest_id,
      case when tg_op = 'UPDATE' then jsonb_build_object('status', old.status) end,
      jsonb_build_object('status', new.status),
      coalesce((select auth.uid()), new.changed_by)
    );
  end if;
  return new;
end;
$$;

create trigger session_roster_changes
  after insert or update of status on public.session_roster
  for each row execute function public.dues_changes_roster();

-- ---------------------------------------------------------------------------
-- A roster name that joins: its changes move to the account, like its dues
-- payments and history (move_team_guest()).
-- ---------------------------------------------------------------------------

create or replace function public.dues_changes_follow_guest()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.dues_changes set user_id = new.linked_user_id, guest_id = null where guest_id = new.id;
  return new;
end;
$$;

create trigger team_guests_dues_changes
  after update of linked_user_id on public.team_guests
  for each row
  when (new.linked_user_id is not null and old.linked_user_id is null)
  execute function public.dues_changes_follow_guest();
