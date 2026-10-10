-- Dues: teammates who aren't on the app. Captains add them by name; they count
-- in the split and anyone can mark them paid, like everyone else. If one joins
-- the app later, a captain links them to their account and their payments and
-- history move over.

create table public.dues_guests (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  -- Counts in the split. Removing someone sets this to false; nothing is deleted.
  active boolean not null default true,
  -- Pays together with an app player or another guest (set by set_dues_partner).
  pays_with_user uuid references public.users (id) on delete set null,
  pays_with_guest uuid references public.dues_guests (id) on delete set null,
  -- Set when they join the app and a captain links them (link_dues_guest).
  linked_user_id uuid references public.users (id) on delete set null,
  created_by uuid references public.users (id) on delete set null,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create trigger dues_guests_touch before update on public.dues_guests
  for each row execute function public.touch_updated_date();

-- Everyone reads; captains add and edit. No delete policy: nobody removes a
-- guest's row (or, through it, their payments and history).
alter table public.dues_guests enable row level security;
create policy dues_guests_select on public.dues_guests for select to authenticated using (true);
create policy dues_guests_insert on public.dues_guests for insert to authenticated
  with check ((select public.is_captain()));
create policy dues_guests_update on public.dues_guests for update to authenticated
  using ((select public.is_captain())) with check ((select public.is_captain()));
grant select, insert, update, delete on public.dues_guests to authenticated, service_role;

-- A couple where one of them isn't on the app.
alter table public.player_profiles
  add column pays_with_guest uuid references public.dues_guests (id) on delete set null;

-- Payments and history can belong to an app player or a guest (exactly one).
alter table public.dues_payments alter column user_id drop not null;
alter table public.dues_payments add column guest_id uuid references public.dues_guests (id);
alter table public.dues_payments
  add constraint dues_payments_one_player check (num_nonnulls(user_id, guest_id) = 1);
create unique index dues_payments_guest_session on public.dues_payments (season_year, session, guest_id);

alter table public.dues_history alter column user_id drop not null;
alter table public.dues_history add column guest_id uuid references public.dues_guests (id);
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
    from public.dues_guests g
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
  update public.dues_guests set pays_with_user = null, pays_with_guest = null
    where id = any (ids) or pays_with_user = any (ids) or pays_with_guest = any (ids);

  if p_partner_id is null or p_partner_id = p_user_id then
    return;
  end if;

  -- Each side points at the other, in the column for the other's kind.
  update public.player_profiles p set
      pays_with = case when other.id in (select id from public.users) then other.id end,
      pays_with_guest = case when other.id in (select id from public.dues_guests) then other.id end
    from (values (p_user_id, p_partner_id), (p_partner_id, p_user_id)) as other(self, id)
    where p.user_id = other.self;
  update public.dues_guests g set
      pays_with_user = case when other.id in (select id from public.users) then other.id end,
      pays_with_guest = case when other.id in (select id from public.dues_guests) then other.id end
    from (values (p_user_id, p_partner_id), (p_partner_id, p_user_id)) as other(self, id)
    where g.id = other.self;
end;
$$;

-- ---------------------------------------------------------------------------
-- A guest joined the app: their payments and history move to their account,
-- and so does their partner. Captains only. The guest row stays, marked as
-- linked, so nothing is lost.
-- ---------------------------------------------------------------------------

create or replace function public.link_dues_guest(p_guest_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  partner uuid;
begin
  if not (select public.is_captain()) then
    raise exception 'Only captains can link a player';
  end if;
  if not exists (select 1 from public.dues_guests where id = p_guest_id and linked_user_id is null) then
    raise exception 'That player is already linked';
  end if;
  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'No such player on the app';
  end if;

  -- Sessions the app player has nothing for yet move over as they are.
  update public.dues_payments g set user_id = p_user_id, guest_id = null
  where g.guest_id = p_guest_id
    and not exists (
      select 1 from public.dues_payments u
      where u.user_id = p_user_id and u.season_year = g.season_year and u.session = g.session
    );
  -- Where both have one, a payment the guest made counts.
  update public.dues_payments u set
      paid = true, paid_date = g.paid_date, paid_by = g.paid_by,
      override_amount = coalesce(u.override_amount, g.override_amount)
    from public.dues_payments g
    where g.guest_id = p_guest_id and u.user_id = p_user_id
      and u.season_year = g.season_year and u.session = g.session
      and g.paid and not u.paid;
  update public.dues_history set user_id = p_user_id, guest_id = null where guest_id = p_guest_id;

  select coalesce(pays_with_user, pays_with_guest) into partner from public.dues_guests where id = p_guest_id;
  update public.dues_guests
    set active = false, linked_user_id = p_user_id, pays_with_user = null, pays_with_guest = null
    where id = p_guest_id;
  if partner is not null then
    perform public.set_dues_partner(p_user_id, partner);
  end if;
end;
$$;

revoke execute on function public.link_dues_guest(uuid, uuid) from public, anon;
grant execute on function public.link_dues_guest(uuid, uuid) to authenticated, service_role;
