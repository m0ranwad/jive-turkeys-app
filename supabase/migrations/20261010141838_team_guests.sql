-- Roster players who haven't joined the app yet ("guests"). Captains add the
-- team by name on the Team page, so the roster and the dues split are right
-- from day one. A guest has a roster status like everyone else, counts in the
-- dues while Active, and anyone can mark them paid. When they sign up, they
-- pick their name (claim_team_guest) and their status, dues payments and
-- history move to their account; a captain can also link them
-- (link_team_guest). Some may never join, and that's fine.

create table public.team_guests (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  gender text check (gender in ('M', 'F')),
  position text,
  -- Same statuses as player_profiles.status.
  status text not null default 'active' check (status in ('active', 'on_break', 'sub_pool')),
  -- Taken off the team. Nothing is deleted; a captain can add them back.
  removed boolean not null default false,
  -- Pays together with an app player or another guest (set by set_dues_partner).
  pays_with_user uuid references public.users (id) on delete set null,
  pays_with_guest uuid references public.team_guests (id) on delete set null,
  -- Their account, once they've joined and picked their name (or a captain linked them).
  linked_user_id uuid references public.users (id) on delete set null,
  created_by uuid references public.users (id) on delete set null,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create trigger team_guests_touch before update on public.team_guests
  for each row execute function public.touch_updated_date();

-- Everyone reads; captains add and edit. No delete policy: nobody removes a
-- guest's row (or, through it, their payments and history).
alter table public.team_guests enable row level security;
create policy team_guests_select on public.team_guests for select to authenticated using (true);
create policy team_guests_insert on public.team_guests for insert to authenticated
  with check ((select public.is_captain()));
create policy team_guests_update on public.team_guests for update to authenticated
  using ((select public.is_captain())) with check ((select public.is_captain()));
grant select, insert, update, delete on public.team_guests to authenticated, service_role;

-- A couple where one of them isn't on the app.
alter table public.player_profiles
  add column pays_with_guest uuid references public.team_guests (id) on delete set null;

-- Payments and history can belong to an app player or a guest (exactly one).
alter table public.dues_payments alter column user_id drop not null;
alter table public.dues_payments add column guest_id uuid references public.team_guests (id);
alter table public.dues_payments
  add constraint dues_payments_one_player check (num_nonnulls(user_id, guest_id) = 1);
create unique index dues_payments_guest_session on public.dues_payments (season_year, session, guest_id);

alter table public.dues_history alter column user_id drop not null;
alter table public.dues_history add column guest_id uuid references public.team_guests (id);
alter table public.dues_history
  add constraint dues_history_one_player check (num_nonnulls(user_id, guest_id) = 1);

-- ---------------------------------------------------------------------------
-- Same as before, for app players and guests alike: p_user_ids can hold
-- either kind of id.
-- ---------------------------------------------------------------------------

create or replace function public.mark_dues_paid(
  p_season_year integer,
  p_session integer,
  p_user_ids uuid[],
  p_paid boolean,
  p_paid_date date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'Not signed in';
  end if;

  -- App players.
  with changing as (
    select u.id
    from public.users u
    left join public.dues_payments d
      on d.season_year = p_season_year and d.session = p_session and d.user_id = u.id
    where u.id = any (p_user_ids) and coalesce(d.paid, false) <> p_paid
  ),
  saved as (
    insert into public.dues_payments (season_year, session, user_id, paid, paid_date, paid_by)
    select p_season_year, p_session, c.id, p_paid,
      case when p_paid then coalesce(p_paid_date, current_date) end,
      case when p_paid then me end
    from changing c
    on conflict (season_year, session, user_id) do update
      set paid = excluded.paid, paid_date = excluded.paid_date, paid_by = excluded.paid_by
    returning user_id, paid, paid_date
  )
  insert into public.dues_history (season_year, session, user_id, paid, paid_date, changed_by)
  select p_season_year, p_session, s.user_id, s.paid, s.paid_date, me
  from saved s;

  -- Teammates who aren't on the app.
  with changing as (
    select g.id
    from public.team_guests g
    left join public.dues_payments d
      on d.season_year = p_season_year and d.session = p_session and d.guest_id = g.id
    where g.id = any (p_user_ids) and coalesce(d.paid, false) <> p_paid
  ),
  saved as (
    insert into public.dues_payments (season_year, session, guest_id, paid, paid_date, paid_by)
    select p_season_year, p_session, c.id, p_paid,
      case when p_paid then coalesce(p_paid_date, current_date) end,
      case when p_paid then me end
    from changing c
    on conflict (season_year, session, guest_id) do update
      set paid = excluded.paid, paid_date = excluded.paid_date, paid_by = excluded.paid_by
    returning guest_id, paid, paid_date
  )
  insert into public.dues_history (season_year, session, guest_id, paid, paid_date, changed_by)
  select p_season_year, p_session, s.guest_id, s.paid, s.paid_date, me
  from saved s;
end;
$$;

-- ---------------------------------------------------------------------------
-- Same as before, and either player can be a guest. A player is only ever
-- linked to one other player.
-- ---------------------------------------------------------------------------

create or replace function public.set_dues_partner(p_user_id uuid, p_partner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ids uuid[] := array[p_user_id, p_partner_id];
begin
  if (select auth.uid()) is null then
    raise exception 'Not signed in';
  end if;

  update public.player_profiles set pays_with = null, pays_with_guest = null
    where user_id = any (ids) or pays_with = any (ids) or pays_with_guest = any (ids);
  update public.team_guests set pays_with_user = null, pays_with_guest = null
    where id = any (ids) or pays_with_user = any (ids) or pays_with_guest = any (ids);

  if p_partner_id is null or p_partner_id = p_user_id then
    return;
  end if;

  -- Each side points at the other, in the column for the other's kind.
  update public.player_profiles p set
      pays_with = case when other.id in (select id from public.users) then other.id end,
      pays_with_guest = case when other.id in (select id from public.team_guests) then other.id end
    from (values (p_user_id, p_partner_id), (p_partner_id, p_user_id)) as other(self, id)
    where p.user_id = other.self;
  update public.team_guests g set
      pays_with_user = case when other.id in (select id from public.users) then other.id end,
      pays_with_guest = case when other.id in (select id from public.team_guests) then other.id end
    from (values (p_user_id, p_partner_id), (p_partner_id, p_user_id)) as other(self, id)
    where g.id = other.self;
end;
$$;

-- ---------------------------------------------------------------------------
-- A guest joined the app: their dues payments and history move to their
-- account, and so does their partner. The guest row stays, marked as linked
-- (and off the roster), so nothing is lost. Only for the two functions below.
-- ---------------------------------------------------------------------------

create or replace function public.move_team_guest(p_guest_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.team_guests;
  partner uuid;
begin
  select * into g from public.team_guests where id = p_guest_id;
  if g.id is null or g.linked_user_id is not null then
    raise exception 'That name has already been picked';
  end if;
  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'No such player on the app';
  end if;
  if exists (select 1 from public.team_guests where linked_user_id = p_user_id) then
    raise exception 'That player already has a name on the roster';
  end if;

  -- Sessions the app player has nothing for yet move over as they are.
  update public.dues_payments d set user_id = p_user_id, guest_id = null
  where d.guest_id = p_guest_id
    and not exists (
      select 1 from public.dues_payments u
      where u.user_id = p_user_id and u.season_year = d.season_year and u.session = d.session
    );
  -- Where both have one, a payment the guest made counts.
  update public.dues_payments u set
      paid = true, paid_date = d.paid_date, paid_by = d.paid_by,
      override_amount = coalesce(u.override_amount, d.override_amount)
    from public.dues_payments d
    where d.guest_id = p_guest_id and u.user_id = p_user_id
      and u.season_year = d.season_year and u.session = d.session
      and d.paid and not u.paid;
  update public.dues_history set user_id = p_user_id, guest_id = null where guest_id = p_guest_id;

  -- Details the player hasn't filled in come from the roster.
  update public.player_profiles
    set gender = coalesce(gender, g.gender), position = coalesce(position, g.position)
    where user_id = p_user_id;

  partner := coalesce(g.pays_with_user, g.pays_with_guest);
  update public.team_guests
    set linked_user_id = p_user_id, pays_with_user = null, pays_with_guest = null
    where id = p_guest_id;
  if partner is not null then
    perform public.set_dues_partner(p_user_id, partner);
  end if;
end;
$$;

revoke execute on function public.move_team_guest(uuid, uuid) from public, anon, authenticated;
grant execute on function public.move_team_guest(uuid, uuid) to service_role;

-- A new player picks their name on the roster when they join. Anyone signed
-- in can, once, for a name nobody has picked; their roster status carries over.
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
  select status into roster_status from public.team_guests where id = p_guest_id and not removed;
  if roster_status is null then
    raise exception 'That name is no longer on the roster';
  end if;
  perform public.move_team_guest(p_guest_id, me);
  update public.player_profiles set status = roster_status where user_id = me;
end;
$$;

-- Captains link someone who joined without picking their name (or joined
-- before they were added). Their own roster status stays as it is.
create or replace function public.link_team_guest(p_guest_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (select public.is_captain()) then
    raise exception 'Only captains can link a player';
  end if;
  perform public.move_team_guest(p_guest_id, p_user_id);
end;
$$;

revoke execute on function public.claim_team_guest(uuid) from public, anon;
revoke execute on function public.link_team_guest(uuid, uuid) from public, anon;
grant execute on function public.claim_team_guest(uuid) to authenticated, service_role;
grant execute on function public.link_team_guest(uuid, uuid) to authenticated, service_role;
